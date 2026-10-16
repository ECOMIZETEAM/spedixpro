// Annullo DVA/easyparcel via STORNO (richiesta-storno), flusso ASINCRONO (B).
//
// La `richiesta-storno` di DVA non cancella all'istante: mette l'ordine in stato 13 ("storno
// richiesto"); gli operatori DVA verificano e, se ok, RIACCREDITANO e portano a stato 9 ("cancellato").
// Quindi NON si rimborsa la catena alla richiesta: si rimborsa SOLO a cancellazione confermata.
// La chiamata DVA rifiuta gia' di suo cio' che non e' stornabile (tracking presente, >1 mese, stato
// non ammesso, non pagato, contratto proprio) -> non si rimborsa mai un pacco in viaggio.
//
//   richiediStornoDva  -> chiede lo storno (solo_verifica=false). ammesso/gia_richiesto => stato
//                         'storno_richiesto' (niente rimborso); cancellato (gia' fatto) => annullata +
//                         rimborso; rifiutato => 'annullamento_manuale' col motivo.
//   riconciliaStornoDva-> per le 'storno_richiesto' (cron/solo_verifica): su 'cancellato' => annullata
//                         + rimborso; altrimenti resta in attesa.
//
// Il rimborso passa SEMPRE da rimborsaAnnulloSpedizione (idempotente per-movimento), il punto unico.
import { easyparcelStorno } from '@/lib/easyparcel'
import { rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'

export type SpedStorno = { id: string; numero: string; dest_nome?: string | null; stato?: string | null; corriere_id: string; raw_response: any; annullamento_da?: string | null }

// Stati locali in cui NON si tocca: difesa in piu' oltre al controllo DVA (che rifiuta gia' se c'e' tracking).
const STATI_INTOCCABILI = new Set(['consegnata', 'in_transito', 'in_consegna', 'in_giacenza', 'non_consegnato', 'reso_mittente', 'svincolata', 'annullata'])
const RIFIUTO_DEFINITIVO = new Set(['tracking_presente', 'stato_non_ammesso', 'non_pagato', 'oltre_un_mese', 'contratto_proprio', 'non_trovato'])
const TRANSITORIO = new Set(['tracking_non_verificabile', 'non_aggiornato'])

export function idOrdineEasyparcel(raw: any): number | null {
  const v = raw?._idOrdine ?? raw?.id_ordine ?? raw?.idOrdine ?? raw?.ordine?.id_ordine
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null
}
async function apikeyCorriere(admin: any, corriereId: string): Promise<string | null> {
  const { data } = await admin.from('corrieri').select('tipo,credenziali').eq('id', corriereId).maybeSingle()
  if ((data as any)?.tipo !== 'easyparcel') return null
  return ((data as any)?.credenziali)?.apikey || null
}
// annulla + rimborsa (il rimborso e' idempotente). Shopify fulfillment best-effort, come nelle altre porte.
async function annullaERimborsa(admin: any, sped: SpedStorno, createdBy: string | null) {
  await admin.from('spedizioni').update({ stato: 'annullata', annullamento_errore: null }).eq('id', sped.id)
  await rimborsaAnnulloSpedizione(admin, { id: sped.id, numero: sped.numero, dest_nome: sped.dest_nome }, createdBy)
  try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, [sped.id]) }
  catch (e) { console.error('[STORNO-DVA] shopify fulfillment:', (e as any)?.message) }
}

export type EsitoRichiesta = { azione: 'richiesto' | 'gia_cancellato' | 'manuale' | 'riprovare' | 'saltata'; codice: string; messaggio: string }

