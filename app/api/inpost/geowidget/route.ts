import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Config del Geowidget InPost (la mappa dei locker) per un contratto. Ritorna il TOKEN PUBBLICO del
// widget — è pubblico per natura (InPost lo lega ai NOSTRI domini), quindi può stare lato client — e
// l'ambiente (prod/sandbox) per scegliere l'URL dello script. Il token si configura in
// corrieri.settings.geowidget_token (o, in mancanza, env INPOST_GEOWIDGET_TOKEN). Se non c'è, il
// selettore ripiega sulla ricerca a lista (/api/inpost/punti). Stesso perimetro-catena dei punti.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const corriereId = req.nextUrl.searchParams.get('corriereId') || ''
  if (!corriereId) return NextResponse.json({ error: 'Contratto mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('id,master_id,tipo,credenziali,settings').eq('id', corriereId).maybeSingle()
  if (!corr || corr.tipo !== 'inpost') return NextResponse.json({ error: 'Contratto non valido' }, { status: 404 })

  // Perimetro: il contratto dev'essere del master del chiamante o di un suo ANTENATO (catena).
  const catena = new Set<string>()
  let cur: string | null = utente.master_id
  for (let i = 0; i < 25 && cur; i++) {
    catena.add(cur)
    const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = (m as any)?.parent_master_id || null
  }
  if (!catena.has(corr.master_id)) return NextResponse.json({ error: 'Contratto non disponibile' }, { status: 403 })

  const token = String((corr.settings as any)?.geowidget_token || process.env.INPOST_GEOWIDGET_TOKEN || '').trim()
  const ambiente = ((corr.credenziali as any)?.ambiente === 'prod') ? 'prod' : 'stage'
  // token vuoto = niente mappa (il client ripiega sulla lista). Non è un errore.
  return NextResponse.json({ token: token || null, ambiente })
}
