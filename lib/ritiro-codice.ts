// IL CODICE DEL RITIRO SUI CONTRATTI DVA: dove si scrive, e chi lo va a prendere quando arriva tardi.
// (In fondo al file la stessa rincorsa per i ritiri SpediamoPro: codice del corriere e stato.)
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
  const s = await aggiungiARaw(admin, spedizioneId, { _codiceRitiro: codice })
  // Solo se la riga e' ancora vuota: una riga Ritiri puo' raccogliere piu' spedizioni, e il codice
  // che l'utente ha gia' visto non cambia sotto i suoi occhi.
  if (s?.ritiro_id) {
    await admin.from('ritiri').update({ cod_ritiro: codice, tracking_ritiro: codice })
      .eq('id', s.ritiro_id).is('cod_ritiro', null)
  }
}

// raw_response si rilegge adesso e si aggiungono solo le chiavi date: lo scrivono anche la creazione
// in background e il tracking, e una copia letta prima ne cancellerebbe i cambiamenti.
async function aggiungiARaw(admin: any, spedizioneId: string, chiavi: Record<string, any>): Promise<{ ritiro_id: string | null } | null> {
  const { data: s } = await admin.from('spedizioni').select('raw_response,ritiro_id').eq('id', spedizioneId).maybeSingle()
  if (!s) return null
  await admin.from('spedizioni')
    .update({ raw_response: { ...((s.raw_response as any) || {}), ...chiavi } })
    .eq('id', spedizioneId)
  return s
}

// COSA SI MOSTRA AL POSTO DEL CODICE, finche' manca. Il trattino non diceva niente: ne' a chi aspetta un
// codice in arrivo, ne' a chi ha il pacco ancora in negozio perche' il ritiro non e' mai stato
// confermato (Poste Business Express V dal Sud, dal 20/10/2026: "Not available" per giorni).
//   - "In attesa": il corriere scrive di aver inoltrato la richiesta (BRT, codice in arrivo in qualche
//     ora) e la rincorsa lo sta ancora cercando, oppure la richiesta ha meno di 2 ore, quando di norma
//     il codice arriva.
//   - "Non confermato": tutto il resto. E' alla lettera cio' che sappiamo: nessuna conferma.
// `testo` e' la frase del corriere salvata dalla rincorsa (raw_response._ritiroTesto); sulle
// spedizioni nate prima che la si salvasse manca, e decide l'eta'.
export type StatoCodiceRitiro = 'in_attesa' | 'non_confermato'
const ATTESA_NORMALE_MS = 2 * 3600 * 1000
// Oltre questa eta' la rincorsa smette di chiedere: se il codice non c'e', non arriva piu'.
const FINESTRA_RINCORSA_MS = 3 * 24 * 3600 * 1000
export function statoCodiceRitiro(creatoIl: string, testo: string | null, ora = Date.now()): StatoCodiceRitiro {
  const eta = ora - new Date(creatoIl).getTime()
  if (/RICHIESTA\s+INOLTRATA/i.test(String(testo || '')) && eta < FINESTRA_RINCORSA_MS) return 'in_attesa'
  return eta < ATTESA_NORMALE_MS ? 'in_attesa' : 'non_confermato'
}