// RICHIEDE lo storno a DVA (solo_verifica=false) e aggiorna lo stato. Non rimborsa, TRANNE quando DVA
// risulta GIA' cancellato (certo => annullata + rimborso).
export async function richiediStornoDva(admin: any, sped: SpedStorno, createdBy: string | null): Promise<EsitoRichiesta> {
  if (sped.stato && STATI_INTOCCABILI.has(sped.stato) && sped.stato !== 'annullata') return { azione: 'saltata', codice: 'stato_locale', messaggio: `Moove: ${sped.stato}` }
  const apikey = await apikeyCorriere(admin, sped.corriere_id)
  const idOrdine = idOrdineEasyparcel(sped.raw_response)
  if (!apikey || !idOrdine) return { azione: 'manuale', codice: 'dati_mancanti', messaggio: 'apikey/id_ordine mancante' }
  const r = await easyparcelStorno(apikey, [idOrdine], false)
  const e = r.esiti[0]
  if (!e) return { azione: 'manuale', codice: 'nessun_esito', messaggio: 'DVA senza esito' }
  if (e.codice === 'cancellato') { await annullaERimborsa(admin, sped, createdBy || sped.annullamento_da || null); return { azione: 'gia_cancellato', codice: e.codice, messaggio: e.messaggio } }
  if (e.codice === 'ammesso' || e.codice === 'gia_richiesto') {
    // "Ammesso" ma NON registrato: e' successo a 5 spedizioni (13-16/10) che DVA, riletto, dava senza
    // richiesta. Resta comunque 'storno_richiesto': e' il cron a rimandarla (vedi riconciliaStorniDvaCron).
    if (e.codice === 'ammesso' && e.richiesto === false) console.warn('[STORNO-DVA] ammesso ma non registrato da DVA:', sped.numero, e.id_ordine, 'stato DVA', e.stato)
    await admin.from('spedizioni').update({ stato: 'storno_richiesto', annullamento_richiesto_at: new Date().toISOString(), annullamento_da: createdBy || sped.annullamento_da || null, annullamento_errore: null }).eq('id', sped.id)
    return { azione: 'richiesto', codice: e.codice, messaggio: e.messaggio }
  }
  if (TRANSITORIO.has(e.codice)) return { azione: 'riprovare', codice: e.codice, messaggio: e.messaggio }
  await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_errore: `Storno DVA non possibile: ${e.messaggio}`.slice(0, 200) }).eq('id', sped.id)
  return { azione: 'manuale', codice: e.codice, messaggio: e.messaggio }
}

export type EsitoRiconcilia = { azione: 'completato' | 'in_attesa' | 'manuale' | 'riprovare'; codice: string; messaggio: string }

// RICONCILIA una spedizione in 'storno_richiesto' (solo_verifica): su 'cancellato' -> annullata + rimborso.
export async function riconciliaStornoDva(admin: any, sped: SpedStorno): Promise<EsitoRiconcilia> {
  const apikey = await apikeyCorriere(admin, sped.corriere_id)
  const idOrdine = idOrdineEasyparcel(sped.raw_response)
  if (!apikey || !idOrdine) { await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_errore: 'storno: apikey/id_ordine mancante' }).eq('id', sped.id); return { azione: 'manuale', codice: 'dati_mancanti', messaggio: '' } }
  const r = await easyparcelStorno(apikey, [idOrdine], true)
  const e = r.esiti[0]
  if (!e) return { azione: 'riprovare', codice: 'nessun_esito', messaggio: '' }
  if (e.codice === 'cancellato') { await annullaERimborsa(admin, sped, sped.annullamento_da || null); return { azione: 'completato', codice: e.codice, messaggio: e.messaggio } }
  if (e.codice === 'gia_richiesto' || e.codice === 'ammesso') return { azione: 'in_attesa', codice: e.codice, messaggio: e.messaggio }
  await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_errore: `Storno non completato: ${e.messaggio}`.slice(0, 200) }).eq('id', sped.id)
  return { azione: 'manuale', codice: e.codice, messaggio: e.messaggio }
}

