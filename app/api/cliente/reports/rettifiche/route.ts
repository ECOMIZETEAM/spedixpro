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
  // MAI `costo_spedizione` in un report del cliente: e' quanto il MASTER paga al corriere, e la
  // differenza col prezzo del cliente e' il guadagno del master. Prima questo report la calcolava
  // e la mostrava: su una spedizione da 15,00 col costo master di 4,38 il cliente leggeva 10,62.
  // La rettifica va ricostruita dai numeri DEL CLIENTE: quanto gli e' stato addebitato alla
  // creazione (costo_totale) e quanto gli e' stato addebitato dopo, col movimento di rettifica.
  let query = supabase.from('spedizioni')
    .select('id,numero,peso_fatturato,peso_reale,peso_volume,costo_totale,created_at')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await query

  // Rettifiche addebitate a QUESTO cliente, per spedizione (importo negativo = addebito in piu').
  const ids = (speds || []).map((s: any) => s.id).filter(Boolean)
  const rettPerSped = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: mv } = await supabase.from('movimenti')
      .select('spedizione_id,importo').eq('tipo', 'rettifica').eq('cliente_id', clienteId)
      .in('spedizione_id', ids.slice(i, i + 300))
    for (const m of (mv || [])) {
      const k = (m as any).spedizione_id
      rettPerSped.set(k, (rettPerSped.get(k) || 0) + Number((m as any).importo || 0))
    }
  }

  const righe = (speds || [])
    .map((s: any) => {
      const costoIniziale = Number(s.costo_totale || 0)          // addebitato alla creazione
      const rettifica = Math.abs(rettPerSped.get(s.id) || 0)     // conguaglio successivo
      return {
        numero: s.numero || '',
        pesoDichiarato: Number(s.peso_fatturato || 0),
        pesoVolDichiarato: Number(s.peso_volume || 0),
        pesoReale: Number(s.peso_reale || 0),
        pesoVolReale: 0,
        costoIniziale,
        costoFinale: Math.round((costoIniziale + rettifica) * 100) / 100,
        differenza: rettifica,
      }
    })
    // Un report di RETTIFICHE mostra le spedizioni rettificate: senza conguaglio non c'e' nulla da
    // dire, e prima l'elenco usciva pieno di righe con una differenza che era il margine del master.
    .filter((r: any) => r.differenza > 0)
  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })
}