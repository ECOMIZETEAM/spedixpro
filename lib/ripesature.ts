// IL FILE DELLE RIPESATURE DEL FORNITORE.
//
// Il corriere rimisura i colli e ci addebita la differenza. L'export che ne esce ha due trappole,
// e tutte e due costano soldi se non le si conosce.
//
// PRIMA: IL MULTICOLLO E' SPACCATO PER COLLO, MA L'ADDEBITO E' UNO SOLO.
// Una spedizione da cinque colli occupa cinque righe, e su OGNI riga c'e' lo stesso importo — che
// non va sommato, e' l'importo della spedizione ripetuto. Misurato sul file vero: 127 righe che
// sono 106 spedizioni, 547,62 euro riga per riga contro 356,35 veri. Caricarle a riga vorrebbe
// dire addebitare il 54% in piu' ai clienti.
// Le righe di una stessa spedizione si riconoscono dall'id_ordine. Controprova indipendente: la
// lettera di vettura di un collo FINISCE SEMPRE con quella madre (1WLJMFK6W + 3UW1WLJ009255).
//
// SECONDA: LE DUE COLONNE NUMERICHE USANO SEPARATORI DIVERSI.
// Il peso scrive "8.000" col PUNTO decimale (otto chili), l'importo "1,02" con la VIRGOLA.
// Leggendoli allo stesso modo un pacco da 8 kg diventa da ottomila, e il volumetrico esplode.
//
// E' il volume, non il peso, a fare il supplemento: verificato chiedendo al fornitore due preventivi
// sulla stessa spedizione, 106 casi su 106 al centesimo. Su 45 di quei 106 il pacco pesava MENO di
// quanto avevamo fatturato e pagava lo stesso — perche' misurava di piu'. Per questo le misure
// riscontrate contano quanto il peso e vanno portate fino al ricalcolo.

export type ColloRipesato = { peso: number; lunghezza: number; larghezza: number; altezza: number }

export type Ripesatura = {
  idOrdine: string          // chiave del raggruppamento e anti-doppione
  idVerifiche: string[]     // le singole verifiche che compongono questa spedizione
  ldv: string               // la lettera di vettura MADRE (quella della spedizione)
  addebitoFornitore: number // quanto ci addebita il fornitore, per la spedizione INTERA
  colli: ColloRipesato[]
  dataChiusura: string
  mittente: string
  destinatario: string
  // ── Solo per il formato TRANSAZIONI SpediamoPro (dato nel testo Details) ──
  codiceProvider?: string   // il "6A..." = raw_response.code: NON è il tracking, la rotta lo risolve
  supplementi?: number      // supplementi FISSI riconosciuti (euro): si addebitano in aggiunta e cascatano invariati
  supplementiNomi?: string[]        // quali sono, per scriverlo nella descrizione del movimento
  supplementiSenzaTariffa?: string[]// riconosciuti ma senza importo certo: si segnalano, non si indovinano
  reso?: boolean            // il testo contiene "reso": il cliente non lo paga qui (flusso reso a parte)
  // ── Solo per il formato "Andamento giornaliero XL" di Poste (dichiarato/rilevato per collo) ──
  formato?: 'xl' | 'pesi'
  colliNonRilevati?: number         // righe della LDV senza nessuna misura: la spedizione e' incompleta
  colliPesoDaDichiarato?: number[]  // indici dei colli con le misure ma senza il peso (bilancia a 0)
  pesiDichiaratiFile?: number[]     // peso dichiarato di ogni collo come lo scrive il file (2 decimali)
}

const euro = (v: any) => {
  // Il PUNTO qui e' separatore delle migliaia e la VIRGOLA e' decimale: "1.234,56".
  if (typeof v === 'number') return v
  return Number(String(v ?? '0').replace(/\./g, '').replace(',', '.')) || 0
}
const kg = (v: any) => {
  // Qui invece il punto E' decimale: "8.000" sono otto chili, non ottomila.
  if (typeof v === 'number') return v
  return Number(String(v ?? '0').replace(',', '.')) || 0
}

