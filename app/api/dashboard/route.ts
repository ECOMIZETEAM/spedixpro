import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,masters(nome,parent_master_id,abbonamento_piano,abbonamento_limite)').eq('id', user.id).single()
  const masterId = utente?.master_id
  const masterRec: any = (utente as any)?.masters || {}
  const masterNome = masterRec?.nome || 'Master'
  const isRoot = !masterRec?.parent_master_id                 // il master principale è esente
  const abbonamentoAttivo = isRoot || !!masterRec?.abbonamento_piano
  const limitePiano = Number(masterRec?.abbonamento_limite || 0) || 50000

  // Contatori + statistiche aggregati nel DB (una query ciascuno) invece di scaricare
  // le righe grezze: le liste PostgREST sono limitate a 1000 righe e falsavano i totali a volume.
  const [
    { data: contatori },
    { data: statistiche },
    { data: ultimeSpedizioni },
  ] = await Promise.all([
    supabase.rpc('dashboard_contatori_master', { p_master: masterId }),
    supabase.rpc('dashboard_statistiche_master', { p_master: masterId }),
    supabase.from('spedizioni').select(SPED_COLS).eq('master_id', masterId).order('created_at',{ascending:false}).limit(10),
  ])
  const c: any = contatori || {}
  const st: any = statistiche || {}

  return NextResponse.json({
    masterNome,
    totClienti: c.totClienti||0,
    spedizioniMese: c.spedizioniMese||0,
    limiteMese: limitePiano,
    abbonamentoAttivo,
    illimitato: isRoot,
    spediteOggi: c.spediteOggi||0,
    daSpedire: c.daSpedire||0,
    inLavorazione: c.inLavorazione||0,
    statsMensili: st.mensili || [],
    statiUltimi30: st.stati30 || {},
    ultimeSpedizioni: ultimeSpedizioni||[],
  })
}