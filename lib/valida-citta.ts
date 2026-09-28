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
function aggiungi(cap: string, nome: string) {
  if (!cap || !nome) return
  let e = PER_CAP.get(cap)
  if (!e) { e = { norm: new Set(), nomi: new Set() }; PER_CAP.set(cap, e) }
  e.norm.add(normCitta(nome)); e.nomi.add(nome)
}
for (const c of comuni as Comune[]) for (const cap of (c.cap || [])) {
  aggiungi(cap, c.nome)
  let s = COMUNI_PER_CAP.get(cap); if (!s) { s = new Set(); COMUNI_PER_CAP.set(cap, s) }
  s.add(c.nome)
}
for (const f of frazioni as Loc[]) aggiungi(f.cap, f.nome)

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
