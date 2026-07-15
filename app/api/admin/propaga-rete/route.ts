import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { copiaListinoAlSottoMaster } from '@/lib/copia-listino-submaster'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Trigger ONE-OFF (protetto da secret) per ri-sincronizzare a cascata i listini dei sotto-master
// dopo il fix di propagazione dei CAP. Sicuro: l'operazione è idempotente (ri-materializza il
// listino del padre). ?only=<subId> per testare su un solo sotto-master. Rimuovere dopo l'uso.
const SECRET = 'PRP-9f3a2c7e-moove-2026-07-15-zone-cap-sync'
const EA = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'   // E&A MULTIEXPRESS (rete target)

export async function POST(req: NextRequest) {
  const p = req.nextUrl.searchParams
  if (p.get('secret') !== SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const admin = createAdminSupabase()
  const only = p.get('only')

  // Discendenti di E&A (BFS)
  const targets: string[] = []
  if (only) {
    targets.push(only)
  } else {
    let frontier = [EA]
    for (let i = 0; i < 15 && frontier.length; i++) {
      const { data: figli } = await admin.from('masters').select('id').in('parent_master_id', frontier)
      const nuovi = (figli || []).map((f: any) => f.id).filter((id: string) => !targets.includes(id))
      targets.push(...nuovi)
      frontier = nuovi
    }
  }

  const esiti: any[] = []
  for (const id of targets) {
    try {
      const res = await copiaListinoAlSottoMaster(admin, id, { force: true })
      esiti.push({ id, ...res })
    } catch (e: any) {
      esiti.push({ id, ok: false, error: String(e?.message || e) })
    }
  }
  return NextResponse.json({ totale: targets.length, ok: esiti.filter(e => e.ok).length, esiti })
}