function misure(v: any): { lunghezza: number; larghezza: number; altezza: number } {
  const p = String(v ?? '').toLowerCase().split('x').map(x => Number(String(x).trim()) || 0)
  return { lunghezza: p[0] || 0, larghezza: p[1] || 0, altezza: p[2] || 0 }
}

// Le righe arrivano gia' lette dalla pagina (xlsx legge sia CSV sia XLS), quindi qui non si fa
// nessun parsing di testo: si normalizzano solo i NOMI delle colonne, perche' "id_ordine",
// "ID Ordine" e "id-ordine" devono essere la stessa cosa.
function normalizza(riga: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of Object.keys(riga || {})) {
    out[String(k).toLowerCase().replace(/[^a-z0-9]/g, '')] = riga[k]
  }
  return out
}

// ── FORMATO ALTERNATIVO: export TRANSAZIONI SpediamoPro ──
// Colonne CSV: ID;Type;"Amount [EUR]";"Balance [EUR]";Details;Date. Il dato della ripesatura sta nel
// TESTO di Details: "Sovrapprezzo spedizione: <CODICE 6A...> del: <data> Peso reale: X Peso
// volumetrico: Y Dim: LxHxP [+ reso / + supplemento fuori sagoma]" (due varianti di scrittura:
// "Peso reale…Dim:" e "peso reale…dimensioni:"). Amount = addebito del fornitore per l'INTERA riga
// (ripesatura + eventuale fuori sagoma + eventuale reso, tutto insieme). Il CODICE non e' la LDV: e'
// il codice provider (raw_response.code) — la rotta lo risolve in tracking_number.
const RE_SP_CODE  = /Sovrapprezzo spedizione:\s*([0-9A-Za-z]+)/i
const RE_SP_REALE = /peso reale:\s*([0-9]+(?:\.[0-9]+)?)/i
const RE_SP_VOL   = /peso volumetrico:\s*([0-9]+(?:\.[0-9]+)?)/i
const RE_SP_DIM   = /(?:dim:|dimensioni:)\s*([0-9.]+x[0-9.]+x[0-9.]+)/i
// Amount di SpediamoPro: punto decimale ("7.45"), importi piccoli (nessuna migliaia).
const importoSP = (v: any) => Math.abs(Number(String(v ?? '0').replace(',', '.')) || 0)

// ── I SUPPLEMENTI DEL FORNITORE ──
//
// Oltre alla ripesatura, nella stessa riga il fornitore puo' addebitare dei supplementi fissi. Il
// testo li nomina ma non ne scrive l'importo: l'Amount e' ripesatura + supplementi tutto insieme.
// L'importo si legge dalle righe in cui il supplemento e' l'UNICA cosa (peso rimisurato che non fa
// differenza): li' l'Amount E' il supplemento. Misurato sul conto intero (97.910 righe, luglio →
// 29/09/2026):
//   fuori sagoma        16,39 €  — 14 righe esatte a 16,39
//   non sovrapponibile  16,39 €  — 2 righe nette; una riga con tutti e due fa 32,78, che torna
//   consegna su appuntamento 2,46 € — 5 righe esatte a 2,46
// Non entrano nel listino: si addebitano in aggiunta alla differenza e cascatano INVARIATI lungo la
// catena. Se il fornitore li cambia, si tocca solo questa tabella.
export const SUPPLEMENTI_SP: { nome: string; re: RegExp; euro: number }[] = [
  { nome: 'fuori sagoma', re: /fuori\s*sagoma/i, euro: 16.39 },
  { nome: 'non sovrapponibile', re: /non\s*sovrapponibile/i, euro: 16.39 },
  { nome: 'consegna su appuntamento', re: /consegna\s*su\s*appuntamento/i, euro: 2.46 },
  // Queste due non avevano nessuna riga pulita: la tariffa e' stata CALCOLATA rifacendo fare al
  // fornitore il preventivo della stessa spedizione col peso che ha rimisurato lui, e togliendo
  // quello che ci aveva addebitato alla partenza — quel che resta nella riga e' il supplemento
  // (tariffa-supplementi.mjs). Il metodo si e' validato sul fuori sagoma, dove deve restituire
  // 16,39 e restituisce 13,80-16,39 (i preventivi di oggi non sono le tariffe di allora).
  //   fuori dimensione 25,82  — due righe indipendenti danno 25,82 ESATTO; la terza e' 25,82 +
  //                             52,58 di reso = 78,40, e il reso costa quanto l'andata
  //   super gdo         7,37  — due righe danno 7,25, cioe' 7,37 meno 0,12 di aggiornamento
  { nome: 'fuori dimensione', re: /fuori\s*dimensione/i, euro: 25.82 },
  { nome: 'super gdo', re: /super\s*gdo/i, euro: 7.37 },
]

