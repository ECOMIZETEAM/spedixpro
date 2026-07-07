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
  // Contatori + statistiche aggregati nel DB (una query ciascuno)
  const [
    { data: contatori },
    { data: statistiche },
    { data: ultimeSpedizioni },
  ] = await Promise.all([
    supabase.rpc('dashboard_contatori_cliente', { p_cliente: clienteId }),
    supabase.rpc('dashboard_statistiche_cliente', { p_cliente: clienteId }),
    supabase.from('spedizioni').select(SPED_COLS).eq('cliente_id', clienteId).order('created_at',{ascending:false}).limit(10),
  ])
  const c: any = contatori || {}
  const st: any = statistiche || {}
  return NextResponse.json({
    clienteNome: cliente?.ragione_sociale || 'Cliente',
    credito: Number(cliente?.credito || 0),
    spedizioniMese: c.spedizioniMese||0,
    limiteMese: 50000,
    spediteOggi: c.spediteOggi||0,
    daSpedire: c.daSpedire||0,
    inLavorazione: c.inLavorazione||0,
    statsMensili: st.mensili || [],
    statiUltimi30: st.stati30 || {},
    ultimeSpedizioni: ultimeSpedizioni||[],
  })
}