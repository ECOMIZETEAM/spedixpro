import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({})
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({})
  const { data: c } = await supabase.from('clienti')
    .select('ragione_sociale,telefono,email,so_indirizzo,so_cap,so_citta,so_provincia')
    .eq('id', clienteId).single()
  if (!c) return NextResponse.json({})
  return NextResponse.json({
    nome: c.ragione_sociale || '',
    indirizzo_operativo: c.so_indirizzo || '',
    cap_operativo: c.so_cap || '',
    citta_operativo: c.so_citta || '',
    provincia_operativo: c.so_provincia || '',
    telefono: c.telefono || '',
    email: c.email || '',
  })
}