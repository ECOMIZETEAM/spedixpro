import { NextRequest, NextResponse } from 'next/server'
import comuni from '@/lib/data/comuni.json'

type Comune = { nome: string; sigla: string; provincia: string; cap: string[] }
const DATA = comuni as Comune[]

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  if (q.length < 2) return NextResponse.json([])

  const startsWith: Comune[] = []
  const contains: Comune[] = []
  for (const c of DATA) {
    const n = c.nome.toLowerCase()
    if (n.startsWith(q)) startsWith.push(c)
    else if (n.includes(q)) contains.push(c)
  }
  // prima quelli che iniziano con q (ordinati), poi quelli che contengono
  startsWith.sort((a, b) => a.nome.localeCompare(b.nome))
  contains.sort((a, b) => a.nome.localeCompare(b.nome))
  const risultati = [...startsWith, ...contains].slice(0, 40)

  const voci: { nome: string; sigla: string; provincia: string; cap: string }[] = []
  for (const c of risultati) {
    if (c.cap.length <= 1) {
      voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap: c.cap[0] || '' })
    } else {
      for (const cap of c.cap.slice(0, 6)) {
        voci.push({ nome: c.nome, sigla: c.sigla, provincia: c.provincia, cap })
      }
    }
  }
  return NextResponse.json(voci.slice(0, 60))
}
