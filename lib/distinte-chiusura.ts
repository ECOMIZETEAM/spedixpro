// Chiusura al vettore di una distinta MISTA (piu' contratti dello stesso vettore fisico, es. tutti GLS:
// diretto tipo='gls' + via provider tipo='spedisci'). La distinta mista ha corriere_id = NULL; le
// spedizioni portano ognuna il proprio corriere_id. Qui le RAGGRUPPO per contratto reale e chiudo ogni
// gruppo con le SUE credenziali (CloseWorkDay per il GLS diretto, borderò provider per Spedisci, ecc.).
// Attesto la distinta (confermata_vettore + bordero_id) SOLO se TUTTI i gruppi vanno a buon fine;
// altrimenti bordero_id='ERRORE: …' e la distinta resta ritentabile (la guardia lascia ripassare gli
// ERRORE). Questa e' la regola-soldi messa "dove passano tutte le porte": nessuna spedizione puo' finire
// trasmessa col contratto/credenziali sbagliati, ne' restare non trasmessa in silenzio.
//
// Le chiud* mono-contratto (chiudiBorderoSpedisci/chiudiGiornataGls/…) restano invariate per le distinte
// con un solo corriere_id: questa gira SOLO sulle miste (corriere_id NULL) e sui gruppi usa gli STESSI
// core di trasmissione, cosi' la logica vive in un posto solo.

import { chiudiSpedizioniGls, numeroNudoGls } from '@/lib/gls'
import { raggruppaPerContractCodeSpedisci, trasmettiBorderoSpedisci } from '@/lib/spedisci'
import { confermaSpedizioniBrt } from '@/lib/brt'

export async function chiudiDistintaMista(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta) return { skip: true }
    // Solo distinte MISTE: quelle con un corriere unico le chiudono le chiud* dedicate.
    if (distinta.corriere_id) return { skip: true }
    // Gia' confermata: skip. Se era finita in ERRORE si RITENTA.
    if (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE')) return { skip: true }

    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: speds } = await admin
      .from('spedizioni').select('id, numero, tracking_number, raw_response, corriere_id').eq('distinta_id', distintaId)
    if (!speds?.length) return { errore: 'distinta senza spedizioni' }

    // Raggruppo per il corriere REALE di ogni spedizione (non per la distinta, che qui non ne ha uno).
    const perCorr = new Map<string, any[]>()
    for (const s of speds) {
      const cid = (s as any).corriere_id
      if (!cid) continue
      if (!perCorr.has(cid)) perCorr.set(cid, [])
      perCorr.get(cid)!.push(s)
    }
    const { data: corrieri } = await admin.from('corrieri').select('id, tipo, credenziali').in('id', Array.from(perCorr.keys()))
    const byId = new Map<string, any>((corrieri || []).map((c: any) => [c.id, c]))

    const borderoIds: string[] = []
    const errori: string[] = []
    for (const [cid, gruppo] of perCorr) {
      const corr = byId.get(cid)
      if (!corr) { errori.push('contratto sconosciuto'); continue }
      const cred = (corr.credenziali || {}) as any
      if (corr.tipo === 'gls') {
        const numeri = gruppo.map(numeroNudoGls).filter(Boolean)
        const r = await chiudiSpedizioniGls(cred, numeri)
        if (!r.ok) errori.push('GLS: ' + (r.errore || 'chiusura non confermata'))
      } else if (corr.tipo === 'spedisci') {
        const gruppi = raggruppaPerContractCodeSpedisci(gruppo)
        if (!gruppi.size) { errori.push('Spedisci: nessuna spedizione con shipmentId/contractCode'); continue }
        const r = await trasmettiBorderoSpedisci(cred, gruppi)
        if (r.ok) borderoIds.push(...r.ids)
        else errori.push('Spedisci: ' + (r.errore || 'chiusura non confermata'))
      } else if (corr.tipo === 'brt') {
        const refs = gruppo.map((s: any) => s.raw_response).filter((r: any) => r && r.numericRef)
          .map((r: any) => ({ numericRef: Number(r.numericRef), alphaRef: r.alphaRef || null }))
        const r = await confermaSpedizioniBrt(cred, refs)
        if (!r.ok) errori.push('BRT: ' + (r.errore || 'conferma non riuscita'))
      } else {
        // Difensivo: non deve capitare (il merge e' vincolato a un solo vettore fisico), ma se un tipo
        // non e' gestito lo diciamo forte invece di far finta di aver trasmesso.
        errori.push(`tipo ${corr.tipo} non gestito nel merge`)
      }
    }

    const ok = errori.length === 0
    await supabase.from('distinte').update({
      bordero_id: ok ? (borderoIds.length ? Array.from(new Set(borderoIds)).join(',') : 'N/A') : ('ERRORE: ' + errori.join(' | ').slice(0, 200)),
      ...(ok ? { confermata_vettore: true, data_conferma: new Date().toISOString() } : {}),
    }).eq('id', distintaId)
    return { ok, errore: ok ? null : errori.join(' | ') }
  } catch (e: any) {
    try { await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(e?.message || e).slice(0, 150) }).eq('id', distintaId) } catch {}
    return { errore: String(e?.message || e) }
  }
}
