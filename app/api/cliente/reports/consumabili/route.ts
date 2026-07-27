import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
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
  // fetchAll: senza, PostgREST tronca a 1000 righe in silenzio e il documento consegnato al
  // cliente risulterebbe sottostimato senza alcun avviso.
  const mov = await fetchAll(() => {
    let q = supabase.from('movimenti')
      .select('descrizione,importo,created_at,tipo,spedizione_id')
      .eq('cliente_id', clienteId)
      .in('tipo', ['rettifica', 'giacenza', 'reso'])
      .order('created_at', { ascending: true })
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  })
  // Una rettifica su spedizione poi annullata è già stata stornata (movimento 'rimborso'):
  // lasciarla nel report significherebbe chiedere al cliente soldi già restituiti.
  const idSped = Array.from(new Set(mov.filter((m: any) => m.tipo === 'rettifica' && m.spedizione_id)
    .map((m: any) => m.spedizione_id)))
  const stornate = new Set<string>()
  for (let i = 0; i < idSped.length; i += 200) {
    const { data } = await supabase.from('movimenti').select('spedizione_id')
      .in('spedizione_id', idSped.slice(i, i + 200)).eq('tipo', 'rimborso')
    for (const r of (data || [])) stornate.add((r as any).spedizione_id)
  }
  const righe = mov
    .filter((m: any) => !(m.tipo === 'rettifica' && stornate.has(m.spedizione_id)))
    .map((m: any) => {
      // Segno conservato: l'addebito (importo negativo) esce positivo, l'ACCREDITO esce
      // negativo e abbassa il totale invece di gonfiarlo.
      const importo = -(Number(m.importo || 0))
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