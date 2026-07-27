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
  // Le spese del cliente stanno in 'movimenti' (giacenze, resi, rettifiche/consumabili).
  // Prima si leggeva 'movimenti_clienti', un registro parallelo mai popolato: il report
  // usciva sempre a zero anche con gli addebiti realmente effettuati.
  let query = supabase.from('movimenti')
    .select('descrizione,importo,created_at')
    .eq('cliente_id', clienteId)
    .in('tipo', ['rettifica', 'giacenza', 'reso'])
    .order('created_at', { ascending: true })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data: mov } = await query
  const righe = (mov || []).map(m => {
    const importo = Math.abs(Number(m.importo || 0))
    return {
      descrizione: m.descrizione || '',
      quantita: 1,
      costoUnita: importo,
      costoTotale: importo,
      iva: 0,
      data: (m.created_at || '').split('T')[0],
      totaleIvaInc: importo,
    }
  })
  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })
}