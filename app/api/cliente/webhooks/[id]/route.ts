import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Elimina un webhook del cliente
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { error } = await admin.from('webhooks').delete().eq('id', id).eq('cliente_id', utente.cliente_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
