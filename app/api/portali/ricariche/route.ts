import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Funzione ATTIVA SOLO per E&A MULTIEXPRESS: gestisce i crediti dei portali esterni
// (SpediamoPro / Spedisci.online) da cui compra i contratti per rivendere.
const EA_ID = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ abilitato: false })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ abilitato: false })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // Ricariche registrate sui portali.
  const { data: ricariche } = await admin.from('ricariche_portale')
    .select('*').eq('master_id', EA_ID).order('created_at', { ascending: false })

  // Speso = movimenti di spedizione di E&A, raggruppati per TIPO del corriere
  // (spedisci = SDA; spediamopro = tutto il resto).
  const { data: movs } = await admin.from('movimenti')
    .select('importo, spedizione_id').eq('master_target_id', EA_ID).eq('tipo', 'spedizione')
  const spedIds = Array.from(new Set((movs || []).map((m: any) => m.spedizione_id).filter(Boolean)))
  const tipoPerSped = new Map<string, string | null>()
  if (spedIds.length) {
    const { data: speds } = await admin.from('spedizioni').select('id, corrieri(tipo)').in('id', spedIds)
    for (const s of (speds || [])) tipoPerSped.set(s.id, (s.corrieri as any)?.tipo || null)
  }
  let spesoSpediamo = 0, spesoSpedisci = 0
  for (const m of (movs || [])) {
    const tipo = m.spedizione_id ? tipoPerSped.get(m.spedizione_id) : null
    const imp = Math.abs(Number(m.importo) || 0)
    if (tipo === 'spedisci') spesoSpedisci += imp
    else if (tipo === 'spediamopro') spesoSpediamo += imp
  }

  const ricSpediamo = (ricariche || []).filter((r: any) => r.portale === 'spediamopro').reduce((s: number, r: any) => s + Number(r.importo || 0), 0)
  const ricSpedisci = (ricariche || []).filter((r: any) => r.portale === 'spedisci').reduce((s: number, r: any) => s + Number(r.importo || 0), 0)
  const r2 = (n: number) => Math.round(n * 100) / 100

  return NextResponse.json({
    abilitato: true,
    ricariche: ricariche || [],
    portali: {
      spediamopro: { ricariche: r2(ricSpediamo), speso: r2(spesoSpediamo), residuo: r2(ricSpediamo - spesoSpediamo) },
      spedisci: { ricariche: r2(ricSpedisci), speso: r2(spesoSpedisci), residuo: r2(ricSpedisci - spesoSpedisci) },
    },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json()
  const portale = body.portale === 'spedisci' ? 'spedisci' : (body.portale === 'spediamopro' ? 'spediamopro' : null)
  const importo = Number(body.importo)
  if (!portale) return NextResponse.json({ error: 'Portale non valido' }, { status: 400 })
  if (!isFinite(importo) || importo === 0) return NextResponse.json({ error: 'Inserisci un importo diverso da 0 (usa il − per correggere)' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { error } = await admin.from('ricariche_portale').insert({
    master_id: EA_ID, portale, importo, data: body.data || null,
    note: body.note ? String(body.note).slice(0, 200) : null, created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { error } = await admin.from('ricariche_portale').delete().eq('id', id).eq('master_id', EA_ID)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
