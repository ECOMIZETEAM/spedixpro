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
  let query = supabase.from('movimenti_clienti')
    .select('descrizione,prezzo_unitario,quantita,importo,iva,totale_iva,totale,data_acquisto,created_at')
    .eq('cliente_id', clienteId)
    .order('data_acquisto', { ascending: true })
  if (dal) query = query.gte('data_acquisto', dal)
  if (al) query = query.lte('data_acquisto', al)
  const { data: mov } = await query
  const righe = (mov || []).map(m => ({
    descrizione: m.descrizione || '',
    quantita: Number(m.quantita || 0),
    costoUnita: Number(m.prezzo_unitario || 0),
    costoTotale: Number(m.importo || (Number(m.prezzo_unitario||0) * Number(m.quantita||0))),
    iva: Number(m.iva || 0),
    data: m.data_acquisto || m.created_at,
    totaleIvaInc: Number(m.totale || 0),
  }))
  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })
}