import { mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'

// TRACKING PUBBLICO GLS — nessuna credenziale.
//
// Le spedizioni GLS-via-spedisci (rivendita mclogistica/ecc.) prendono gli eventi SOLO dal webhook
// spedisci; ma per gli account il cui secret di firma non abbiamo (es. spedizionivarriale, easysped2)
// il webhook viene rifiutato (401) e la spedizione resta ferma, e il polling tracking di spedisci e'
// chiuso ("use the Webhooks"). Il secret vive solo nel pannello web, non e' leggibile via API.
//
// Questo e' il tracking PUBBLICO del sito gls-group.com (quello della pagina "ricerca spedizioni"):
// per LDV, senza chiavi. Ci rende la cronologia completa, quindi copre sia l'ARRETRATO (ricostruisce
// tutta la storia, anche la consegna gia' avvenuta) sia il futuro. I "cookie" del curl sono solo
// consenso, non servono. Best-effort: ok=false su rete/errore/"non trovata"/errore-di-sistema.
//
// La mappatura stato riusa mapStatoSpedisci/prioritaStato: STESSE regole del webhook, un posto solo.

export type GlsEvento = { stato: string | null; descrizione: string; luogo: string | null; data_evento: string }
export type GlsTracking = {
  ok: boolean
  eventi: GlsEvento[]
  statoAvanzato: string | null
  motivo?: string        // perche' ok=false (non-trovata, errore-sistema, rete...) — per i log/diagnostica
}

// "2026-09-03" + "18:42:00" (ora italiana) -> ISO con l'offset giusto (come il parseData del webhook).
function dataIso(date?: string, time?: string): string {
  const d = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!d) return new Date().toISOString()
  const mese = Number(d[2])
  const off = (mese >= 4 && mese <= 10) ? '+02:00' : '+01:00'   // DST IT approssimata (come il webhook)
  const t = String(time || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?/)
  const hhmmss = t ? `${t[1]}:${t[2]}:${t[3] || '00'}` : '00:00:00'
  return `${d[1]}-${d[2]}-${d[3]}T${hhmmss}${off}`
}

export async function glsTrackingPubblico(ldv: string, tipo: string = 'NAT'): Promise<GlsTracking> {
  const out: GlsTracking = { ok: false, eventi: [], statoAvanzato: null }
  const tn = String(ldv || '').replace(/\s+/g, '').trim()
  if (!tn) { out.motivo = 'ldv-vuota'; return out }
  // millis: solo cache-buster lato GLS. caller=witt002 e' il chiamante pubblico del sito.
  const url = `https://gls-group.com/app/service/open/rest/IT/it/rstt030?match=${encodeURIComponent(tn)}&type=${encodeURIComponent(tipo)}&caller=witt002&millis=${Date.now()}`
  let data: any
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) { out.motivo = 'http-' + res.status; return out }
    data = await res.json()
  } catch (e: any) { out.motivo = 'rete:' + (e?.message || 'x'); return out }

  // "Non sono stati trovati risultati" / "Errore di sistema ... riprovare" -> non concludo nulla.
  if (data?.exceptionText) { out.motivo = String(data.exceptionText).replace(/<[^>]+>/g, ' ').slice(0, 120); return out }

  const tu = Array.isArray(data?.tuStatus) ? data.tuStatus[0] : null
  const history: any[] = Array.isArray(tu?.history) ? tu.history : []
  if (!tu) { out.motivo = 'no-tuStatus'; return out }

  out.eventi = history.map((h: any) => {
    const descr = String(h?.evtDscr || '').trim()
    return {
      stato: mapStatoSpedisci(descr),
      descrizione: descr.slice(0, 300),
      luogo: (String(h?.address?.city || '').trim() || null),
      data_evento: dataIso(h?.date, h?.time),
    }
  }).filter((e: GlsEvento) => e.descrizione)

  for (const e of out.eventi) if (e.stato && prioritaStato(e.stato) > prioritaStato(out.statoAvanzato)) out.statoAvanzato = e.stato
  out.ok = true
  return out
}