// Nessuna voce del conto e' piu' senza tariffa. Il meccanismo resta: il giorno che il fornitore ne
// inventa una nuova, finisce qui e viene segnalata a chi carica invece di sparire dentro il costo.
export const SUPPLEMENTI_SENZA_TARIFFA: { nome: string; re: RegExp }[] = []

// Resta esportato: e' il fuori sagoma, e fuori di qui qualcuno lo cita ancora per nome.
export const FUORI_SAGOMA_EUR = 16.39

// E' una riga del formato TRANSAZIONI SpediamoPro (dato nel testo)?
export function sembraRipesatureSP(righe: any[]): boolean {
  const r = normalizza((righe || [])[0] || {})
  const haColonne = 'details' in r && ('amounteur' in r || 'amount' in r)
  return haColonne && /sovrapprezzo\s+spedizione/i.test(String(r.details || ''))
}

// Il file e' di ripesature? Si riconosce dalle colonne, non dal nome del file: chi carica non deve
// sapere in quale schermata va quale export. Due formati: quello a COLONNE (id_ordine/ldv/peso
// riscontrato) e quello a TESTO (transazioni SpediamoPro, riconosciuto sopra).
export function sembraRipesature(righe: any[]): boolean {
  const r = normalizza((righe || [])[0] || {})
  const colonne = 'idordine' in r && 'ldv' in r && ('misureriscontrate' in r || 'pesoriscontrato' in r)
  return colonne || sembraRipesatureSP(righe) || sembraRipesatureXL(righe) || sembraRipesaturePesi(righe)
}

// ── FORMATO "ANDAMENTO GIORNALIERO XL" DI POSTE (lo manda LOGIXIA per SDA EXPRESS L) ──
//
// Colonne: LDV_MADRE, DICHIARATO PESO/LARGHEZZA/PROFONDITA/ALTEZZA, RILEVATO PESO/LARGHEZZA/
// PROFONDITA/ALTEZZA, IMPORTO CONTRASSEGNO, IMPORTO ASSICURAZIONE. Nessun importo di rettifica: il
// file dice solo cosa e' stato dichiarato e cosa ha misurato il corriere, il conto lo fa il motore.
// Il primo caricamento (13/10/2026, "rilevazioni al091026.csv", 7.292 righe) era finito nel ramo dei
// pesi con zero spedizioni lette e nessun messaggio: queste colonne non le riconosceva nessuno.
//
// UNA RIGA E' UN COLLO. Verificato sul file del 12/10/2026 (6.958 LDV): le 227 LDV con piu' righe
// hanno tante righe quanti colli in 225 casi, meno righe in 2, MAI di piu'; il dichiarato di ogni
// riga coincide col dettaglio colli di quel collo. Il file mette i colli in piu' in un blocco in
// cima e la riga "principale" piu' sotto (282224J028839 sta alle righe 11, 12 e 524): si raggruppa
// per LDV su tutto il foglio, mai per righe vicine. Non si tolgono le righe uguali (8 LDV hanno
// scatole identiche al decimale e sono colli veri) e non si prende la misura piu' alta: quella e' la
// regola delle riletture di UN collo su OneTracking, qui farebbe perdere 252 euro su 312.
export function sembraRipesatureXL(righe: any[]): boolean {
  // Le prime righe possono non avere le celle RILEVATO (vuote, e il lettore le omette): si guarda
  // l'insieme delle colonne delle prime cinquanta, non la sola prima riga.
  const chiavi = new Set<string>()
  for (const r of (righe || []).slice(0, 50)) for (const k of Object.keys(normalizza(r))) chiavi.add(k)
  return chiavi.has('ldvmadre') && chiavi.has('rilevatopeso')
    && chiavi.has('rilevatolarghezza') && chiavi.has('rilevatoaltezza')
    && (chiavi.has('rilevatoprofondita') || chiavi.has('rilevatoprofondit'))   // "PROFONDITÀ" senza l'accento
}

