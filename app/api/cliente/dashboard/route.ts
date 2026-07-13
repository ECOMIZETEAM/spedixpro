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
    { data: kpi },
    { data: ultimeSpedizioni },
  ] = await Promise.all([
    supabase.rpc('dashboard_contatori_cliente', { p_cliente: clienteId }),
    supabase.rpc('dashboard_statistiche_cliente', { p_cliente: clienteId }),
    supabase.rpc('dashboard_kpi_cliente', { p_cliente: clienteId }),
    supabase.from('spedizioni').select(SPED_COLS).eq('cliente_id', clienteId).order('created_at',{ascending:false}).limit(10),
  ])
  const c: any = contatori || {}
  const st: any = statistiche || {}
  const k: any = kpi || {}
  return NextResponse.json({
    clienteNome: cliente?.ragione_sociale || 'Cliente',
    credito: Number(cliente?.credito || 0),
    spedizioniMese: c.spedizioniMese||0,
    limiteMese: 50000,
    spediteOggi: c.spediteOggi||0,
    daSpedire: c.daSpedire||0,
    inLavorazione: c.inLavorazione||0,
    spedizioniTotali: k.spedizioniTotali||0,
    speseMese: Number(k.speseMese||0),
    speseTotali: Number(k.speseTotali||0),
    consegnateMese: k.consegnateMese||0,
    inTransito: k.inTransito||0,
    inGiacenza: k.inGiacenza||0,
    codDaIncassare: Number(k.codDaIncassare||0),
    codIncassati: Number(k.codIncassati||0),
    statsMensili: st.mensili || [],
    statiUltimi30: st.stati30 || {},
    ultimeSpedizioni: ultimeSpedizioni||[],
  })
}