// AGGIORNA UN BATCH di spedizioni GLS-via-spedisci dal tracking pubblico GLS.
// Sostituisce la cronologia eventi (arriva completa a ogni giro, come dal webhook) e fa AVANZARE lo
// stato con le STESSE guardie del webhook (mai declassare, consegnata/annullata terminali, la consegna
// del reso non riapre). Le meno aggiornate per prime (tracking_check_at) -> round-robin.
//
// SOLDI: NON tocca MAI `giacenza_data` (il trigger di addebito scatta solo su quella colonna). Quindi
// registra lo stato 'in_giacenza' per la visibilita', ma NON addebita retroattivamente le giacenze
// vecchie del backfill. L'eventuale addebito delle giacenze su questi account e' una scelta a parte.
export async function aggiornaGlsSpedisci(
  admin: any,
  opts: { limit?: number; dryRun?: boolean; concorrenza?: number; soloCorriereIds?: string[]; soloSenzaEventi?: boolean } = {}
): Promise<any> {
  const limit = opts.limit ?? 150
  const conc = Math.max(1, Math.min(opts.concorrenza ?? 5, 8))
  let q = admin.from('spedizioni')
    .select('id,stato,tracking_number,giacenza_data,corrieri!inner(tipo,nome_contratto)')
    .eq('corrieri.tipo', 'spedisci')
    .ilike('corrieri.nome_contratto', 'GLS%')
    .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale,reso_mittente)')
    .not('tracking_number', 'is', null)
    .order('tracking_check_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  // Backfill mirato: solo alcuni contratti (gli account il cui webhook non consegna).
  if (opts.soloCorriereIds?.length) q = q.in('corriere_id', opts.soloCorriereIds)
  const { data: speds } = await q
  const lista: any[] = speds || []
  let esaminate = 0, con_eventi = 0, aggiornate = 0, non_trovate = 0, errori = 0, giacenze = 0
  const cambi: any[] = []

  for (let i = 0; i < lista.length; i += conc) {
    const chunk = lista.slice(i, i + conc)
    await Promise.all(chunk.map(async (s: any) => {
      esaminate++
      const r = await glsTrackingPubblico(s.tracking_number)
      if (!r.ok) {
        if (/trovat/i.test(r.motivo || '')) non_trovate++; else errori++
        if (!opts.dryRun) await admin.from('spedizioni').update({ tracking_check_at: new Date().toISOString() }).eq('id', s.id)
        return
      }
      con_eventi++
      const avanzato = r.statoAvanzato
      const deveAvanzare = !!avanzato && s.stato !== 'consegnata' && s.stato !== 'annullata'
        && prioritaStato(avanzato) > prioritaStato(s.stato)
        && !(s.stato === 'reso_mittente' && avanzato === 'consegnata')
      if (r.eventi.some((e: GlsEvento) => e.stato === 'in_giacenza')) giacenze++
      if (opts.dryRun) { cambi.push({ ldv: s.tracking_number, da: s.stato, a: deveAvanzare ? avanzato : s.stato, eventi: r.eventi.length }); return }
      try {
        await admin.from('tracking_events').delete().eq('spedizione_id', s.id)
        if (r.eventi.length) await admin.from('tracking_events').insert(r.eventi.map((e: GlsEvento) => ({ spedizione_id: s.id, ...e })))
      } catch { /* best-effort: l'evento non salvato non blocca l'avanzamento */ }
      const upd: any = { tracking_check_at: new Date().toISOString() }
      if (deveAvanzare) { upd.stato = avanzato; aggiornate++ }
      // NB: MAI upd.giacenza_data -> nessun addebito (vedi sopra).
      await admin.from('spedizioni').update(upd).eq('id', s.id)
    }))
  }
  const esito: any = { esaminate, con_eventi, aggiornate, non_trovate, errori, giacenze }
  if (opts.dryRun) esito.cambi = cambi
  return esito
}
