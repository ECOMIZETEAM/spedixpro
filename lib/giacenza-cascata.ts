import { registraMovimentoMaster, registraMovimento } from '@/lib/movimenti'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Mappa il "nome" di un supplemento giacenza (sia lato cliente sia lato master) sull'operazione.
// Es. "Riconsegna al nuovo destinatario" -> riconsegna_nuovo, "Reso al mittente" -> reso.
function chiaveServizio(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (n.includes('nuovo')) return 'riconsegna_nuovo'
  if (n.includes('reso')) return 'reso'
  if (n.includes('riconsegna')) return 'riconsegna'
  return null
}

// Prezzo giacenza (apertura + servizio dell'operazione) di UN master per un suo corriere,
// letto dal SUO Listino Corrieri (listini_corrieri_supplementi). Se non configurato -> 0.
async function prezzoGiacenzaMaster(admin: any, corriereId: string, operazione: string): Promise<{ apertura: number; servizio: number }> {
  const { data: suppl } = await admin.from('listini_corrieri_supplementi')
    .select('id,tipo,nome,valore').eq('corriere_id', corriereId).in('tipo', ['giacenza', 'giacenza_apertura'])
    .order('id', { ascending: true })   // DETERMINISTICO: con supplementi duplicati prende sempre il primo (id più basso)
  let apertura = 0, servizio = 0
  let aperturaSet = false, servizioSet = false
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aperturaSet) { apertura = Number(s.valore) || 0; aperturaSet = true } continue }
    if (chiaveServizio(s.nome) === operazione && !servizioSet) { servizio = Number(s.valore) || 0; servizioSet = true }
  }
  return { apertura, servizio }
}

/**
 * Cascata giacenza: come per le spedizioni, ogni master della catena — dal master diretto della
 * spedizione fino al DETENTORE del contratto — viene addebitato del SUO prezzo giacenza per quel
 * corriere (apertura + servizio dell'operazione), scalando il suo credito (RPC atomica). Due voci
 * separate. Se un livello non ha prezzo giacenza configurato, non viene addebitato (0).
 * Il reso di solito non ha apertura dossier (come nel calcolo cliente): parametro conApertura.
 */
export async function addebitaGiacenzaCatena(
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    corriereNome: string
    operazione: string          // riconsegna | riconsegna_nuovo | reso
    numero: string
    spedizioneId: string | null
    createdBy: string | null
    conApertura: boolean        // addebita l'apertura dossier (all'ENTRATA in giacenza)
    conServizio?: boolean       // addebita il servizio dell'operazione (allo SVINCOLO). Default true.
  }
): Promise<void> {
  const conServizio = params.conServizio !== false
  const admin = createAdminSupabase()

  // Detentore REALE del contratto: il master più in alto che possiede lo stesso nome_contratto.
  let ownerReale = params.corriereOwnerId
  {
    let cur: string | null = params.corriereOwnerId
    for (let i = 0; i < 20 && cur; i++) {
      const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      const parent: string | null = mm?.parent_master_id || null
      if (!parent) break
      const { data: pc } = await admin.from('corrieri').select('id').eq('master_id', parent).eq('nome_contratto', params.corriereNome).limit(1).maybeSingle()
      if (pc?.id) { ownerReale = parent; cur = parent } else break
    }
  }

  const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }
  let currentId: string | null = params.masterDirettoId
  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m }: any = await admin.from('masters').select('id,parent_master_id').eq('id', currentId).maybeSingle()
    if (!m) break

    // Corriere (copia) di questo master per lo stesso contratto -> per leggerne il prezzo giacenza.
    const { data: mCorr }: any = await admin.from('corrieri')
      .select('id').eq('master_id', m.id).eq('nome_contratto', params.corriereNome).limit(1).maybeSingle()
    if (mCorr?.id) {
      const pr = await prezzoGiacenzaMaster(admin, mCorr.id, params.operazione)
      const apertura = params.conApertura ? pr.apertura : 0
      // Due voci separate (come per il cliente): apertura giacenza + servizio.
      if (apertura > 0) {
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: m.id, masterTargetId: m.id, tipo: 'giacenza',
            descrizione: `Apertura giacenza ${params.numero}`, riferimento: params.numero,
            importo: -Math.abs(apertura), spedizioneId: params.spedizioneId, createdBy: params.createdBy,
          })
        } catch (e) { console.error(`Errore apertura giacenza cascata master ${m.id}:`, e) }
      }
      if (conServizio && pr.servizio > 0) {
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: m.id, masterTargetId: m.id, tipo: 'giacenza',
            descrizione: `${opLabel[params.operazione] || params.operazione} ${params.numero}`, riferimento: params.numero,
            importo: -Math.abs(pr.servizio), spedizioneId: params.spedizioneId, createdBy: params.createdBy,
          })
        } catch (e) { console.error(`Errore servizio giacenza cascata master ${m.id}:`, e) }
      }
    }

    if (m.id === ownerReale) break
    currentId = m.parent_master_id
  }
}

