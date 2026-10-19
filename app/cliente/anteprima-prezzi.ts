'use client'
/* ANTEPRIMA DEI PREZZI nel portale cliente: import da file e ordini dei negozi.
 *
 * Le due pagine facevano gia' la stessa cosa — chiedere le tariffe di ogni ordine e scegliere il
 * contratto — ma solo DOPO il clic su "Spedisci", ognuna con una copia sua della scelta (una
 * prendeva il minimo con un ciclo, l'altra il primo dell'elenco). Il prezzo non si vedeva mai prima.
 *
 * Qui c'e' il pezzo che le due pagine condividono:
 *   - chiediPrezzi()        la chiamata al server, a blocchi;
 *   - scegliTariffa()       LA regola "prezzo minore / contratto X". Una sola, usata sia per mostrare
 *                           sia per spedire: se fossero due, prima o poi mostrerebbero un contratto
 *                           e spedirebbero con un altro;
 *   - useAnteprimaPrezzi()  tiene i prezzi delle righe a schermo e li ricalcola quando cambia cio'
 *                           che entra nel prezzo (peso, misure, destinazione, contrassegno, mittente).
 *                           NON li ricalcola da solo col passare del tempo: se nel frattempo cambia
 *                           il listino, il prezzo a schermo resta quello di prima finche' non si
 *                           clicca "Spedisci" — che ricalcola sempre tutto, chiede conferma se
 *                           qualcosa e' cambiato e rimette a schermo i prezzi nuovi.
 *
 * Cambiare "prezzo minore" con "contratto X" NON richiama il server: per ogni ordine arriva
 * l'elenco di tutti i contratti disponibili, e la scelta si rifa' qui. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Collo } from '@/lib/colli-ordine'

export type TariffaAnteprima = { corriere_id: string; nome: string; prezzo: number }

// Cio' che entra nel prezzo di un ordine. La pagina costruisce da QUESTO oggetto sia la riga
// dell'anteprima sia i dati mandati alla creazione: stessi valori, stesso prezzo.
export type RigaPrezzo = {
  id: string
  cap: string
  citta: string
  provincia: string
  paese: string
  // I colli con cui l'ordine parte: sono i `packages` della creazione, nello stesso ordine.
  colli: Collo[]
  contrassegno: number
  haContenuto: boolean
}

export type MittentePrezzo = { cap: string; provincia: string }

export type EsitoPrezzo =
  | { stato: 'calcolo' }
  | { stato: 'ok'; tariffe: TariffaAnteprima[] }
  // riprovabile = non e' un rifiuto ma un inciampo (rete, server): la pagina offre "Riprova".
  | { stato: 'errore'; errore: string; riprovabile?: boolean }

// Quanti ordini per chiamata (il server ne accetta al massimo 25).
const RIGHE_PER_CHIAMATA = 20

const NON_CALCOLATO = 'Prezzo non calcolato: riprova tra poco.'
const NESSUN_CORRIERE = 'Nessun corriere disponibile per questa spedizione.'

// Un inciampo si ritenta da solo due volte, a distanza; poi ci si ferma e resta "Riprova" sulla riga.
// Senza un tetto, un server che non risponde verrebbe richiamato all'infinito da ogni pagina aperta.
const RIPROVE_AUTOMATICHE = 2
const ATTESA_RIPROVA_MS = 8000

// LA SCELTA DEL CONTRATTO. `scelta` e' il valore della tendina "Spedisci con": 'min' / 'auto' =
// prezzo minore, altrimenti l'id di un contratto. Le tariffe arrivano gia' ordinate dal server dalla
// piu' economica, quindi "prezzo minore" e' la prima. Con un contratto preciso NON c'e' ripiego: se
// per quell'ordine non e' disponibile torna null, e la pagina lo dice invece di spedire con un altro.
export function scegliTariffa(tariffe: TariffaAnteprima[], scelta: string): TariffaAnteprima | null {
  if (!tariffe.length) return null
  if (!scelta || scelta === 'min' || scelta === 'auto') return tariffe[0]
  return tariffe.find(t => String(t.corriere_id) === String(scelta)) || null
}

export const euro = (n: number): string =>
  '€ ' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Cambia quando cambia QUALSIASI dato che entra nel prezzo: e' cosi' che l'anteprima sa di dover
// ricalcolare (un altro pacco predefinito, un ordine unito, un indirizzo di partenza diverso).
export function firmaRiga(r: RigaPrezzo, m: MittentePrezzo): string {
  return JSON.stringify([r.cap, r.citta, r.provincia, r.paese, r.colli.map(c => [c.weight, c.length, c.width, c.height]), r.contrassegno, r.haContenuto, m.cap, m.provincia])
}

// `riprova` = il server non e' riuscito a calcolare QUELLA riga per un errore tecnico.
export type RispostaRiga = { tariffe: TariffaAnteprima[]; errore?: string; riprova?: boolean }

// UN RIFIUTO NON E' UN INCIAMPO. 400, 401 e 403 vogliono dire che la rotta ha deciso di non
// rispondere (cliente senza permesso di inserire, sessione scaduta, mittente incompleto): riprovare
// non cambia niente, e il testo del server dice perche'. Trattati come un inciampo, chi non puo'
// inserire spedizioni leggerebbe "riprova tra poco" all'infinito senza mai sapere il motivo.
export const eUnRifiuto = (e: any): boolean => e?.stato === 400 || e?.stato === 401 || e?.stato === 403
export const testoDelRifiuto = (e: any): string =>
  e?.stato === 401 ? 'Sessione scaduta: ricarica la pagina e accedi di nuovo.' : String(e?.message || 'Calcolo dei prezzi non consentito.')

// `collo` accanto a `colli`: e' la forma che la rotta conosceva prima del 19/10/2026 (un collo col
// peso intero e le misure del primo). La rotta di oggi lo ignora quando ci sono i colli; serve se si
// torna a una versione precedente con pagine gia' aperte, che altrimenti senza `collo` prezzerebbe
// ogni ordine su 1 kg — e la creazione addebiterebbe poi il prezzo vero, piu' alto di quello mostrato.
const conColloDiPrima = (r: RigaPrezzo) => ({
  ...r,
  collo: { ...r.colli[0], weight: r.colli.reduce((s, c) => s + (Number(c.weight) || 0), 0) },
})

async function chiediBlocco(righe: RigaPrezzo[], mittente: MittentePrezzo): Promise<Map<string, RispostaRiga>> {
  const res = await fetch('/api/cliente/anteprima-prezzi', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mittente, righe: righe.map(conColloDiPrima) }),
  })
  const dati = await res.json().catch(() => null)
  if (!res.ok || !dati || !Array.isArray(dati.righe)) {
    throw Object.assign(new Error(dati?.error || 'Calcolo dei prezzi non riuscito'), { stato: res.status })
  }
  const out = new Map<string, RispostaRiga>()
  for (const r of dati.righe) {
    if (!r?.id) continue
    out.set(String(r.id), { tariffe: Array.isArray(r.tariffe) ? r.tariffe : [], errore: r.errore || undefined, riprova: r.riprova === true })
  }
  return out
}

// I prezzi di un elenco di ordini, a blocchi. SOLLEVA un errore se un blocco non si riesce a
// calcolare (dopo un secondo tentativo): chi sta per SPEDIRE deve fermarsi, non segnare in errore
// venti ordini per un inciampo di rete. Un rifiuto (vedi eUnRifiuto) non si ritenta: si solleva
// subito, col testo del server.
export async function chiediPrezzi(
  righe: RigaPrezzo[],
  mittente: MittentePrezzo,
  suAvanzamento?: (fatte: number, totale: number) => void,
): Promise<Map<string, RispostaRiga>> {
  const tutti = new Map<string, RispostaRiga>()
  let fatte = 0
  for (let i = 0; i < righe.length; i += RIGHE_PER_CHIAMATA) {
    const blocco = righe.slice(i, i + RIGHE_PER_CHIAMATA)
    let esito: Map<string, RispostaRiga>
    try { esito = await chiediBlocco(blocco, mittente) }
    catch (e) {
      if (eUnRifiuto(e)) throw e
      esito = await chiediBlocco(blocco, mittente)   // un solo secondo tentativo
    }
    // Le righe rimaste senza prezzo per un errore tecnico: un secondo tentativo solo per loro,
    // prima di consegnarle a chi sta per spedire (che le segnerebbe in errore).
    const daRifare = blocco.filter(r => esito.get(r.id)?.riprova)
    if (daRifare.length) {
      try {
        const secondo = await chiediBlocco(daRifare, mittente)
        for (const r of daRifare) { const x = secondo.get(r.id); if (x) esito.set(r.id, x) }
      } catch (e) { if (eUnRifiuto(e)) throw e }
    }
    for (const r of blocco) tutti.set(r.id, esito.get(r.id) || { tariffe: [], errore: NON_CALCOLATO, riprova: true })
    fatte += blocco.length
    suAvanzamento?.(fatte, righe.length)
  }
  return tutti
}

type Voce = { firma: string; esito: EsitoPrezzo }
// `superata` = nel frattempo quel prezzo e' arrivato da un'altra strada (vedi registra): la
// risposta di questa richiesta, se arriva dopo, non deve sovrascriverlo.
type InCoda = { riga: RigaPrezzo; firma: string; mittente: MittentePrezzo; superata?: boolean }

const esitoDi = (r: RispostaRiga): EsitoPrezzo =>
  r.tariffe.length ? { stato: 'ok', tariffe: r.tariffe }
    : { stato: 'errore', errore: r.errore || NESSUN_CORRIERE, ...(r.riprova ? { riprovabile: true } : {}) }

// I prezzi delle righe che la pagina vuole vedere. `righe` = gli ordini da prezzare ORA, NELL'ORDINE
// IN CUI SERVONO (prima quelli a schermo): e' anche l'ordine in cui vengono chiesti al server.
// `mittente` null o `attiva` false = non si chiede niente (i dati che entrano nel prezzo non sono
// ancora tutti arrivati: calcolare prima vorrebbe dire mostrare un prezzo su 1 kg e poi vederlo
// cambiare da solo; oppure si sta spedendo, e i prezzi li sta gia' chiedendo il pre-passaggio).
export function useAnteprimaPrezzi(righe: RigaPrezzo[], mittente: MittentePrezzo | null, attiva: boolean) {
  const [voci, setVoci] = useState<Record<string, Voce>>({})
  // Cambia solo per far ripartire l'effetto dopo un inciampo (nuovo tentativo) o su "Riprova".
  const [giro, setGiro] = useState(0)
  // Firma piu' recente chiesta per ogni ordine: una risposta arrivata per una firma vecchia (i dati
  // sono cambiati mentre il server calcolava) non deve sovrascrivere quella nuova.
  const ultima = useRef(new Map<string, string>())
  const coda = useRef<InCoda[]>([])
  const inVolo = useRef<InCoda[]>([])
  const inCorso = useRef(false)
  const vivo = useRef(true)
  // Le righe che la pagina vuole ADESSO, con la loro posizione.
  const posto = useRef(new Map<string, number>())
  const attivaOra = useRef(attiva)
  const tentativi = useRef(new Map<string, number>())
  const sveglia = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ultimo rifiuto del server e il mittente per cui vale: finche' vale non si richiama. Le righe su
  // cui e' stato scritto si ricordano, per poterle far ripartire se il rifiuto cade (vedi registra).
  const rifiuto = useRef<{ testo: string; cap: string; provincia: string } | null>(null)
  const rifiutate = useRef(new Set<string>())

  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false; if (sveglia.current) { clearTimeout(sveglia.current); sveglia.current = null } }
  }, [])
  useEffect(() => { attivaOra.current = attiva }, [attiva])

  const svuota = useCallback(async () => {
    if (inCorso.current) return
    inCorso.current = true
    try {
      // Si ferma mentre l'anteprima e' sospesa (si sta spedendo): il pre-passaggio sta chiedendo gli
      // stessi prezzi, e le due serie di chiamate insieme raddoppierebbero il carico per niente.
      while (vivo.current && attivaOra.current) {
        // SI TIENE SOLO CIO' CHE SERVE ANCORA, nell'ordine in cui serve. Una coda servita in ordine
        // d'arrivo, che non scarta niente, fa aspettare le righe a schermo dietro quelle di
        // schermate gia' lasciate: basta scrivere nella casella di ricerca o girare pagina in fretta
        // (i blocchi partono uno alla volta, e ognuno costa secondi). Una riga scartata dimentica
        // di essere stata chiesta: se torna a schermo riparte.
        coda.current = coda.current.filter(v => {
          if (v.superata || ultima.current.get(v.riga.id) !== v.firma) return false
          if (!posto.current.has(v.riga.id)) { ultima.current.delete(v.riga.id); return false }
          return true
        }).sort((a, b) => (posto.current.get(a.riga.id) as number) - (posto.current.get(b.riga.id) as number))
        if (!coda.current.length) break

        // Un blocco = righe con lo STESSO mittente.
        const primo = coda.current[0]
        const stessoMittente = (v: InCoda) => v.mittente.cap === primo.mittente.cap && v.mittente.provincia === primo.mittente.provincia
        const blocco: InCoda[] = []
        const resto: InCoda[] = []
        for (const v of coda.current) {
          if (blocco.length < RIGHE_PER_CHIAMATA && stessoMittente(v)) blocco.push(v)
          else resto.push(v)
        }
        coda.current = resto
        inVolo.current = blocco
        let risposte: Map<string, RispostaRiga> | null = null
        let guasto: any = null
        try { risposte = await chiediBlocco(blocco.map(v => v.riga), primo.mittente) } catch (e) { guasto = e }
        inVolo.current = []
        if (!vivo.current) return
        const attuale = (v: InCoda) => !v.superata && ultima.current.get(v.riga.id) === v.firma
        const arrivate: Record<string, Voce> = {}

        if (guasto && eUnRifiuto(guasto)) {
          // RIFIUTO: vale per tutte le righe di quel mittente, anche quelle ancora in coda. Si
          // scrive il motivo e NON si dimentica la richiesta: altrimenti la stessa chiamata
          // rifiutata ripartirebbe a ogni cambio di pagina o di selezione.
          const testo = testoDelRifiuto(guasto)
          rifiuto.current = { testo, cap: primo.mittente.cap, provincia: primo.mittente.provincia }
          for (const v of [...blocco, ...coda.current.filter(stessoMittente)]) {
            if (attuale(v)) { arrivate[v.riga.id] = { firma: v.firma, esito: { stato: 'errore', errore: testo } }; rifiutate.current.add(v.riga.id) }
          }
          coda.current = coda.current.filter(v => !stessoMittente(v))
          setVoci(prev => ({ ...prev, ...arrivate }))
          continue
        }

        let daRitentare = false
        for (const v of blocco) {
          if (!attuale(v)) continue                                        // nel frattempo e' cambiata
          const r = risposte?.get(v.riga.id)
          if (r && !r.riprova) {
            tentativi.current.delete(v.riga.id)
            arrivate[v.riga.id] = { firma: v.firma, esito: esitoDi(r) }
            continue
          }
          // INCIAMPO (blocco non arrivato, o riga non calcolata per un errore tecnico). Le prime
          // volte si ritenta da soli e la riga resta su "calcolo…"; poi si dice, e sulla riga resta
          // "Riprova": un messaggio che invita a riprovare deve dare il modo di farlo.
          const fatti = (tentativi.current.get(v.riga.id) || 0) + 1
          tentativi.current.set(v.riga.id, fatti)
          if (fatti <= RIPROVE_AUTOMATICHE) { ultima.current.delete(v.riga.id); daRitentare = true }
          else arrivate[v.riga.id] = { firma: v.firma, esito: { stato: 'errore', errore: r?.errore || NON_CALCOLATO, riprovabile: true } }
        }
        setVoci(prev => ({ ...prev, ...arrivate }))
        if (daRitentare && !sveglia.current) {
          sveglia.current = setTimeout(() => { sveglia.current = null; if (vivo.current) setGiro(g => g + 1) }, ATTESA_RIPROVA_MS)
        }
      }
    } finally { inCorso.current = false }
  }, [])

  // La chiave riassume "quali righe, con quali dati, in che ordine": l'effetto riparte solo quando
  // cambia davvero (l'elenco `righe` e' un array nuovo a ogni disegno della pagina). Il prefisso
  // distingue "attiva ma senza righe" da "sospesa": con zero righe l'effetto DEVE girare, perche'
  // e' cio' che svuota la coda (una ricerca senza risultati non deve far prezzare le righe di prima).
  const chiave = attiva && mittente ? 'attiva\n' + righe.map(r => r.id + '|' + firmaRiga(r, mittente)).join('\n') : ''
  useEffect(() => {
    if (!chiave || !mittente) return
    posto.current = new Map(righe.map((r, i) => [r.id, i]))
    const fermo = rifiuto.current && rifiuto.current.cap === mittente.cap && rifiuto.current.provincia === mittente.provincia
      ? rifiuto.current.testo : null
    const nuove: InCoda[] = []
    const scritte: Record<string, Voce> = {}
    for (const riga of righe) {
      const firma = firmaRiga(riga, mittente)
      if (ultima.current.get(riga.id) === firma) continue                  // gia' chiesta cosi'
      ultima.current.set(riga.id, firma)
      if (fermo) { scritte[riga.id] = { firma, esito: { stato: 'errore', errore: fermo } }; rifiutate.current.add(riga.id); continue }
      scritte[riga.id] = { firma, esito: { stato: 'calcolo' } }
      nuove.push({ riga, firma, mittente })
    }
    if (Object.keys(scritte).length) setVoci(prev => ({ ...prev, ...scritte }))
    coda.current.push(...nuove)
    // Si chiama anche senza righe nuove: e' cio' che fa ripartire la coda dopo una sospensione, e
    // cio' che la sfoltisce quando la pagina ha cambiato le righe che vuole.
    void svuota()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave, giro])

  // Il prezzo di una riga COSI' COM'E' ORA: se i suoi dati sono cambiati dopo l'ultimo calcolo, quel
  // prezzo non vale piu' e non si mostra. null = mai chiesto.
  const leggi = useCallback((riga: RigaPrezzo): EsitoPrezzo | null => {
    const v = voci[riga.id]
    if (!v || !mittente) return null
    return v.firma === firmaRiga(riga, mittente) ? v.esito : { stato: 'calcolo' }
  }, [voci, mittente])

  // PREZZI ARRIVATI DA FUORI: quelli che "Spedisci selezionati" ha appena ricalcolato. Vanno rimessi
  // a schermo. Altrimenti, dopo "un prezzo e' cambiato" + Annulla (o dopo "credito insufficiente"),
  // l'elenco e il totale resterebbero sui prezzi VECCHI con scritto "e' l'importo che ti verra'
  // addebitato": i nuovi starebbero solo in una variabile del clic, e niente fa scadere i vecchi.
  const registra = useCallback((righeRegistrate: RigaPrezzo[], mittenteUsato: MittentePrezzo, risposte: Map<string, RispostaRiga>) => {
    const scritte: Record<string, Voce> = {}
    for (const riga of righeRegistrate) {
      const r = risposte.get(riga.id)
      if (!r) continue
      const firma = firmaRiga(riga, mittenteUsato)
      ultima.current.set(riga.id, firma)
      tentativi.current.delete(riga.id)
      scritte[riga.id] = { firma, esito: esitoDi(r) }
    }
    // Una richiesta dell'anteprima per le stesse righe, ancora in coda o in viaggio, e' piu' vecchia
    // di questi prezzi: non deve sovrascriverli quando arriva.
    for (const v of [...coda.current, ...inVolo.current]) if (scritte[v.riga.id]) v.superata = true
    if (!Object.keys(scritte).length) return
    setVoci(prev => ({ ...prev, ...scritte }))
    // IL RIFIUTO E' CADUTO: se per questo mittente il server aveva rifiutato e ora ha risposto, le
    // altre righe rimaste col testo del rifiuto vanno richieste di nuovo. Altrimenti resterebbero su
    // "non consentito" accanto a righe col prezzo, fino al ricaricamento della pagina (succede
    // quando il master toglie il divieto di inserimento a pagina aperta).
    const r = rifiuto.current
    if (r && r.cap === mittenteUsato.cap && r.provincia === mittenteUsato.provincia) {
      rifiuto.current = null
      for (const id of rifiutate.current) if (!scritte[id]) ultima.current.delete(id)
      rifiutate.current.clear()
      setGiro(g => g + 1)
    }
  }, [])

  // "Riprova" sulla riga: dimentica la richiesta e i tentativi fatti, e la rimette in coda.
  const riprova = useCallback((ids: string[]) => {
    for (const id of ids) { ultima.current.delete(id); tentativi.current.delete(id) }
    setGiro(g => g + 1)
  }, [])

  return { leggi, registra, riprova }
}
