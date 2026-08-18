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

  // Pesi RIPESATI (reale + volumetrico) dalla rettifica. Il volumetrico ripesato è spesso il vero
  // motivo dell'addebito — un pacco di 2 kg reali ma 30 kg volumetrici si rettifica sui 30 kg — e va
  // mostrato al cliente, non lasciato a zero. Letto con la chiave di servizio ma RISTRETTO alle
  // spedizioni di QUESTO cliente (rettifiche non ha una policy di lettura lato cliente).
  const pesiRett = new Map<string, { reale: number; volume: number }>()
  if (ids.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminDb = createAdminSupabase()
    for (let i = 0; i < ids.length; i += 300) {
      const { data: rr } = await adminDb.from('rettifiche')
        .select('spedizione_id,peso_reale,peso_volume_reale')
        .eq('cliente_id', clienteId).in('spedizione_id', ids.slice(i, i + 300))
      for (const r of (rr || [])) {
        const k = (r as any).spedizione_id
        if (k) pesiRett.set(k, { reale: Number((r as any).peso_reale) || 0, volume: Number((r as any).peso_volume_reale) || 0 })
      }
    }
  }

  const righe = (speds || [])
    .map((s: any) => {
      const costoIniziale = Number(s.costo_totale || 0)          // addebitato alla creazione
      const rettifica = Math.abs(rettPerSped.get(s.id) || 0)     // conguaglio successivo
      const pr = pesiRett.get(s.id)
      const pesoReale = pr?.reale || Number(s.peso_reale || 0)
      const pesoVolReale = pr?.volume || 0
      return {
        numero: s.numero || '',
        pesoDichiarato: Number(s.peso_fatturato || 0),
        pesoVolDichiarato: Number(s.peso_volume || 0),
        pesoReale,
        pesoVolReale,
        // Il kg su cui si rettifica: il maggiore fra reale e volumetrico ripesato.
        pesoFatturato: Math.max(pesoReale, pesoVolReale),
        volumeVince: pesoVolReale > pesoReale,
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