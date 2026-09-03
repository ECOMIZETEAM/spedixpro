import { NextResponse } from 'next/server'
import { verificaSuperMaster } from '@/lib/controllo-guard'
import { trovaProblemiZoneListini } from '@/lib/controllo-zone-listini'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const g = await verificaSuperMaster()
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status })
  try { return NextResponse.json(await trovaProblemiZoneListini()) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore nel controllo' }, { status: 500 }) }
}
