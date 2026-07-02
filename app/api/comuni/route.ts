import { NextRequest, NextResponse } from 'next/server'
import comuni from '@/lib/data/comuni.json'

type Comune = { nome: string; sigla: string; provincia: string; cap: string[] }
const DATA = comuni as Comune[]

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  if (q.length < 2) return NextResponse.json([])

  // match: nome che inizia con q (priorità), poi che contiene q
  const startsWith: Comune[] = []
  const contains: Comune[] = []
  for (const c of DATA) {
    const n = c.nome.toLowerCase()
    if (n.startsWith(q)) startsWith.push(c)
    else if (n.includes(q)) contains.push(c)
    if (startsWith.length >= 15) break
  }
  const risultati = [...startsWith, ...contains].slice(0, 15)

  // Espando: ogni comune con più CAP genera una voce per CAP (per la tendina città+cap)
  const voci: { nome: string; sigla: string; provincia: string; cap: string }[] = []
  for (const c of risultati) {
    if (c.cap.length <= 1) {
      voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap: c.cap[0] || '' })
    } else {
      // comune multi-CAP: prima voce col CAP "generico" (primo), le altre disponibili
      for (const cap of c.cap.slice(0, 8)) {
        voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap })
      }
    }
  }
  return NextResponse.json(voci.slice(0, 30))
}
