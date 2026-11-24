// VALIDAZIONE CITTÀ ↔ CAP contro l'archivio (comuni.json + frazioni.json).
//
// PERCHE'. La città scritta a mano che NON combacia col nome vero del comune/frazione per quel CAP
// fa saltare il match delle zone speciali (disagiata/isole) — che nel database sono scritte col nome
// UFFICIALE — e la spedizione cade sul jolly "Italia": venduta a prezzo pianura, pagata a prezzo
// disagiata. Caso vero 3UW1UHA272704: "Castelnuovo Monti" (42035) invece di "Castelnovo ne' Monti"
// → venduto 4,43 (Italia), costo reale 12,26 (CAP Disagiati), −7,61 a MULTIEXPRESS. Bloccando qui
// l'inserimento sbagliato, chi spedisce corregge (o seleziona) e la zona giusta si aggancia sempre.
//
// Stessa normalizzazione dell'autocomplete (app/api/comuni/route.ts): senza accenti, apostrofi, spazi.
import comuni from '@/lib/data/comuni.json'
import frazioni from '@/lib/data/frazioni.json'

type Comune = { nome: string; sigla: string; provincia: string; cap: string[] }
type Loc = { nome: string; sigla: string; provincia: string; cap: string }

export function normCitta(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenti
    .replace(/[’ʼ`´']/g, '')                             // apostrofi
    .replace(/\s+/g, '')                                  // spazi
}

// Indice CAP -> { nomi normalizzati validi, nomi ufficiali da mostrare }. Calcolato una volta sola.
const PER_CAP = new Map<string, { norm: Set<string>; nomi: Set<string> }>()
// CAP -> comuni (SOLO comuni, non frazioni): per la normalizzazione automatica all'import serve
// sapere se quel CAP appartiene a UN SOLO comune (allora una scrittura diversa è quello, senza dubbio).
const COMUNI_PER_CAP = new Map<string, Set<string>>()
// "CAP|nome normalizzato" -> "Nome (SIGLA)": per dire a chi spedisce DOVE sta l'indirizzo che ha scritto.
const LOCALITA_ITALIANA = new Map<string, string>()
// Tutti i nomi (normalizzati) di comuni e frazioni italiane, con qualunque CAP: per riconoscere una
// citta' che in Italia non esiste (vedi indirizzoEsteroComeItalia).
const NOMI_ITALIANI = new Set<string>()
function aggiungi(cap: string, nome: string, sigla: string) {
  if (!cap || !nome) return
  NOMI_ITALIANI.add(normCitta(nome))
  let e = PER_CAP.get(cap)
  if (!e) { e = { norm: new Set(), nomi: new Set() }; PER_CAP.set(cap, e) }
  e.norm.add(normCitta(nome)); e.nomi.add(nome)
  const k = `${cap}|${normCitta(nome)}`
  if (!LOCALITA_ITALIANA.has(k)) LOCALITA_ITALIANA.set(k, sigla ? `${nome} (${sigla})` : nome)
}
for (const c of comuni as Comune[]) for (const cap of (c.cap || [])) {
  aggiungi(cap, c.nome, c.sigla)
  let s = COMUNI_PER_CAP.get(cap); if (!s) { s = new Set(); COMUNI_PER_CAP.set(cap, s) }
  s.add(c.nome)
}
for (const f of frazioni as Loc[]) aggiungi(f.cap, f.nome, f.sigla)
// Le prime tre cifre dei CAP italiani (206): la "forma" di un CAP italiano (vedi indirizzoEsteroComeItalia).
const PREFISSI_ITALIANI = new Set(Array.from(PER_CAP.keys()).filter(k => /^\d{5}$/.test(k)).map(k => k.slice(0, 3)))

// UN INDIRIZZO ITALIANO NON PARTE COL PAESE DI UN ALTRO. Il paese decide contratto, prezzo e strada
// del pacco, e nessuno lo confrontava con l'indirizzo. Caso vero NI665485843 (24/10/2026): "Via
// Astronauti 16, 51034 Serravalle Pistoiese" col paese su Romania → GLS Europa, 15,20 € invece di 5,
// e GLS l'ha portato in Austria verso la Romania.
// Ferma solo quando citta' E CAP insieme sono un comune o una frazione italiana: il CAP da solo non
// basta (le cinque cifre sono di mezza Europa). Sulle 4.291 spedizioni estere dal 15/09 al 4/11/2026
// fermava 3 indirizzi, tutti sbagliati: questo, una prova poi annullata, e 050195152947284 — Saint-Marcel
// 11020 (AO) col paese Francia: il destinatario stava davvero in Francia ma il CAP era quello
// italiano, e il corriere francese l'ha dato "indirizzo inesistente", consegna 9 giorni dopo.
// Contare le cifre del CAP per paese NON si fa: sugli stessi dati fermava pacchi consegnati, scritti
// senza lo zero davanti (Bucarest "50471" per 050471, Dresda "1097", Almeria "4006").
// San Marino e Vaticano hanno CAP del sistema italiano: per loro non vale.
// Ritorna "Nome (SIGLA)" della localita' italiana, oppure null.
export function localitaItalianaFuoriPaese(
  cap: string | null | undefined,
  citta: string | null | undefined,
  paese: string | null | undefined,
): string | null {
  const p = (paese || 'IT').toUpperCase().trim()
  if (p === 'IT' || p === 'SM' || p === 'VA') return null
  const c = (cap || '').trim()
  const town = (citta || '').trim()
  if (!/^\d{5}$/.test(c) || !town) return null
  return LOCALITA_ITALIANA.get(`${c}|${normCitta(town)}`) || null
}

// IL CONTRARIO: UN INDIRIZZO ESTERO NON PARTE COME ITALIA. Caso vero 282343J119862 (24/11/2026): paese
// Italia, "68300 ST LOUIS", provincia "FR" (in Francia; ma FR e' anche Frosinone, e nessun campo sembrava
// sbagliato). Il preventivo ha proposto i contratti italiani, SDA EXPRESS L l'ha preso, Poste ha fatto la
// LDV per un CAP italiano che non esiste. In 60 giorni di SDA EXPRESS L altre due cosi': Reutlingen
// (72770, Germania) e Hvar (21450, Croazia), entrambe annullate.
// Su tutti i contratti, in 30 giorni, 26 spedizioni cosi': Espoo, Groningen, Wuppertal, Nizza, Mataro'...
// su UPS Italia, BRT Express, Poste, GLS — annullate, rese al mittente, o consegnate a prezzo d'Italia.
// FERMA SOLO QUANDO SONO STRANIERI SIA IL CAP SIA LA CITTA'.
//  - Il CAP: non ha la forma italiana, cioe' 5 cifre con prime tre che in Italia esistono. Il CAP fuori
//    archivio NON basta: la prima prova fermava ~30 spedizioni italiane vere in 30 giorni — comuni nuovi
//    che l'archivio non ha (91031 MISILISCEMI, 21009 BARDELLO CON MALGESSO E BREGANO), frazioni e
//    abbreviazioni (38098 S.MICHELE A/ADIGE, 40040 FUNO DI ARGELATO). Con le prime tre cifre ne resta una.
//  - La citta': nessun comune o frazione italiana si chiama cosi' (la provincia tra parentesi non conta).
// Restano fuori, e passano come prima: CAP con lettere (refusi come 21O19, I37030, o paesi che le usano),
// indirizzi oscurati dal marketplace (asterischi), e i pochi esteri con un CAP dalla forma italiana
// (06000 NICE, come Perugia). Un CAP sbagliato con la citta' giusta passa come prima (99163 MESSINA).
// San Marino (4789x) ha la forma italiana: passa come oggi.
export function indirizzoEsteroComeItalia(
  cap: string | null | undefined,
  citta: string | null | undefined,
  paese: string | null | undefined,
): boolean {
  if ((paese || 'IT').toUpperCase().trim() !== 'IT') return false
  const c = (cap || '').trim()
  const town = (citta || '').trim()
  if (!c || !town || (c + town).includes('*')) return false
  if (/[a-z]/i.test(c)) return false
  if (/^\d{5}$/.test(c) && PREFISSI_ITALIANI.has(c.slice(0, 3))) return false
  return !NOMI_ITALIANI.has(normCitta(town.replace(/\([^)]*\)/g, '')))
}

export function capNotoInArchivio(cap: string): boolean {
  return PER_CAP.has((cap || '').trim())
}

// Risultato: ok=true se la città combacia con un nome noto per quel CAP (o se non è validabile:
// estero, CAP sconosciuto, dati mancanti → NON si blocca). `noti` = nomi ufficiali per quel CAP,
// per il messaggio d'errore ("selezionane uno").
export function validaCittaCap(
  cap: string | null | undefined,
  citta: string | null | undefined,
  paese?: string | null,
): { ok: boolean; validabile: boolean; noti: string[] } {
  const p = (paese || 'IT').toUpperCase().trim()
  const c = (cap || '').trim()
  const town = (citta || '').trim()
  // Non validabile → non blocca: solo Italia, CAP a 5 cifre noto all'archivio, città presente.
  if (p !== 'IT' || !/^\d{5}$/.test(c) || !town) return { ok: true, validabile: false, noti: [] }
  const e = PER_CAP.get(c)
  if (!e) return { ok: true, validabile: false, noti: [] }   // CAP non in archivio: non blocco (non so)
  const noti = Array.from(e.nomi).sort((a, b) => a.localeCompare(b))
  return { ok: e.norm.has(normCitta(town)), validabile: true, noti }
}

// NORMALIZZAZIONE AUTOMATICA (usata all'IMPORT, dove la città arriva dal negozio e non si può
// "selezionare"): se la città non è riconosciuta per il CAP MA quel CAP appartiene a UN SOLO comune,
// allora la scrittura diversa è quel comune (senza ambiguità: es. 42035 → "Castelnovo ne' Monti") →
// si restituisce il nome UFFICIALE da usare. Se la città è già valida → la si lascia com'è. Se il CAP
// ha PIÙ comuni (condiviso) e la città non combacia con nessuno → null: non si può decidere (là il
// chiamante blocca). Solo Italia + CAP a 5 cifre noto.
export function normalizzaCittaUfficiale(
  cap: string | null | undefined,
  citta: string | null | undefined,
  paese?: string | null,
): string | null {
  const v = validaCittaCap(cap, citta, paese)
  if (!v.validabile) return null           // estero / CAP sconosciuto / dati mancanti → non tocco
  if (v.ok) return (citta || '').trim()    // già valida → invariata
  const comuni = COMUNI_PER_CAP.get((cap || '').trim())
  if (comuni && comuni.size === 1) return Array.from(comuni)[0]   // CAP mono-comune → nome ufficiale
  return null                               // CAP condiviso, nessun match → non decidibile
}
