import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const { data: spedizioni } = await supabase
    .from('spedizioni')
    .select('id,numero,rif_destinatario,dest_nome,dest_citta,dest_cap,dest_provincia,peso_fatturato,peso_reale,colli,created_at,corriere_id,note,corrieri(nome_contratto)')
    .eq('cliente_id', clienteId)
    .is('distinta_id', null)
    .neq('stato', 'annullata')
    .order('created_at', { ascending: false })
    .limit(500)
  return NextResponse.json(spedizioni || [])
}