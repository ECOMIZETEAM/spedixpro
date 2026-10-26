// IL CODICE DEL RITIRO SUI CONTRATTI DVA: dove si scrive, e chi lo va a prendere quando arriva tardi.
//
// Su questi contratti il ritiro si prenota insieme all'ordine e il corriere comunica il codice insieme
// alla lettera di vettura — ma non sempre subito. Dal 25/10/2026 su BRT 2025 V al suo posto c'e'
// "RICHIESTA INOLTRATA IL <data>" e il codice arriva ore dopo; su Poste di solito in pochi minuti.
// La creazione lo aspetta 30 secondi. Dopo, l'unico che lo andava a riprendere era il giro del
// tracking, che passa su ogni spedizione circa ogni 7 ore (57.000 spedizioni attive al 26/10).
// Misurato il 26/10: 41 ritiri col codice gia' pronto presso il fornitore e il trattino nell'elenco
// Ritiri, che e' proprio dove il cliente lo cerca per consegnare il pacco.

// LA SCRITTURA. Il codice vive in due posti: sulla spedizione (raw_response._codiceRitiro, lo leggono
// l'API, il riepilogo della creazione e /api/ritiri/crea) e sulla riga dell'elenco Ritiri. Chiunque lo
// trovi passa da qui, cosi' i due posti non si separano.
export async function salvaCodiceRitiro(admin: any, spedizioneId: string, codice: string): Promise<void> {
  // raw_response si rilegge adesso e si aggiunge una chiave sola: lo scrivono anche la creazione in
  // background e il tracking, e una copia letta prima ne cancellerebbe i cambiamenti.
  const { data: s } = await admin.from('spedizioni').select('raw_response,ritiro_id').eq('id', spedizioneId).maybeSingle()
  if (!s) return
  await admin.from('spedizioni')
    .update({ raw_response: { ...((s.raw_response as any) || {}), _codiceRitiro: codice } })
    .eq('id', spedizioneId)
  // Solo se la riga e' ancora vuota: una riga Ritiri puo' raccogliere piu' spedizioni, e il codice
  // che l'utente ha gia' visto non cambia sotto i suoi occhi.
  if (s.ritiro_id) {
    await admin.from('ritiri').update({ cod_ritiro: codice, tracking_ritiro: codice })
      .eq('id', s.ritiro_id).is('cod_ritiro', null)
  }
}

export type EsitoRincorsa = {
  candidate: number             // spedizioni col ritiro senza codice, ultimi 3 giorni
  chieste: number               // quelle a cui toccava in questo giro
  trovati: number               // codice arrivato e salvato
  errori: number
  testi: Record<string, number> // cosa scrive il fornitore al posto del codice (per i log)
}

// Ogni quanto gira la rincorsa (vercel.json): serve a calcolare il turno di ciascuna spedizione.
const GIRO_MS = 2 * 60 * 1000

// QUANTO SPESSO SI RICHIEDE, secondo l'eta' della spedizione. Il codice arriva quasi sempre nella
// prima ora, e li' si chiede a ogni giro. Dopo arriva di rado (BRT: ore); sui ritiri dal Sud di Poste
// Business Express V dal 20/10/2026 non arriva affatto ("Not available" anche cinque giorni dopo, 366
// ritiri su 366). Chiedere ogni 2 minuti per tre giorni centinaia di spedizioni che non cambieranno
// sarebbe solo carico, nostro e del fornitore.
function periodoGiri(etaMs: number): number {
  if (etaMs <= 3600 * 1000) return 1         // prima ora: ogni giro (2 minuti)
  if (etaMs <= 12 * 3600 * 1000) return 5    // fino a 12 ore: ogni 10 minuti
  return 30                                  // poi ogni ora, fino ai 3 giorni
}

// Il turno si ricava dall'id, senza scrivere niente: ogni spedizione ha un suo posto fisso dentro il
// periodo, cosi' quelle nate nella stessa ora non si presentano tutte nello stesso giro.
function tocca(id: string, periodo: number, giro: number): boolean {
  if (periodo <= 1) return true
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h + giro) % periodo === 0
}

export async function rincorriCodiciRitiro(admin: any, opts: { budgetMs?: number } = {}): Promise<EsitoRincorsa> {
  const esito: EsitoRincorsa = { candidate: 0, chieste: 0, trovati: 0, errori: 0, testi: {} }
  const avvio = Date.now()
  const { data: candidate, error } = await admin.from('spedizioni')
    .select('id,created_at,ep_ordine:raw_response->>_idOrdine,corrieri!inner(tipo,credenziali)')
    .eq('corrieri.tipo', 'easyparcel')
    .eq('richiedi_ritiro', true)
    .is('raw_response->>_codiceRitiro', null)
    // Senza lettera di vettura il fornitore non ha nemmeno il codice: quelle le completa
    // lib/tmp-completa, che salva anche il codice quando arriva insieme al numero.
    .not('numero', 'like', 'TMP-%')
    .not('numero', 'like', 'DVA-%')
    .not('stato', 'in', '(annullata,storno_richiesto)')
    // Tre giorni: se dopo tre giorni il codice non c'e', non arriva piu'.
    .gte('created_at', new Date(avvio - 3 * 24 * 3600 * 1000).toISOString())
    // Le piu' recenti per prime: se il giro finisce il tempo, resta indietro chi aspetta da piu' tempo
    // e ha meno probabilita' di ricevere il codice.
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) { console.error('[RITIRO-CODICE] lettura delle spedizioni', error.message); esito.errori++; return esito }
  esito.candidate = (candidate || []).length

  // round e non floor: il cron parte a minuti pari ma con qualche secondo di scarto, e il turno deve
  // restare quello del minuto nominale.
  const giro = Math.round(avvio / GIRO_MS)
  const daChiedere = (candidate || []).filter((s: any) => s.ep_ordine && (s.corrieri as any)?.credenziali?.apikey
    && tocca(String(s.id), periodoGiri(avvio - new Date(s.created_at).getTime()), giro))
  if (!daChiedere.length) return esito

  const { easyparcelCodiceRitiro } = await import('@/lib/easyparcel')
  const budget = opts.budgetMs ?? 40000
  // Il fornitore risponde in ~2,3 secondi a domanda: in fila ne passerebbero quindici per giro.
  const PARALLELE = 8
  for (let i = 0; i < daChiedere.length; i += PARALLELE) {
    if (Date.now() - avvio > budget) break
    await Promise.all(daChiedere.slice(i, i + PARALLELE).map(async (s: any) => {
      esito.chieste++
      try {
        const r = await easyparcelCodiceRitiro(String((s.corrieri as any).credenziali.apikey), String(s.ep_ordine))
        if (r.codiceRitiro) {
          await salvaCodiceRitiro(admin, s.id, r.codiceRitiro)
          esito.trovati++
        } else {
          // Le date e i numeri fuori, cosi' le frasi uguali si contano insieme. Una frase nuova nei
          // log e' il segnale che il fornitore ha cambiato qualcosa, come il 25/10 su BRT.
          const k = (r.testo.replace(/\d[\d\-/.:]*/g, '#') || '(vuoto)').slice(0, 40)
          esito.testi[k] = (esito.testi[k] || 0) + 1
        }
      } catch { esito.errori++ }
    }))
  }
  return esito
}
