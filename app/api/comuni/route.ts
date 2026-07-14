import { NextRequest, NextResponse } from 'next/server'
import comuni from '@/lib/data/comuni.json'
import frazioni from '@/lib/data/frazioni.json'

type Comune = { nome: string; sigla: string; provincia: string; cap: string[] }
type Loc = { nome: string; sigla: string; provincia: string; cap: string }
const COMUNI = comuni as Comune[]
const FRAZIONI = frazioni as Loc[]   // frazioni/località (GeoNames) non già presenti come comuni

type Voce = { nome: string; sigla: string; provincia: string; cap: string }

// Autocomplete comune/frazione/CAP per Nuova Spedizione.
// - NOME  -> comuni + frazioni corrispondenti (comuni prima), coi loro CAP.
// - CAP (solo cifre) -> ricerca inversa dal CAP a comune/frazione + provincia.
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('q') || '').trim()
  const q = raw.toLowerCase()
  if (q.length < 2) return NextResponse.json([])

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
  const cSW: Comune[] = [], cCO: Comune[] = []
  for (const c of COMUNI) {
    const n = c.nome.toLowerCase()
    if (n.startsWith(q)) cSW.push(c); else if (n.includes(q)) cCO.push(c)
  }
  const fSW: Loc[] = [], fCO: Loc[] = []
  for (const f of FRAZIONI) {
    const n = f.nome.toLowerCase()
    if (n.startsWith(q)) fSW.push(f); else if (n.includes(q)) fCO.push(f)
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
