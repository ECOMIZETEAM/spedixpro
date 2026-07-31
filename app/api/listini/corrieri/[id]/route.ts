import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'

export async function GET(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  // Questo listino contiene i COSTI D'ACQUISTO del master: cliente e agente non devono vederlo,
  // perche' confrontandolo col prezzo che pagano ricavano il margine. La rotta gemella
  // /api/listini/corrieri il controllo ce l'ha; qui mancava, e c'era solo l'affidamento alla RLS.
  const { data: chi } = await supabase.from('utenti').select('ruolo').eq('id', user.id).single()
  const _r = String(chi?.ruolo || '').toLowerCase()
  if (_r === 'cliente' || _r === 'agente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const { data } = await supabase.from('listini_corrieri')
    .select('*, corrieri(nome_contratto,tipo,logo_url), listini_corrieri_fasce(*), listini_corrieri_supplementi(*)')
    .eq('id', id).single()
  return NextResponse.json(data || {})
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  if (String((utente as any)?.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // Sola lettura solo per i rivenditori puri (non il titolare dei contratti).
  {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { listinoCorrieriSolaLettura } = await import('@/lib/rete-masters')
    const admin = createAdminSupabase()
    if (await listinoCorrieriSolaLettura(admin, utente?.master_id)) return NextResponse.json({ error: 'Questo listino è assegnato dal tuo master: è in sola lettura e non può essere modificato.' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { fasce, supplementi } = body

  await supabase.from('listini_corrieri_fasce').delete().eq('listino_id', id)
  await supabase.from('listini_corrieri_supplementi').delete().eq('listino_id', id)

  if (fasce?.length) {
    await supabase.from('listini_corrieri_fasce').insert(
      fasce.map((f: any) => ({ ...f, listino_id: id }))
    )
  }
  if (supplementi?.length) {
    await supabase.from('listini_corrieri_supplementi').insert(
      supplementi.map((s: any) => ({ ...s, listino_id: id }))
    )
  }
  return NextResponse.json({ success: true })
}