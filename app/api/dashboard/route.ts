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

  const now = new Date()
  const inizioMese = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const oggi = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const fa30gg = new Date(now.getTime() - 30*24*60*60*1000).toISOString()

  const [
    { count: totClienti },
    { count: spedizioniMese },
    { count: spediteOggi },
    { count: daSpedire },
    { count: inLavorazione },
    { data: tutteSpedizioni },
    { data: ultimeSpedizioni },
  ] = await Promise.all([
    supabase.from('clienti').select('*',{count:'exact',head:true}).eq('master_id', masterId),
    supabase.from('spedizioni').select('*',{count:'exact',head:true}).eq('master_id', masterId).gte('created_at', inizioMese),
    supabase.from('spedizioni').select('*',{count:'exact',head:true}).eq('master_id', masterId).gte('created_at', oggi).eq('stato','spedita'),
    supabase.from('spedizioni').select('*',{count:'exact',head:true}).eq('master_id', masterId).gte('created_at', fa30gg).eq('stato','in_lavorazione'),
    supabase.from('spedizioni').select('*',{count:'exact',head:true}).eq('master_id', masterId).gte('created_at', fa30gg).in('stato',['in_lavorazione','spedita']),
    supabase.from('spedizioni').select('stato,created_at,costo_totale').eq('master_id', masterId).gte('created_at', new Date(now.getFullYear()-1, now.getMonth(), 1).toISOString()),
    supabase.from('spedizioni').select(SPED_COLS).eq('master_id', masterId).order('created_at',{ascending:false}).limit(10),
  ])

  // Statistiche mensili
  const statsMensili: Record<string,{totale:number,importo:number}> = {}
  for (const s of tutteSpedizioni||[]) {
    const d = new Date(s.created_at)
    const key = `${d.toLocaleString('en',{month:'short'})} ${d.getFullYear().toString().slice(2)}`
    if (!statsMensili[key]) statsMensili[key] = {totale:0,importo:0}
    statsMensili[key].totale++
    statsMensili[key].importo += parseFloat(s.costo_totale||0)
  }

  // Stati ultimi 30gg
  const statiUltimi30: Record<string,number> = {}
  const spedizioni30 = (tutteSpedizioni||[]).filter(s => new Date(s.created_at) >= new Date(fa30gg))
  for (const s of spedizioni30) {
    statiUltimi30[s.stato] = (statiUltimi30[s.stato]||0) + 1
  }

  return NextResponse.json({
    masterNome,
    totClienti: totClienti||0,
    spedizioniMese: spedizioniMese||0,
    limiteMese: limitePiano,
    abbonamentoAttivo,
    illimitato: isRoot,
    spediteOggi: spediteOggi||0,
    daSpedire: daSpedire||0,
    inLavorazione: inLavorazione||0,
    statsMensili: Object.entries(statsMensili).map(([mese,v])=>({mese,...v})),
    statiUltimi30,
    ultimeSpedizioni: ultimeSpedizioni||[],
  })
}