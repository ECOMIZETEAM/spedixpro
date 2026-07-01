import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('clienti')
    .select('id,ragione_sociale,so_indirizzo,so_citta,so_provincia,so_cap,sl_citta,email,telefono,piva,codice_cliente,attivo,listino_cliente_id,tipo_contratto,credito,listini_clienti(nome)')
    .eq('master_id', utente?.master_id)
    .order('ragione_sociale')
  return NextResponse.json(data || [])
}
