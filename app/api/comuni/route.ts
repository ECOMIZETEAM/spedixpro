import { NextRequest, NextResponse } from 'next/server'
import comuni from '@/lib/data/comuni.json'
import frazioni from '@/lib/data/frazioni.json'

type Comune = { nome: string; sigla: string; provincia: string; cap: string[] }
type Loc = { nome: string; sigla: string; provincia: string; cap: string }
const COMUNI = comuni as Comune[]
const FRAZIONI = frazioni as Loc[]   // frazioni/località (GeoNames) non già presenti come comuni

type Voce = { nome: string; sigla: string; provincia: string; cap: string }

// COME SI CONFRONTANO I NOMI: senza apostrofi, senza accenti, senza spazi.
//
// Nell'archivio 960 località hanno l'apostrofo DRITTO (Sant'Antonio, L'Aquila, Villa d'Adda) e
// nessuna ha quello CURVO. Ma iPhone e Mac, con la correzione automatica, scrivono quello curvo (’):
// chi cercava "Sant'Antonio" dal telefono non trovava NIENTE e concludeva che la località non c'è.
// Stessa sorte per chi scrive "Sant Antonio" staccato o "Cefalu" senza accento — tutti modi normali
// di battere un indirizzo, tutti a vuoto.
// Togliendo apostrofi e spazi le tre forme diventano la stessa cosa e il confronto smette di
// dipendere da quale tastiera ha in mano chi spedisce.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenti: Cefalù -> cefalu
    .replace(/[’ʼ`´']/g, '')        // ’ ʼ ` ´ ' -> via
    .replace(/\s+/g, '')                                // "sant antonio" == "sant'antonio"
}

// Le chiavi si calcolano UNA VOLTA sola al caricamento del modulo, non a ogni battuta:
// sono ~18.000 nomi e l'autocomplete parte a ogni tasto premuto.
const COMUNI_K = COMUNI.map((c) => ({ c, k: norm(c.nome) }))
const FRAZIONI_K = FRAZIONI.map((f) => ({ f, k: norm(f.nome) }))

// Autocomplete comune/frazione/CAP per Nuova Spedizione.
// - NOME  -> comuni + frazioni corrispondenti (comuni prima), coi loro CAP.
// - CAP (solo cifre) -> ricerca inversa dal CAP a comune/frazione + provincia.
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('q') || '').trim()

  // ── Ricerca inversa per CAP (solo cifre) ─────────────────────────────
  if (/^\d{2,5}$/.test(raw)) {
    const voci: Voce[] = []
    for (const c of COMUNI) for (const cap of c.cap) {
      if (cap.startsWith(raw)) voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap })
    }
    for (const f of FRAZIONI) {
      if (f.cap.startsWith(raw)) voci.push({ nome: f.nome, sigla: f.sigla, provincia: f.provincia, cap: f.cap })
    }
    voci.sort((a, b) => a.cap.localeCompare(b.cap) || a.nome.localeCompare(b.nome))
    return NextResponse.json(voci.slice(0, 80))
  }

  // ── Ricerca per nome (comuni + frazioni) ─────────────────────────────
  // La soglia si misura sul testo NORMALIZZATO: "S'" da solo sono due caratteri ma una lettera.
  const q = norm(raw)
  if (q.length < 2) return NextResponse.json([])

  const cSW: Comune[] = [], cCO: Comune[] = []
  for (const { c, k } of COMUNI_K) {
    if (k.startsWith(q)) cSW.push(c); else if (k.includes(q)) cCO.push(c)
  }
  const fSW: Loc[] = [], fCO: Loc[] = []
  for (const { f, k } of FRAZIONI_K) {
    if (k.startsWith(q)) fSW.push(f); else if (k.includes(q)) fCO.push(f)
  }
  cSW.sort((a, b) => a.nome.localeCompare(b.nome)); cCO.sort((a, b) => a.nome.localeCompare(b.nome))
  fSW.sort((a, b) => a.nome.localeCompare(b.nome)); fCO.sort((a, b) => a.nome.localeCompare(b.nome))

  const voci: Voce[] = []
  const pushComune = (c: Comune) => {
    // TUTTI i CAP del comune (prima erano troncati a 6 -> mancavano quelli delle città grandi)
    if (c.cap.length <= 1) voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap: c.cap[0] || '' })
    else for (const cap of c.cap) voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap })
  }
  const pushLoc = (f: Loc) => voci.push({ nome: f.nome, sigla: f.sigla, provincia: f.provincia, cap: f.cap })

  // Ordine: comuni "inizia con" -> frazioni "inizia con" -> comuni "contiene" -> frazioni "contiene"
  for (const c of cSW.slice(0, 40)) pushComune(c)
  for (const f of fSW.slice(0, 60)) pushLoc(f)
  for (const c of cCO.slice(0, 20)) pushComune(c)
  for (const f of fCO.slice(0, 20)) pushLoc(f)

  return NextResponse.json(voci.slice(0, 160))
}
