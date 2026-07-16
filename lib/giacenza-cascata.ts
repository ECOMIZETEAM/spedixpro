import { registraMovimentoMaster } from '@/lib/movimenti'
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
    .select('tipo,nome,valore').eq('corriere_id', corriereId).in('tipo', ['giacenza', 'giacenza_apertura'])
  let apertura = 0, servizio = 0
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { apertura = Number(s.valore) || 0; continue }
    if (chiaveServizio(s.nome) === operazione) servizio = Number(s.valore) || 0
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
    conApertura: boolean        // false per il reso (nessuna apertura dossier)
  }
): Promise<void> {
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
      if (pr.servizio > 0) {
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
