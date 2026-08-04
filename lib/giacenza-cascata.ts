import { registraMovimentoMaster, registraMovimento } from '@/lib/movimenti'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'
import { noloMaster, noloCliente, applicaServizio, addebitaResi, pagatoDaMaster, type RigaReso } from '@/lib/reso-prezzi'

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
//
// `perc` e' la percentuale sul nolo: quasi tutti i listini hanno il reso a percentuale col valore
// fisso a zero, e finche' qui si leggeva il solo valore fisso l'intera rete pagava zero mentre il
// cliente pagava il reso per intero. Chi chiama la applica al nolo di QUEL master (vedi
// lib/reso-prezzi.ts): la percentuale senza base non vuol dire niente.
async function prezzoGiacenzaMaster(admin: any, corriereId: string, operazione: string): Promise<{ apertura: number; servizio: number; perc: number }> {
  // SOLO i listini DEL MASTER PROPRIETARIO del contratto: esistono righe "fantasma" che stanno nel
  // listino di un ALTRO master ma puntano a questo corriere (39 in archivio). Leggendo per solo
  // corriere_id quelle righe SCAVALCAVANO il listino configurato: nell'editor "Riconsegna 0" ma
  // in addebito 0,70. Ora vale ciò che è impostato nel listino del master, punto.
  const { data: corr } = await admin.from('corrieri').select('master_id').eq('id', corriereId).maybeSingle()
  const { data: listini } = await admin.from('listini_corrieri').select('id').eq('master_id', (corr as any)?.master_id || '')
  const listinoIds = (listini || []).map((l: any) => l.id)
  if (!listinoIds.length) return { apertura: 0, servizio: 0, perc: 0 }
  const { data: suppl } = await admin.from('listini_corrieri_supplementi')
    .select('id,tipo,nome,valore,descrizione').eq('corriere_id', corriereId).in('listino_id', listinoIds).in('tipo', ['giacenza', 'giacenza_apertura'])
    .order('id', { ascending: true })   // DETERMINISTICO: con supplementi duplicati prende sempre il primo (id più basso)
  let apertura = 0, servizio = 0, perc = 0
  let aperturaSet = false, servizioSet = false
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aperturaSet) { apertura = Number(s.valore) || 0; aperturaSet = true } continue }
    if (chiaveServizio(s.nome) === operazione && !servizioSet) {
      servizio = Number(s.valore) || 0
      try { perc = Number(JSON.parse(s.descrizione || '{}')?.perc) || 0 } catch { /* descrizione non JSON */ }
      servizioSet = true
    }
  }
  return { apertura, servizio, perc }
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
      // Confronto NORMALIZZATO, come nella cascata delle spedizioni (lib/contratto-per-nome.ts).
      const pcId = await corriereDiMasterPerNome(admin, parent, params.corriereNome)
      if (pcId) { ownerReale = parent; cur = parent } else break
    }
  }

  const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }

  // La spedizione serve solo se un livello ha il servizio a PERCENTUALE: la percentuale si applica
  // al nolo di quel master, e il nolo si ricalcola dal suo listino. Si legge una volta sola.
  let sped: any = null
  if (params.spedizioneId) {
    const { data } = await admin.from('spedizioni')
      .select('id,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
      .eq('id', params.spedizioneId).maybeSingle()
    sped = data || null
  }

  let currentId: string | null = params.masterDirettoId
  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m }: any = await admin.from('masters').select('id,parent_master_id').eq('id', currentId).maybeSingle()
    if (!m) break

    // Corriere (copia) di questo master per lo stesso contratto -> per leggerne il prezzo giacenza.
    const mCorrId = await corriereDiMasterPerNome(admin, m.id, params.corriereNome)
    if (mCorrId) {
      const mCorr = { id: mCorrId }
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
      // TRACCIABILITA': la voce si scrive ANCHE a importo 0. Se il livello non ha un prezzo per
      // quell'operazione non paga nulla, ma l'operazione DEVE restare visibile nei suoi movimenti:
      // prima spariva del tutto e sembrava che la riconsegna non fosse mai passata da lui.
      if (conServizio) {
        // Fisso + percentuale sul NOLO di questo master. Senza la percentuale il servizio valeva
        // zero praticamente per tutti, e la rete si prendeva resi e riconsegne gratis.
        let servizio = pr.servizio
        if (pr.perc > 0) {
          const nolo = sped ? await noloMaster(admin, m.id, mCorr.id, sped) : null
          if (nolo != null) servizio = applicaServizio({ valore: pr.servizio, perc: pr.perc }, nolo)
        }
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: m.id, masterTargetId: m.id, tipo: 'giacenza',
            descrizione: `${opLabel[params.operazione] || params.operazione} ${params.numero}`, riferimento: params.numero,
            importo: -Math.abs(servizio), spedizioneId: params.spedizioneId, createdBy: params.createdBy,
          })
        } catch (e) { console.error(`Errore servizio giacenza cascata master ${m.id}:`, e) }
      }
    }

    if (m.id === ownerReale) break
    currentId = m.parent_master_id
  }
}

/**
 * RESO CHE ARRIVA DAL CORRIERE, non da uno svincolo.
 *
 * Quando e' il corriere a rimandare indietro il pacco, lo stato arriva dal tracking e nessuno dei
 * tre punti che addebitavano il reso (svincolo giacenza, distinta, rimessa di rete) viene toccato:
 * su 62 resi, 60 non li aveva pagati nessuno. Ora il database mette quei resi in coda da solo, con
 * un trigger, e questa funzione li lavora riusando lo STESSO calcolo dello svincolo — non una copia.
 *
 * L'unica differenza e' `da_giacenza: false`: qui la guardia del database DEVE applicarsi. Se il
 * reso e' gia' stato addebitato da un'altra strada, fn_addebita_resi risponde "gia_addebitato" e
 * non si paga due volte. Vince il primo dei due momenti che arriva.
 */
