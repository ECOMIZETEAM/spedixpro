import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const dal = p.get('dal'); const al = p.get('al')
  const vettore = p.get('vettore')
  if (!clienteId) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', clienteId).single()
  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()
  let query = supabase.from('spedizioni')
    .select('numero,peso_fatturato,peso_reale,peso_volume,costo_spedizione,costo_totale,created_at,corriere_id,corrieri(nome_contratto)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await query
  // Filtro vettore: match sul primo termine di nome_contratto (come nella lista spedizioni)
  const spedsFiltrate = vettore
    ? (speds || []).filter((s: any) => String(s.corrieri?.nome_contratto || '').split(' ')[0] === vettore)
    : (speds || [])
  const righe = spedsFiltrate.map(s => {
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