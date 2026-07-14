import { NextRequest, NextResponse } from 'next/server'
import comuni from '@/lib/data/comuni.json'

type Comune = { nome: string; sigla: string; provincia: string; cap: string[] }
const DATA = comuni as Comune[]

// Autocomplete comune/CAP per Nuova Spedizione.
// - Se digiti un NOME -> comuni corrispondenti con TUTTI i loro CAP.
// - Se digiti un CAP (solo cifre) -> ricerca inversa: dal CAP al comune/provincia
//   (copre anche le frazioni: es. il CAP di Giampilieri risolve su Messina).
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('q') || '').trim()
  const q = raw.toLowerCase()
  if (q.length < 2) return NextResponse.json([])

  // ── Ricerca inversa per CAP (solo cifre) ─────────────────────────────
  if (/^\d{2,5}$/.test(raw)) {
    const voci: { nome: string; sigla: string; provincia: string; cap: string }[] = []
    for (const c of DATA) {
      for (const cap of c.cap) {
        if (cap.startsWith(raw)) voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap })
      }
    }
    voci.sort((a, b) => a.cap.localeCompare(b.cap) || a.nome.localeCompare(b.nome))
    return NextResponse.json(voci.slice(0, 80))
  }

  // ── Ricerca per nome comune ──────────────────────────────────────────
  const startsWith: Comune[] = []
  const contains: Comune[] = []
  for (const c of DATA) {
    const n = c.nome.toLowerCase()
    if (n.startsWith(q)) startsWith.push(c)
    else if (n.includes(q)) contains.push(c)
  }
  startsWith.sort((a, b) => a.nome.localeCompare(b.nome))
  contains.sort((a, b) => a.nome.localeCompare(b.nome))
  const risultati = [...startsWith, ...contains].slice(0, 40)

  const voci: { nome: string; sigla: string; provincia: string; cap: string }[] = []
  for (const c of risultati) {
    // TUTTI i CAP del comune (prima erano troncati a 6 -> per Bologna/Roma/Milano
    // e le altre città con molti CAP ne mancavano parecchi).
    if (c.cap.length <= 1) {
      voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap: c.cap[0] || '' })
    } else {
      for (const cap of c.cap) voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap })
    }
    if (voci.length >= 150) break
  }
  return NextResponse.json(voci.slice(0, 150))
}
