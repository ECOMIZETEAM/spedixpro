import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const { metodoPagamento } = body

  const { error } = await supabase.from('distinte_contrassegni').update({
    stato: 'pagata',
    metodo_pagamento: metodoPagamento,
    data_pagamento: new Date().toISOString().split('T')[0],
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Aggiorna stato contrassegno spedizioni
  const { data: righe } = await supabase.from('distinte_contrassegni_righe')
    .select('spedizione_id').eq('distinta_id', id)
  if (righe?.length) {
    await supabase.from('spedizioni').update({ stato_contrassegno: 'pagato' })
      .in('id', righe.map(r => r.spedizione_id))
  }

  return NextResponse.json({ success: true })
}