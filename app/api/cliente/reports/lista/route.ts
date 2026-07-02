import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const tipo = req.nextUrl.searchParams.get('tipo')
  try {
    let query = supabase.from('reports_generati')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (tipo) query = query.eq('tipo', tipo)
    const { data, error } = await query
    if (error) return NextResponse.json([])
    return NextResponse.json(data || [])
  } catch {
    return NextResponse.json([])
  }
}