// Per l'elenco Ritiri: aggiunge `codice_stato` alle righe dei contratti DVA ancora senza codice. Si legge
// col client di servizio solo il minimo (eta' e frase della prima spedizione della riga): l'utente
// riceve una delle due parole, mai la frase del corriere.
export async function etichettaRitiriSenzaCodice(admin: any, righe: any[]): Promise<void> {
  const vuote = (righe || []).filter((r: any) => !r.cod_ritiro && r.corriere_id)
  if (!vuote.length) return
  const corrIds = Array.from(new Set(vuote.map((r: any) => r.corriere_id)))
  const { data: corrs } = await admin.from('corrieri').select('id,tipo').in('id', corrIds)
  const dva = new Set((corrs || []).filter((c: any) => c.tipo === 'easyparcel').map((c: any) => c.id))
  const daGuardare = vuote.filter((r: any) => dva.has(r.corriere_id))
  if (!daGuardare.length) return
  // A blocchi: un .in() con centinaia di id fa un indirizzo troppo lungo, e la lettura fallisce
  // senza errore visibile (e' successo alla pulizia dei dati Amazon).
  const perRitiro = new Map<string, { created_at: string; testo: string | null }>()
  const ids = daGuardare.map((r: any) => r.id)
  for (let i = 0; i < ids.length; i += 150) {
    const { data: sped } = await admin.from('spedizioni')
      .select('ritiro_id,created_at,testo:raw_response->>_ritiroTesto')
      .in('ritiro_id', ids.slice(i, i + 150))
      .order('created_at', { ascending: true })
    for (const s of sped || []) if (!perRitiro.has(s.ritiro_id)) perRitiro.set(s.ritiro_id, { created_at: s.created_at, testo: s.testo })
  }
  const ora = Date.now()
  for (const r of daGuardare) {
    const s = perRitiro.get(r.id)
    r.codice_stato = statoCodiceRitiro(s?.created_at || r.created_at, s?.testo || null, ora)
  }
}