function leggiRipesatureXL(righe: any[]): { righe: Ripesatura[]; scartate: number; totaleFornitore: number; senzaMisure: number } {
  const gruppi = new Map<string, Ripesatura>()
  let scartate = 0
  for (const grezza of (righe || [])) {
    const c = normalizza(grezza)
    const ldv = String(c.ldvmadre ?? '').trim().toUpperCase()
    if (!ldv) { scartate++; continue }
    const g: Ripesatura = gruppi.get(ldv) || {
      idOrdine: ldv, idVerifiche: [], ldv, addebitoFornitore: 0, colli: [],
      dataChiusura: '', mittente: '', destinatario: '',
      formato: 'xl', colliNonRilevati: 0, colliPesoDaDichiarato: [], pesiDichiaratiFile: [],
    }
    gruppi.set(ldv, g)
    const peso = kg(c.rilevatopeso)
    const mis = { lunghezza: kg(c.rilevatoprofondita ?? c.rilevatoprofondit), larghezza: kg(c.rilevatolarghezza), altezza: kg(c.rilevatoaltezza) }
    const haMisure = mis.lunghezza > 0 && mis.larghezza > 0 && mis.altezza > 0
    // COLLO NON MISURATO (celle vuote o tutte a zero): non e' un collo da zero chili. Se lo si
    // passasse cosi', su un multicollo farebbe da contrappeso agli altri e si chiederebbe meno del
    // dovuto; e una volta creata la rettifica l'anti-doppio impedirebbe di completarla col file
    // successivo. Si conta, e la rotta mette in attesa la spedizione intera.
    if (peso <= 0 && !haMisure) { g.colliNonRilevati = (g.colliNonRilevati || 0) + 1; continue }
    // MISURE SENZA PESO (la bilancia del nastro scrive 0): il volume c'e', il peso no. Si tiene il
    // peso DICHIARATO di quel collo, cosi' il collo non pesa mai piu' di come e' partito e l'unico
    // aumento possibile viene dal volume misurato. La rotta lo sostituisce col valore pieno del
    // dettaglio colli: il file lo arrotonda a 2 decimali (20 kg in 3 colli = 6,67 + 6,67 + 6,67 =
    // 20,01, che passa di fascia).
    if (peso <= 0) g.colliPesoDaDichiarato!.push(g.colli.length)
    g.pesiDichiaratiFile!.push(kg(c.dichiaratopeso))
    g.colli.push({ peso: peso > 0 ? peso : kg(c.dichiaratopeso), ...(haMisure ? mis : { lunghezza: 0, larghezza: 0, altezza: 0 }) })
  }
  // Le LDV senza nemmeno un collo misurato non dicono niente: si scartano qui.
  const tutte = [...gruppi.values()]
  const out = tutte.filter(r => r.colli.length > 0)
  return { righe: out, scartate, totaleFornitore: 0, senzaMisure: tutte.length - out.length }
}

