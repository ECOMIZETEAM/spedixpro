import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale,credito').eq('id', clienteId).single()
  const now = new Date()
  const fa30gg = new Date(now.getTime() - 30*24*60*60*1000).toISOString()
  // Contatori esatti in un'unica funzione DB (invece di 4 count separati)
  const [
    { data: contatori },
    { data: tutteSpedizioni },
    { data: ultimeSpedizioni },
  ] = await Promise.all([
    supabase.rpc('dashboard_contatori_cliente', { p_cliente: clienteId }),
    supabase.from('spedizioni').select('stato,created_at,costo_totale').eq('cliente_id', clienteId).gte('created_at', new Date(now.getFullYear()-1, now.getMonth(), 1).toISOString()),
    supabase.from('spedizioni').select(SPED_COLS).eq('cliente_id', clienteId).order('created_at',{ascending:false}).limit(10),
  ])
  const c: any = contatori || {}
  const statsMensili: Record<string,{totale:number,importo:number}> = {}
  for (const s of tutteSpedizioni||[]) {
    const d = new Date(s.created_at)
    const key = `${d.toLocaleString('en',{month:'short'})} ${d.getFullYear().toString().slice(2)}`
    if (!statsMensili[key]) statsMensili[key] = {totale:0,importo:0}
    statsMensili[key].totale++
    statsMensili[key].importo += parseFloat(s.costo_totale||0)
  }
  const statiUltimi30: Record<string,number> = {}
  const spedizioni30 = (tutteSpedizioni||[]).filter(s => new Date(s.created_at) >= new Date(fa30gg))
  for (const s of spedizioni30) {
    statiUltimi30[s.stato] = (statiUltimi30[s.stato]||0) + 1
  }
  return NextResponse.json({
    clienteNome: cliente?.ragione_sociale || 'Cliente',
    credito: Number(cliente?.credito || 0),
    spedizioniMese: c.spedizioniMese||0,
    limiteMese: 50000,
    spediteOggi: c.spediteOggi||0,
    daSpedire: c.daSpedire||0,
    inLavorazione: c.inLavorazione||0,
    statsMensili: Object.entries(statsMensili).map(([mese,v])=>({mese,...v})),
    statiUltimi30,
    ultimeSpedizioni: ultimeSpedizioni||[],
  })
}