export type EsitoRincorsa = {
  candidate: number             // spedizioni col ritiro senza codice, ultimi 3 giorni
  chieste: number               // quelle a cui toccava in questo giro
  trovati: number               // codice arrivato e salvato
  minutiTrovati: number[]       // dopo quanto e' arrivato ciascun codice: misura le 2 ore di statoCodiceRitiro
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
  const esito: EsitoRincorsa = { candidate: 0, chieste: 0, trovati: 0, minutiTrovati: [], errori: 0, testi: {} }
  const avvio = Date.now()
  const { data: candidate, error } = await admin.from('spedizioni')
    .select('id,created_at,ep_ordine:raw_response->>_idOrdine,ep_testo:raw_response->>_ritiroTesto,corrieri!inner(tipo,credenziali)')
    .eq('corrieri.tipo', 'easyparcel')
    .eq('richiedi_ritiro', true)
    .is('raw_response->>_codiceRitiro', null)
    // Senza lettera di vettura il fornitore non ha nemmeno il codice: quelle le completa
    // lib/tmp-completa, che salva anche il codice quando arriva insieme al numero.
    .not('numero', 'like', 'TMP-%')
    .not('numero', 'like', 'DVA-%')
    .not('stato', 'in', '(annullata,storno_richiesto)')
    .gte('created_at', new Date(avvio - FINESTRA_RINCORSA_MS).toISOString())
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
          esito.minutiTrovati.push(Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000))
        } else {
          // La frase si tiene sulla spedizione, e si riscrive solo quando cambia: decide cosa vede
          // l'elenco Ritiri al posto del codice (statoCodiceRitiro).
          const testo = r.testo.slice(0, 80)
          if (testo && testo !== s.ep_testo) await aggiungiARaw(admin, s.id, { _ritiroTesto: testo })
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// RITIRI SPEDIAMOPRO: IL CODICE DEL CORRIERE E LO STATO, RILETTI FINCHE' IL RITIRO E' APERTO
// Su BRT il codice dato alla prenotazione era il numero interno del fornitore (3404709), che in filiale
// non conosce nessuno: il numero di prenotazione BRT (CUR4448310) arriva solo quando la prenotazione
// passa a BRT — in giornata per i ritiri di oggi, il giorno dopo per quelli di domani — e dal 21/09/2026
// non l'avevamo su nessuno (circa 2.400 ritiri a settimana). Lo stato si rileggeva solo aprendo l'elenco,
// 40 righe alla volta: ritiri gia' fatti restavano "Richiesto". Qui si rileggono entrambi da soli.
// Cosa cambia su una riga lo decide aggiornamentoRitiroSpediamopro (lib/ritiro-spediamopro).
// ═══════════════════════════════════════════════════════════════════════════════════════
export type EsitoRitiriSpediamopro = {
  candidate: number             // ritiri aperti nella finestra
  chieste: number               // riletti in questo giro
  codici: number                // codice del corriere arrivato e scritto
  stati: Record<string, number> // stati cambiati, per stato nuovo
  errori: number
}

// Ogni quanti giri si rilegge un ritiro, secondo il giorno del ritiro. Quelli di oggi cambiano piu' spesso
// (confermato, ritirato); quelli di domani aspettano solo di passare al corriere; quelli di ieri raramente
// cambiano ancora (circa un terzo dei BRT in giornata resta "confermato" e senza numero BRT per sempre).
function periodoGiriRitiro(dataRitiro: string, oggi: string): number {
  if (dataRitiro === oggi) return 5          // ogni 10 minuti
  if (dataRitiro > oggi) return 15           // ogni 30 minuti
  return 30                                  // ieri: ogni ora
}

export async function rincorriRitiriSpediamopro(
  admin: any,
  // `dalGiorno` e `tutti` servono al recupero una tantum: finestra piu' lunga, ogni ritiro a ogni passata.
  opts: { budgetMs?: number; dalGiorno?: string; tutti?: boolean } = {},
): Promise<EsitoRitiriSpediamopro> {
  const esito: EsitoRitiriSpediamopro = { candidate: 0, chieste: 0, codici: 0, stati: {}, errori: 0 }
  const avvio = Date.now()
  const { giornoRoma, giorniFaRoma } = await import('@/lib/date-roma')
  // Stretta: se una pagina non si legge lancia, invece di restituire un elenco vuoto o tagliato e far
  // sembrare che non ci sia niente da fare.
  const { fetchAllStretto } = await import('@/lib/fetch-all')
  const { aggiornamentoRitiroSpediamopro, STATI_RITIRO_FINALI } = await import('@/lib/ritiro-spediamopro')
  const { spediamoproGetPickup, getSpediamoproToken } = await import('@/lib/spediamopro')
  const oggi = giornoRoma()
  const dal = opts.dalGiorno ?? giorniFaRoma(1)

  const { data: corrs, error: errC } = await admin.from('corrieri').select('id,credenziali').eq('tipo', 'spediamopro')
  if (errC) { console.error('[RITIRO-SP] lettura dei contratti', errC.message); esito.errori++; return esito }
  const authcode = new Map<string, string>((corrs || []).filter((c: any) => c.credenziali?.authcode).map((c: any) => [c.id, String(c.credenziali.authcode)]))
  if (!authcode.size) return esito

  // Sempre ordinate anche per id: si legge a pagine da 1.000, e con lo stesso giorno le righe cambierebbero
  // posto fra una pagina e l'altra (doppie o perse). Dal giorno piu' lontano al piu' vicino all'indietro: se il
  // tempo finisce, resta indietro ieri, non oggi e domani.
  let righe: any[] = []
  try {
    righe = await fetchAllStretto(() => admin.from('ritiri')
      .select('id,stato,cod_ritiro,pickup_id,data_ritiro,corriere_id')
      .in('corriere_id', [...authcode.keys()])
      .not('pickup_id', 'is', null)
      .gte('data_ritiro', dal)
      .not('stato', 'in', `(${STATI_RITIRO_FINALI.join(',')})`)
      .order('data_ritiro', { ascending: false }).order('id', { ascending: true }))
  } catch (e: any) { console.error('[RITIRO-SP] lettura dei ritiri', e?.message); esito.errori++; return esito }
  esito.candidate = righe.length

  const giro = Math.round(avvio / GIRO_MS)
  const daChiedere = opts.tutti ? righe : righe.filter((r: any) => tocca(String(r.id), periodoGiriRitiro(String(r.data_ritiro), oggi), giro))
  const budget = opts.budgetMs ?? 40000
  if (!daChiedere.length) return esito
  // Il token una volta per contratto prima di partire: con la cache vuota le prime otto letture in parallelo
  // ne chiederebbero otto.
  for (const ac of new Set(daChiedere.map((r: any) => authcode.get(r.corriere_id)!))) {
    try { await getSpediamoproToken(ac) } catch (e: any) { console.error('[RITIRO-SP] token', e?.message); esito.errori++; return esito }
  }
  // Il fornitore risponde in ~0,1 secondi a lettura (misurato il 25/11 su 240 ritiri). Una lettura appesa non
  // deve tenere fermo il giro, che gira insieme a quello DVA dentro lo stesso minuto: dopo 10 secondi si lascia.
  const ATTESA_MAX_MS = 10000
  const PARALLELE = 8
  for (let i = 0; i < daChiedere.length; i += PARALLELE) {
    if (Date.now() - avvio > budget) break
    await Promise.all(daChiedere.slice(i, i + PARALLELE).map(async (r: any) => {
      esito.chieste++
      try {
        const pk = await Promise.race([
          spediamoproGetPickup(authcode.get(r.corriere_id)!, Number(r.pickup_id)),
          new Promise((_, no) => setTimeout(() => no(new Error('tempo scaduto')), ATTESA_MAX_MS)),
        ]) as any
        if (!pk) { esito.errori++; return }
        const upd = aggiornamentoRitiroSpediamopro(r, pk)
        if (!Object.keys(upd).length) return
        const { error } = await admin.from('ritiri').update(upd).eq('id', r.id)
        if (error) { console.error('[RITIRO-SP] scrittura', r.id, error.message); esito.errori++; return }
        if (upd.cod_ritiro) esito.codici++
        if (upd.stato) esito.stati[upd.stato] = (esito.stati[upd.stato] || 0) + 1
      } catch { esito.errori++ }
    }))
  }
  return esito
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// RITIRI POSTE: LO STATO DALLA PAGINA DEI RITIRI DI poste.it, PIANO
// Per i codici CP… (SDA EXPRESS L, Poste V, Poste su Spedisci, PDB L) nessun fornitore ci dice com'e' andato il
// ritiro: restavano "Richiesto" per sempre. Lo dice la pagina pubblica dei ritiri di Poste ("Cerca Ritiri",
// trovata da Lorenzo il 25/11/2026), con un servizio che risponde per codice. Misurato su 60 ritiri veri:
//   100 SPEDIZIONE RITIRATA · 118 RITIRO GIA' EFFETTUATO IN GIORNATA · XXX DA EFFETTUARE
//   ANN Prenotazione di ritiro annullata — su tutti quelli guardati il pacco era gia' partito PRIMA del giorno
//       del ritiro: Poste annulla la prenotazione perche' l'ha gia' preso.
//   102 NULLA DA RITIRARE — il corriere e' passato e non c'era niente: "Annullato dal corriere" (Lorenzo, 25/11).
// I codici mai visti non cambiano lo stato: finiscono nei log, per decidere dopo.
//
// PIANO, per scelta di Lorenzo: da poste.it leggiamo anche il tracking (bonifica-poste), e un blocco per troppe
// richieste toglierebbe entrambi. Massimo 20 letture per giro, una ogni 1,5 secondi, al primo errore ci si
// ferma. Si leggono solo i ritiri di ieri e, dal pomeriggio, quelli di oggi: quelli futuri direbbero solo "da
// effettuare". Prima quelli mai letti (ancora "Richiesto"), poi a rotazione quelli rimasti "da effettuare".
// ═══════════════════════════════════════════════════════════════════════════════════════
export function statoRitiroPoste(codice: unknown): string | null {
  switch (String(codice ?? '')) {
    case '100': case '118': return 'ritirato'
    case 'XXX': return 'confermato'
    case 'ANN': return 'annullato'
    case '102': return 'annullato_corriere'
    default: return null
  }
}

export async function leggiStatoRitiroPoste(codice: string): Promise<{ ok: boolean; codice?: string; descrizione?: string; trovato?: boolean; http: number }> {
  const res = await fetch(`https://www.poste.it/rest/prenota-ritiri-rest/api/ritiro?param=${encodeURIComponent(codice)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: 'https://www.poste.it/prenota-ritiri/index.html' },
    signal: AbortSignal.timeout(10000),
  })
  const testo = await res.text()
  let j: any = null
  try { j = JSON.parse(testo) } catch { /* una pagina HTML al posto del JSON e' un rifiuto */ }
  if (!res.ok || !j) return { ok: false, http: res.status }
  // "La ricerca non ha prodotto risultati" (PR1106): Poste non conosce il codice. Non e' un errore del giro.
  if (String(j.code) !== '0') return { ok: true, trovato: false, http: res.status }
  return { ok: true, trovato: true, codice: String(j?.data?.status?.code ?? ''), descrizione: String(j?.data?.status?.description ?? ''), http: res.status }
}

export type EsitoRitiriPoste = {
  candidate: number; lette: number; stati: Record<string, number>; nonTrovati: number
  sconosciuti: Record<string, number>  // codice Poste mai visto → quante volte (con la sua descrizione)
  fermo: string | null                 // perche' il giro si e' fermato prima (rifiuto di poste.it)
}

export async function rincorriRitiriPoste(admin: any, opts: { max?: number; pausaMs?: number } = {}): Promise<EsitoRitiriPoste> {
  const esito: EsitoRitiriPoste = { candidate: 0, lette: 0, stati: {}, nonTrovati: 0, sconosciuti: {}, fermo: null }
  const max = opts.max ?? 20
  const pausa = opts.pausaMs ?? 1500
  const { giornoRoma, giorniFaRoma } = await import('@/lib/date-roma')
  const { fetchAllStretto } = await import('@/lib/fetch-all')
  const oggi = giornoRoma()
  const ieri = giorniFaRoma(1)
  const oraRoma = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const giorni = oraRoma >= 15 ? [ieri, oggi] : [ieri]

  // I ritiri SpediamoPro hanno gia' lo stato dal fornitore (rincorriRitiriSpediamopro): qui tutti gli altri.
  let righe: any[] = []
  try {
    righe = await fetchAllStretto(() => admin.from('ritiri')
      .select('id,stato,cod_ritiro,data_ritiro,corrieri!inner(tipo)')
      .neq('corrieri.tipo', 'spediamopro')
      .like('cod_ritiro', 'CP%')
      .in('data_ritiro', giorni)
      .not('stato', 'in', '(ritirato,annullato,annullato_corriere,errore)')
      .order('data_ritiro', { ascending: true }).order('id', { ascending: true }))
  } catch (e: any) { esito.fermo = 'lettura dei ritiri: ' + e?.message; return esito }
  righe = righe.filter((r: any) => /^CP\d{9}$/.test(String(r.cod_ritiro)))
  esito.candidate = righe.length

  const maiLetti = righe.filter((r: any) => r.stato === 'richiesto')
  const daRileggere = righe.filter((r: any) => r.stato !== 'richiesto')
  const giro = Math.round(Date.now() / (10 * 60 * 1000))
  const periodo = Math.max(1, Math.ceil(daRileggere.length / max))
  const scelti = [...maiLetti, ...daRileggere.filter((r: any) => tocca(String(r.id), periodo, giro))].slice(0, max)

  // 45 secondi al massimo: il giro ne ha 60, e una poste.it lenta (10 secondi a lettura) non deve farlo morire.
  const avvio = Date.now()
  for (const r of scelti) {
    if (Date.now() - avvio > 45000) break
    let l
    try { l = await leggiStatoRitiroPoste(String(r.cod_ritiro)) } catch (e: any) { esito.fermo = 'poste.it non risponde: ' + String(e?.message || e).slice(0, 80); break }
    if (!l.ok) { esito.fermo = `poste.it ha risposto ${l.http}`; break }
    esito.lette++
    if (!l.trovato) esito.nonTrovati++
    else {
      const stato = statoRitiroPoste(l.codice)
      if (!stato) { const k = `${l.codice} ${String(l.descrizione).slice(0, 50)}`; esito.sconosciuti[k] = (esito.sconosciuti[k] || 0) + 1 }
      else if (stato !== r.stato) {
        const { error } = await admin.from('ritiri').update({ stato }).eq('id', r.id)
        if (error) { esito.fermo = 'scrittura: ' + error.message; break }
        esito.stati[stato] = (esito.stati[stato] || 0) + 1
      }
    }
    await new Promise(ok => setTimeout(ok, pausa))
  }
  return esito
}
