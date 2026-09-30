import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { puntiInpost } from '@/lib/inpost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cerca i locker/punti InPost (APM/PUDO) vicino a una posizione o CAP, per un contratto InPost. Le
// credenziali (clientId/secretId/organizationId) restano LATO SERVER: al client tornano solo i punti
// pubblici (id, indirizzo, coordinate, 24/7). Serve al selettore-locker in creazione spedizione.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const p = req.nextUrl.searchParams
  const corriereId = p.get('corriereId') || ''
  const cap = (p.get('cap') || '').trim()
  const lat = p.get('lat') ? Number(p.get('lat')) : undefined
  const lng = p.get('lng') ? Number(p.get('lng')) : undefined
  const tipo = (p.get('tipo') || '').trim().toUpperCase()   // APM | PUDO (vuoto = tutti)
  if (!corriereId) return NextResponse.json({ error: 'Contratto mancante' }, { status: 400 })
  if (!cap && (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)))
    return NextResponse.json({ error: 'Serve un CAP o la posizione' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('id,master_id,tipo,credenziali').eq('id', corriereId).maybeSingle()
  if (!corr || corr.tipo !== 'inpost') return NextResponse.json({ error: 'Contratto non valido' }, { status: 404 })

  // Perimetro: il contratto dev'essere del master del chiamante o di un suo ANTENATO (i contratti
  // condivisi scendono lungo la catena). Vale per master/agente/cliente (tutti hanno master_id).
  const catena = new Set<string>()
  let cur: string | null = utente.master_id
  for (let i = 0; i < 25 && cur; i++) {
    catena.add(cur)
    const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = (m as any)?.parent_master_id || null
  }
  if (!catena.has(corr.master_id)) return NextResponse.json({ error: 'Contratto non disponibile' }, { status: 403 })

  const cred = (corr.credenziali || {}) as any
  if (!cred.clientId || !cred.secretId || !cred.organizationId) return NextResponse.json({ error: 'Contratto non configurato.' }, { status: 400 })

  try {
    const punti = await puntiInpost(
      { clientId: cred.clientId, secretId: cred.secretId, organizationId: cred.organizationId, ambiente: cred.ambiente === 'prod' ? 'prod' : 'stage' },
      { cap: cap || undefined, lat, lng, tipo: tipo || undefined, maxDistanza: 15000, limite: 40 },
    )
    return NextResponse.json({ punti })
  } catch (e: any) {
    console.error('[INPOST][PUNTI]', String(e?.message || e).slice(0, 150))
    return NextResponse.json({ error: 'Ricerca punti non disponibile in questo momento.' }, { status: 502 })
  }
}
