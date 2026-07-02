import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ distinte: [], master: {}, cliente: {} })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  const masterId = utente?.master_id
  if (!clienteId) return NextResponse.json({ distinte: [], master: {}, cliente: {} })
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', clienteId).single()
  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()
  const p = req.nextUrl.searchParams
  const dal = p.get('dal'); const al = p.get('al')
  let query = supabase.from('distinte')
    .select('id,numero,data,created_at,totale_colli')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: distinteRaw } = await query
  const distinte = []
  for (const d of distinteRaw || []) {
    const { data: speds } = await supabase.from('spedizioni').select('costo_totale').eq('distinta_id', d.id)
    const nSped = (speds || []).length
    const totale = (speds || []).reduce((a, s) => a + (Number(s.costo_totale) || 0), 0)
    distinte.push({ numero: d.numero, spedizioni: nSped, totale, data: d.created_at })
  }
  return NextResponse.json({
    distinte,
    master: master || {},
    cliente: { ragione_sociale: cliente?.ragione_sociale || '' },
  })
}