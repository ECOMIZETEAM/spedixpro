import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  const masterId = utente?.master_id
  if (!clienteId) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', clienteId).single()
  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()
  const p = req.nextUrl.searchParams
  const dal = p.get('dal'); const al = p.get('al')
  const statoSped = p.get('statoSpedizione')
  let query = supabase.from('spedizioni')
    .select('numero,dest_nome,contrassegno,stato,created_at')
    .eq('cliente_id', clienteId)
    .gt('contrassegno', 0)
    .order('created_at', { ascending: true })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  if (statoSped && statoSped !== 'tutti') query = query.eq('stato', statoSped)
  const { data: speds } = await query
  const righe = (speds || []).map(s => ({
    data: s.created_at, spedizione: (s.numero||'') + ' - ' + (s.dest_nome||''),
    contrassegno: Number(s.contrassegno||0), statoContr: 'In attesa', statoSpedizione: s.stato||'',
  }))
  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })
}