export async function addebitaResoDaTracking(admin: any, spedizioneId: string): Promise<EsitoAddebito> {
  const { data: sp } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,corriere_id,giacenza_apertura_addebitata,corrieri(nome_contratto,master_id)')
    .eq('id', spedizioneId).maybeSingle()
  if (!sp) return { addebitato: false, importoCliente: 0 }
  const corr: any = (sp as any).corrieri
  return addebitaResoGiacenza(
    admin,
    sp as any,
    corr?.nome_contratto || null,
    corr?.master_id || null,
    false,
  )
}

/**
 * RESO allo svincolo giacenza: cliente + tutta la catena fino al detentore del contratto, in una
 * chiamata sola al database. Qui si calcolano solo i NOLI (il motore tariffe vive nell'app); la
 * percentuale, il ripiego e l'anti-doppio-addebito li applica fn_addebita_resi.
 */
async function addebitaResoGiacenza(admin: any, sped: SpedGiac, corriereNome: string | null, corriereOwnerId: string | null, daGiacenza = true): Promise<EsitoAddebito> {
  const { data: full } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,corriere_id,costo_totale,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
    .eq('id', sped.id).maybeSingle()
  if (!full) return { addebitato: false, importoCliente: 0 }
  const righe: RigaReso[] = []

  if (full.cliente_id) {
    const { data: cli } = await admin.from('clienti').select('listino_cliente_id').eq('id', full.cliente_id).maybeSingle()
    const nolo = await noloCliente(admin, full, cli?.listino_cliente_id)
    righe.push({
      spedizione_id: full.id, cliente_id: full.cliente_id, master_owner_id: full.master_id,
      corriere_id: full.corriere_id,
      nolo: nolo != null ? nolo : Math.max(0, Number(full.costo_totale || 0)),
      da_giacenza: daGiacenza,
    })
  }

  // La catena: dal master della spedizione fino a chi possiede davvero il contratto. Ogni livello
  // paga il SUO nolo, letto dalla SUA copia del contratto.
  if (corriereNome && corriereOwnerId) {
    for (const liv of await catenaContratto(admin, full.master_id, corriereOwnerId, corriereNome)) {
      righe.push({
        spedizione_id: full.id, master_target_id: liv.masterId, master_owner_id: liv.masterId,
        corriere_id: liv.corriereId,
        nolo: (await noloMaster(admin, liv.masterId, liv.corriereId, full)) || 0,
        pagato: await pagatoDaMaster(admin, full.id, liv.masterId),
        da_giacenza: daGiacenza,
      })
    }
  }

  try {
    const esiti = await addebitaResi(admin, righe, null)
    const cli = esiti.find(e => e.cliente_id && e.esito === 'addebitato')
    return {
      // "addebitato" vuol dire che qualcuno ha davvero pagato: se torna tutto zero il reso non e'
      // stato incassato da nessuno, e chi chiama non deve marcarlo come gia' addebitato.
      addebitato: esiti.some(e => e.esito === 'addebitato' || e.esito === 'gia_addebitato'),
      importoCliente: Number(cli?.importo || 0),
    }
  } catch (e) {
    console.error('Errore addebito reso giacenza:', e)
    return { addebitato: false, importoCliente: 0 }
  }
}

export type EsitoAddebito = { addebitato: boolean; importoCliente: number }

/**
 * I livelli che pagano, dal master diretto fino al DETENTORE REALE del contratto (il master piu'
 * in alto che possiede lo stesso nome_contratto), con la copia di contratto di ciascuno.
 * Il confronto sui nomi e' normalizzato: in archivio c'e' un contratto salvato con lo spazio
 * finale su un livello e senza sull'altro, ed e' gia' costato un detentore non riconosciuto.
 */
export async function catenaContratto(
  admin: any, masterDirettoId: string, corriereOwnerId: string, corriereNome: string,
): Promise<{ masterId: string; corriereId: string }[]> {
  let ownerReale = corriereOwnerId
  let cur: string | null = corriereOwnerId
  for (let i = 0; i < 20 && cur; i++) {
    const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    const parent: string | null = mm?.parent_master_id || null
    if (!parent) break
    const pcId = await corriereDiMasterPerNome(admin, parent, corriereNome)
    if (pcId) { ownerReale = parent; cur = parent } else break
  }

  const out: { masterId: string; corriereId: string }[] = []
  let id: string | null = masterDirettoId
  for (let i = 0; i < 20 && id; i++) {
    const { data: m }: any = await admin.from('masters').select('id,parent_master_id').eq('id', id).maybeSingle()
    if (!m) break
    const cId = await corriereDiMasterPerNome(admin, m.id, corriereNome)
    if (cId) out.push({ masterId: m.id, corriereId: cId })
    if (m.id === ownerReale) break
    id = m.parent_master_id
  }
  return out
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
export async function addebitaServizioGiacenza(sped: SpedGiac, operazione: string, importoServizioCliente: number): Promise<EsitoAddebito> {
  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('master_id,nome_contratto').eq('id', sped.corriere_id).maybeSingle()

  // IL RESO NON PASSA DA QUI: lo decide il database (fn_addebita_resi), cosi' costa uguale che
  // arrivi dallo svincolo giacenza o dalla scansione in sede, e cliente e catena si addebitano in
  // una transazione sola invece che con un ciclo che puo' fermarsi a meta'.
  if (operazione === 'reso') {
    return addebitaResoGiacenza(admin, sped, corr?.nome_contratto || null, corr?.master_id || null)
  }

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
  return { addebitato: true, importoCliente: Math.abs(Number(importoServizioCliente) || 0) }
}