// CRON: riconcilia TUTTE le 'storno_richiesto'. Batch solo_verifica (500/chiamata, per apikey) -> su
// 'cancellato' annullata + rimborso; 'gia_richiesto' resta in attesa; altro codice -> manuale. Oltre
// GIORNI_TIMEOUT dalla richiesta -> manuale per revisione. Ritorna i conteggi.
// 'ammesso' in verifica vuol dire che DVA la richiesta NON ce l'ha (stato 6, non 13): il 16/10 erano 5
// su 96, e aspettarle non serviva a niente — nessuno a DVA le avrebbe mai lavorate, e dopo 10 giorni
// finivano in coda manuale con l'etichetta ancora valida. Si RIMANDA la richiesta. annullamento_richiesto_at
// resta quello della prima: il timeout conta da li', cosi' i rinvii hanno un termine.
const GIORNI_TIMEOUT = 10
export async function riconciliaStorniDvaCron(admin: any): Promise<{ completate: number; inCorso: number; rimandate: number; manuali: number; errori: number; totale: number }> {
  const { data: speds } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,corriere_id,raw_response,annullamento_da,annullamento_richiesto_at')
    .eq('stato', 'storno_richiesto').limit(2000)
  if (!speds?.length) return { completate: 0, inCorso: 0, rimandate: 0, manuali: 0, errori: 0, totale: 0 }
  const corrIds = [...new Set(speds.map((s: any) => s.corriere_id))]
  const { data: corrs } = await admin.from('corrieri').select('id,tipo,credenziali').in('id', corrIds)
  const apikeyDi = new Map<string, string>()
  for (const c of corrs || []) if ((c as any).tipo === 'easyparcel') { const k = ((c as any).credenziali)?.apikey; if (k) apikeyDi.set((c as any).id, k) }
  const perAk = new Map<string, { sped: any; id: number }[]>()
  for (const s of speds) { const io = idOrdineEasyparcel(s.raw_response); const ak = apikeyDi.get(s.corriere_id); if (io && ak) (perAk.get(ak) || perAk.set(ak, []).get(ak)!).push({ sped: s, id: io }) }
  let completate = 0, inCorso = 0, rimandate = 0, manuali = 0, errori = 0
  for (const [ak, arr] of perAk) {
    for (let i = 0; i < arr.length; i += 500) {
      const chunk = arr.slice(i, i + 500)
      const daRimandare: { sped: any; id: number }[] = []
      try {
        const r = await easyparcelStorno(ak, chunk.map(x => x.id), true)
        const byId = new Map(chunk.map(x => [x.id, x.sped]))
        for (const e of r.esiti) {
          const s = byId.get(e.id_ordine); if (!s) continue
          if (e.codice === 'cancellato') { await annullaERimborsa(admin, s, s.annullamento_da || null); completate++ }
          else if (e.codice === 'gia_richiesto' || e.codice === 'ammesso') {
            const giorni = s.annullamento_richiesto_at ? (Date.now() - new Date(s.annullamento_richiesto_at).getTime()) / 864e5 : 0
            if (giorni > GIORNI_TIMEOUT) { await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_errore: `Storno DVA non confermato dopo ${GIORNI_TIMEOUT} giorni: da verificare.` }).eq('id', s.id); manuali++ }
            else if (e.codice === 'ammesso') daRimandare.push({ sped: s, id: e.id_ordine })
            else inCorso++
          } else {
            await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_errore: `Storno non completato: ${e.messaggio}`.slice(0, 200) }).eq('id', s.id); manuali++
          }
        }
      } catch (e: any) { errori += chunk.length; console.error('[STORNO-DVA][CRON] batch:', e?.message); continue }
      if (!daRimandare.length) continue
      // Rinvio vero (solo_verifica=false), stesse regole di richiediStornoDva: niente rimborso finche'
      // DVA non risulta 'cancellato'.
      try {
        const r = await easyparcelStorno(ak, daRimandare.map(x => x.id), false)
        const byId = new Map(daRimandare.map(x => [x.id, x.sped]))
        for (const e of r.esiti) {
          const s = byId.get(e.id_ordine); if (!s) continue
          if (e.codice === 'cancellato') { await annullaERimborsa(admin, s, s.annullamento_da || null); completate++ }
          else if (e.codice === 'ammesso' || e.codice === 'gia_richiesto') { rimandate++; console.log('[STORNO-DVA][CRON] richiesta rimandata:', s.numero, e.id_ordine, 'registrata:', e.richiesto, 'stato DVA', e.stato) }
          else if (TRANSITORIO.has(e.codice)) inCorso++
          else { await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_errore: `Storno non completato: ${e.messaggio}`.slice(0, 200) }).eq('id', s.id); manuali++ }
        }
      } catch (e: any) { errori += daRimandare.length; console.error('[STORNO-DVA][CRON] rinvio:', e?.message) }
    }
  }
  return { completate, inCorso, rimandate, manuali, errori, totale: speds.length }
}