const OP_LABEL: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }

// Prezzo giacenza dal listino del CLIENTE (apertura + servizio dell'operazione) per un corriere.
async function prezzoGiacenzaClienteListino(admin: any, clienteId: string, corriereId: string, operazione: string): Promise<{ apertura: number; servizio: number }> {
  const { data: cli } = await admin.from('clienti').select('listino_cliente_id').eq('id', clienteId).maybeSingle()
  if (!cli?.listino_cliente_id) return { apertura: 0, servizio: 0 }
  let q = admin.from('listini_clienti_supplementi').select('id,tipo,nome,valore')
    .eq('listino_id', cli.listino_cliente_id).in('tipo', ['giacenza', 'giacenza_apertura']).order('id', { ascending: true })
  if (corriereId) q = q.eq('corriere_id', corriereId)
  const { data: suppl } = await q
  let apertura = 0, servizio = 0, aSet = false, sSet = false
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aSet) { apertura = Number(s.valore) || 0; aSet = true } continue }
    if (chiaveServizio(s.nome) === operazione && !sSet) { servizio = Number(s.valore) || 0; sSet = true }
  }
  return { apertura, servizio }
}

type SpedGiac = { id: string; numero: string; cliente_id: string | null; master_id: string; corriere_id: string; giacenza_apertura_addebitata?: boolean }

/**
 * APERTURA giacenza — addebitata all'ENTRATA in giacenza (dal cron): il cliente paga subito
 * l'apertura dossier, e la spesa risale la rete (ogni master paga la SUA apertura). Una sola volta
 * (guard giacenza_apertura_addebitata). Il servizio (riconsegna/reso) NON si tocca qui.
 */
export async function addebitaAperturaGiacenza(sped: SpedGiac): Promise<void> {
  if (sped.giacenza_apertura_addebitata) return
  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('master_id,nome_contratto').eq('id', sped.corriere_id).maybeSingle()
  if (sped.cliente_id) {
    const pr = await prezzoGiacenzaClienteListino(admin, sped.cliente_id, sped.corriere_id, 'riconsegna')
    if (pr.apertura > 0) {
      try {
        await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
          descrizione: `Apertura giacenza ${sped.numero}`, importo: -Math.abs(pr.apertura), riferimento: sped.numero, spedizioneId: sped.id })
      } catch (e) { console.error('Errore apertura giacenza cliente:', e) }
    }
  }
  if (corr?.nome_contratto) {
    await addebitaGiacenzaCatena({ masterDirettoId: sped.master_id, corriereOwnerId: corr.master_id, corriereNome: corr.nome_contratto,
      operazione: 'riconsegna', numero: sped.numero, spedizioneId: sped.id, createdBy: null, conApertura: true, conServizio: false })
  }
  await admin.from('spedizioni').update({ giacenza_apertura_addebitata: true }).eq('id', sped.id)
}

/**
 * SERVIZIO giacenza — addebitato allo SVINCOLO in base all'operazione scelta (riconsegna/reso/…):
 * il cliente paga l'importo (congelato nella richiesta) e la spesa risale la rete (ogni master
 * paga il SUO servizio). L'apertura NON si tocca qui (già addebitata all'entrata).
 */
export async function addebitaServizioGiacenza(sped: SpedGiac, operazione: string, importoServizioCliente: number): Promise<void> {
  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('master_id,nome_contratto').eq('id', sped.corriere_id).maybeSingle()
  if (sped.cliente_id && importoServizioCliente > 0) {
    try {
      await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
        descrizione: `${OP_LABEL[operazione] || operazione} ${sped.numero}`, importo: -Math.abs(importoServizioCliente), riferimento: sped.numero, spedizioneId: sped.id })
    } catch (e) { console.error('Errore servizio giacenza cliente:', e) }
  }
  if (corr?.nome_contratto) {
    await addebitaGiacenzaCatena({ masterDirettoId: sped.master_id, corriereOwnerId: corr.master_id, corriereNome: corr.nome_contratto,
      operazione, numero: sped.numero, spedizioneId: sped.id, createdBy: null, conApertura: false, conServizio: true })
  }
}
