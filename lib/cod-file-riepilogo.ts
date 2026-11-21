// IL RIEPILOGO DI UN FILE CONTRASSEGNI CARICATO: dove e' finita ogni riga, e PERCHE' quelle scartate.
//
// Fino al 20/11/2026 "File processati" teneva solo il NUMERO degli errori: il dettaglio (quale LDV, perche')
// compariva per qualche secondo nel messaggio di fine caricamento, e solo le prime 15 righe. LOGIXIA vedeva
// "7" in rosso e nessuno sapeva dire quali fossero (erano 5 LDV non nel portale + subtotale e totale del file).
// Si perdeva anche il blocco andato oltre il tempo massimo: M.C LOGISTICA il 20/11 vedeva 215 spedizioni
// invece di 234, senza nessun avviso nella tabella.
//
// Niente import: lo usano sia la rotta upload-cod (che lo salva in cod_files.riepilogo) sia la pagina
// (che lo mostra), e la pagina gira nel browser.

export type ScartoRiga = { ldv: string; motivo: string }

export type RiepilogoFileCod = {
  versione: 1
  conteggi: {
    entrate: number          // messe in "Contrassegni da caricare"
    giaInDistinta: number    // gia' in una mia distinta: saltate
    giaInSosta: number       // gia' in attesa di essere caricate (file gia' importato): saltate
    propri: number           // contrassegni propri del master, gia' incassati
    nonPagate: number        // il corriere non le ha ancora versate
    doppioni: number         // stessa spedizione due volte nel file
    errori: number           // scartate: vedi `scarti`
    nonClassificate: number  // DEVE essere 0
  }
  blocchiNonCaricati: number // blocchi che il server non ha confermato (tempo massimo, rete): righe da ricontrollare
  problemi: string[]         // il testo di quei blocchi
  scarti: ScartoRiga[]       // ogni riga scartata con il suo motivo
  scartiTroncati: boolean    // true se gli scarti erano piu' di MAX_SCARTI
}

export const MAX_SCARTI = 5000

const numero = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0 }
const testo = (v: unknown, max: number) => String(v ?? '').slice(0, max)

// Dal corpo della chiamata finale della pagina (soloLog) al riepilogo da salvare: solo campi noti, numeri
// interi, testi corti, elenco limitato. Quello che arriva dal browser non si salva cosi' com'e'.
export function riepilogoDaRichiesta(s: any): RiepilogoFileCod {
  const scartiIn: any[] = Array.isArray(s?.scarti) ? s.scarti : []
  return {
    versione: 1,
    conteggi: {
      entrate: numero(s?.spedizioniProcessate),
      giaInDistinta: numero(s?.giaInDistinta),
      giaInSosta: numero(s?.giaInSosta),
      propri: numero(s?.propri),
      nonPagate: numero(s?.saltateNonPagate),
      doppioni: numero(s?.doppioniFile),
      errori: numero(s?.errori),
      nonClassificate: numero(s?.nonClassificate),
    },
    blocchiNonCaricati: numero(s?.blocchiNonCaricati),
    problemi: (Array.isArray(s?.problemi) ? s.problemi : []).slice(0, 20).map((p: unknown) => testo(p, 200)),
    scarti: scartiIn.slice(0, MAX_SCARTI).map(x => ({ ldv: testo(x?.ldv, 60), motivo: testo(x?.motivo, 80) })),
    scartiTroncati: scartiIn.length > MAX_SCARTI,
  }
}

// Il motivo come lo legge un master, non come lo scrive il codice.
export function motivoLeggibile(m: string): string {
  const v = String(m || '').toLowerCase()
  if (v.startsWith('non trovata')) return 'Non nel portale: lettera di vettura che su MoovExpress non esiste'
  if (v.startsWith('fuori dalla tua rete')) return 'Spedizione di un\'altra rete: non la paghi tu'
  if (v.startsWith('riga senza ldv')) return 'Riga senza lettera di vettura (totali, righe vuote, intestazioni)'
  if (v.startsWith('riga di totale')) return 'Riga di totale del file'
  if (v.startsWith('pacco condiviso')) return 'Pacco condiviso: spedizione di partenza non leggibile, riprova'
  return m || 'Motivo non indicato'
}

// Gli scarti raggruppati per motivo, dal gruppo piu' numeroso.
export function scartiPerMotivo(scarti: ScartoRiga[]): { motivo: string; ldv: string[] }[] {
  const g = new Map<string, string[]>()
  for (const s of scarti || []) { const k = motivoLeggibile(s.motivo); if (!g.has(k)) g.set(k, []); g.get(k)!.push(s.ldv || '(senza lettera di vettura)') }
  return [...g.entries()].map(([motivo, ldv]) => ({ motivo, ldv })).sort((a, b) => b.ldv.length - a.ldv.length)
}
