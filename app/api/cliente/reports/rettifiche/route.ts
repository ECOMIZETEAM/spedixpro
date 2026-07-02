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
  let query = supabase.from('spedizioni')
    .select('numero,peso_fatturato,peso_reale,peso_volume,costo_spedizione,costo_totale,created_at')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await query
  const righe = (speds || []).map(s => {
    const costoIniziale = Number(s.costo_spedizione || 0)
    const costoFinale = Number(s.costo_totale || 0)
    return {
      numero: s.numero || '',
      pesoDichiarato: Number(s.peso_fatturato || 0),
      pesoVolDichiarato: Number(s.peso_volume || 0),
      pesoReale: Number(s.peso_reale || 0),
      pesoVolReale: 0,
      costoIniziale, costoFinale,
      differenza: costoIniziale - costoFinale,
    }
  })
  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })
}