import { NextRequest, NextResponse } from 'next/server'
import { verificaSuperMaster } from '@/lib/controllo-guard'
import { trovaLogErrori } from '@/lib/controllo-log-errori'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const g = await verificaSuperMaster()
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status })
  const giorni = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('giorni') || '14', 10) || 14, 1), 90)
  try { return NextResponse.json(await trovaLogErrori(giorni)) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore nel controllo' }, { status: 500 }) }
}