// ── FILE DEI SOLI PESI: due colonne, la lettera di vettura e il peso (GLS di MULTI, Velox, SDA) ──
//
// Prima finivano nel vecchio ramo dei pesi, che lavorava tutto il file in UNA richiesta e cercava
// ogni LDV con un "contiene" su tutta la tabella spedizioni (~1 secondo l'una): il file GLS di MULTI
// del 15/10 (3.232 righe) non poteva finire nei 300 secondi e la pagina diceva solo "errore" — come gia'
// "rettifiche gls 2909.csv" (947 righe, zero rettifiche). Ora passano dal motore delle rettifiche, a
// pacchetti: pagato dai movimenti, catena vera, contratti condivisi.
// SOLO i file fatti di quelle due colonne: uno con altre colonne non si indovina, resta com'era.
const CHIAVI_LDV = ['ldv', 'nspedizione', 'numero']
const CHIAVI_PESO = ['peso', 'pesoreale', 'newweight']
export function sembraRipesaturePesi(righe: any[]): boolean {
  const chiavi = new Set<string>()
  for (const r of (righe || []).slice(0, 50)) {
    for (const [k, v] of Object.entries(normalizza(r))) if (String(v ?? '').trim()) chiavi.add(k)
  }
  return chiavi.size === 2
    && CHIAVI_LDV.filter(k => chiavi.has(k)).length === 1
    && CHIAVI_PESO.filter(k => chiavi.has(k)).length === 1
}

// Un collo solo col peso del file e senza misure: e' quello che il file dice. Se la spedizione ha piu'
// colli, la rotta divide il peso sui colli dichiarati (lib/ripesature-pesi). La stessa LDV con due pesi
// diversi non si indovina: si scarta, come faceva il ramo vecchio.
function leggiRipesaturePesi(righe: any[]): { righe: Ripesatura[]; scartate: number; totaleFornitore: number } {
  const perLdv = new Map<string, number[]>()
  let scartate = 0
  for (const grezza of (righe || [])) {
    const c = normalizza(grezza)
    const ldv = String(c.ldv ?? c.nspedizione ?? c.numero ?? '').trim()
    const peso = kg(c.peso ?? c.pesoreale ?? c.newweight)
    if (!ldv || !(peso > 0)) { scartate++; continue }
    perLdv.set(ldv, [...(perLdv.get(ldv) || []), peso])
  }
  const out: Ripesatura[] = []
  for (const [ldv, pesi] of perLdv) {
    if (new Set(pesi.map(p => p.toFixed(3))).size > 1) { scartate++; continue }
    out.push({
      idOrdine: ldv, idVerifiche: [], ldv, addebitoFornitore: 0,
      colli: [{ peso: pesi[0], lunghezza: 0, larghezza: 0, altezza: 0 }],
      dataChiusura: '', mittente: '', destinatario: '', formato: 'pesi',
    })
  }
  return { righe: out, scartate, totaleFornitore: 0 }
}

