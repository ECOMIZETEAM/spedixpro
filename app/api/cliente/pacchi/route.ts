import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
async function getCliente(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  return utente?.cliente_id ? utente : null
}
export async function GET() {
  const supabase = await createServerSupabase()
  const u = await getCliente(supabase)
  if (!u) return NextResponse.json([])
  const { data } = await supabase.from('pacchi_predefiniti')
    .select('*').eq('cliente_id', u.cliente_id).order('created_at', { ascending: true })
  return NextResponse.json(data || [])
}
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const u = await getCliente(supabase)
  if (!u) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const b = await req.json()
  const record = {
    cliente_id: u.cliente_id, master_id: u.master_id,
    nome: b.nome, peso: Number(b.peso) || 0,
    lunghezza: Number(b.lunghezza) || 0, larghezza: Number(b.larghezza) || 0, altezza: Number(b.altezza) || 0,
    predefinito: !!b.predefinito,
  }
  if (b.predefinito) {
    await supabase.from('pacchi_predefiniti').update({ predefinito: false }).eq('cliente_id', u.cliente_id)
  }
  if (b.id) {
    const { error } = await supabase.from('pacchi_predefiniti').update(record).eq('id', b.id).eq('cliente_id', u.cliente_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } else {
    const { error } = await supabase.from('pacchi_predefiniti').insert(record)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }
}
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const u = await getCliente(supabase)
  if (!u) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { error } = await supabase.from('pacchi_predefiniti').delete().eq('id', id).eq('cliente_id', u.cliente_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}