// Parser del formato TRANSAZIONI SpediamoPro: ogni riga = una spedizione (i 6A... sono distinti).
function leggiRipesatureSP(righe: any[]): { righe: Ripesatura[]; scartate: number; totaleFornitore: number } {
  const out: Ripesatura[] = []
  let scartate = 0
  const visti = new Set<string>()
  for (const grezza of (righe || [])) {
    const c = normalizza(grezza)
    const details = String(c.details ?? '')
    const mc = RE_SP_CODE.exec(details)
    if (!mc) { scartate++; continue }          // riga non-sovrapprezzo (ricarica, rimessa COD...): si salta
    const code = mc[1].trim()
    if (visti.has(code)) { scartate++; continue }
    visti.add(code)
    const reale = RE_SP_REALE.exec(details); const vol = RE_SP_VOL.exec(details); const dim = RE_SP_DIM.exec(details)
    const pesoReale = reale ? Number(reale[1]) : 0
    const pesoVol   = vol ? Number(vol[1]) : 0
    const mis = dim ? misure(dim[1]) : { lunghezza: 0, larghezza: 0, altezza: 0 }
    const haDim = mis.lunghezza > 0 && mis.larghezza > 0 && mis.altezza > 0
    // Con le dimensioni il motore ricalcola il volume col NOSTRO fattore (giusto per riprezzare sul
    // nostro listino). Senza dimensioni (~22 casi su 500) non puo': si usa come peso il MAX(reale,
    // volumetrico del fornitore) cosi' il riprezzo non perde il volume su cui il fornitore ci ha
    // addebitato.
    const collo: ColloRipesato = haDim
      ? { peso: pesoReale, ...mis }
      : { peso: Math.max(pesoReale, pesoVol), lunghezza: 0, larghezza: 0, altezza: 0 }
    out.push({
      idOrdine: code, idVerifiche: [], ldv: code,   // ldv=code TEMPORANEO: la rotta lo rimappa in tracking_number
      addebitoFornitore: importoSP(c.amounteur ?? c.amount ?? c.importo),
      colli: [collo], dataChiusura: '', mittente: '', destinatario: '',
      codiceProvider: code,
      // MAI PIU' DI QUELLO CHE CI HANNO ADDEBITATO. Il supplemento e' una PARTE dell'importo della
      // riga: se la tariffa che conosciamo fosse piu' alta (il fornitore l'ha scontata, o la riga e'
      // di un periodo con un prezzo diverso) girarla intera vorrebbe dire chiedere a valle piu' di
      // quanto e' uscito. Sul conto vero succede una volta: una riga di super gdo da 5,73.
      supplementi: Math.min(
        Math.round(SUPPLEMENTI_SP.filter(s2 => s2.re.test(details)).reduce((a, s2) => a + s2.euro, 0) * 100) / 100,
        importoSP(c.amounteur ?? c.amount ?? c.importo),
      ),
      supplementiNomi: SUPPLEMENTI_SP.filter(s2 => s2.re.test(details)).map(s2 => s2.nome),
      supplementiSenzaTariffa: SUPPLEMENTI_SENZA_TARIFFA.filter(s2 => s2.re.test(details)).map(s2 => s2.nome),
      reso: /(^|[^a-z])reso([^a-z]|$)/i.test(details),
    })
  }
  return { righe: out, scartate, totaleFornitore: out.reduce((s, r) => s + r.addebitoFornitore, 0) }
}

export function leggiRipesature(righe: any[]): { righe: Ripesatura[]; scartate: number; totaleFornitore: number; senzaMisure?: number } {
  // Formato TRANSAZIONI SpediamoPro (dato nel testo): parser dedicato.
  if (sembraRipesatureSP(righe)) return leggiRipesatureSP(righe)
  // Formato "Andamento giornaliero XL" di Poste: una riga per collo, raggruppate per LDV madre.
  if (sembraRipesatureXL(righe)) return leggiRipesatureXL(righe)
  // File dei soli pesi (LDV + peso): un peso per spedizione, nessuna misura.
  if (sembraRipesaturePesi(righe)) return leggiRipesaturePesi(righe)
  const gruppi = new Map<string, Ripesatura>()
  let scartate = 0
  for (const grezza of (righe || [])) {
    const c = normalizza(grezza)
    const idOrdine = String(c.idordine ?? '').trim()
    const ldv = String(c.ldv ?? '').trim()
    if (!idOrdine || !ldv) { scartate++; continue }
    const collo: ColloRipesato = { peso: kg(c.pesoriscontrato), ...misure(c.misureriscontrate) }

    const g = gruppi.get(idOrdine)
    if (!g) {
      gruppi.set(idOrdine, {
        idOrdine,
        idVerifiche: [String(c.idverifica ?? '')].filter(Boolean),
        ldv,
        // L'IMPORTO NON SI SOMMA: e' lo stesso su tutte le righe della spedizione.
        addebitoFornitore: euro(c.addebito),
        colli: [collo],
        dataChiusura: String(c.datachiusura ?? ''),
        mittente: String(c.mittente ?? ''),
        destinatario: String(c.destinatario ?? ''),
      })
    } else {
      if (c.idverifica) g.idVerifiche.push(String(c.idverifica))
      g.colli.push(collo)
      // La LDV madre e' la piu' corta: quella dei colli la contiene come suffisso.
      if (ldv.length < g.ldv.length) g.ldv = ldv
    }
  }
  const out = [...gruppi.values()]
  return { righe: out, scartate, totaleFornitore: out.reduce((s, r) => s + r.addebitoFornitore, 0) }
}
