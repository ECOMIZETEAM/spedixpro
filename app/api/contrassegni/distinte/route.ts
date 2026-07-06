import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')

  let query = supabase.from('distinte_contrassegni')
    .select('*, clienti(ragione_sociale), distinte_contrassegni_righe(id,numero_spedizione,importo_cod,importo_sistema,spedizioni(dest_nome,rif_destinatario,mitt_nome,created_at))')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })

  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')

  const { data } = await query
  const distinte = data || []
  const masterIds = [...new Set(distinte.map((d:any)=>d.target_master_id).filter(Boolean))]
  if (masterIds.length) {
    const { data: masters } = await supabase.from('masters').select('id,nome').in('id', masterIds)
    const mMap: Record<string,any> = {}
    ;(masters||[]).forEach((m:any)=>{ mMap[m.id] = m })
    distinte.forEach((d:any)=>{ if (d.target_master_id && mMap[d.target_master_id]) d.target_master = { nome: mMap[d.target_master_id].nome } })
  }
  return NextResponse.json(distinte)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { spedizioneIds } = body
  if (!spedizioneIds?.length) return NextResponse.json({ error: 'Nessuna spedizione' }, { status: 400 })

  const { data: spedizioni } = await supabase.from('spedizioni')
    .select('id,cliente_id,contrassegno,numero')
    .in('id', spedizioneIds)
    .eq('master_id', utente?.master_id)

  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 404 })

  // Raggruppa per cliente
  const clientiMap: Record<string, any[]> = {}
  spedizioni.forEach(s => {
    if (!clientiMap[s.cliente_id]) clientiMap[s.cliente_id] = []
    clientiMap[s.cliente_id].push(s)
  })

  const distinte = []
  for (const [clienteId, sped] of Object.entries(clientiMap)) {
    const totale = sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0)
    const { data: distinta } = await supabase.from('distinte_contrassegni').insert({
      master_id: utente?.master_id,
      cliente_id: clienteId,
      totale_iniziale: totale,
      totale_rimborsato: totale,
      stato: 'in_lavorazione',
    }).select().single()

    if (distinta) {
      const righe = sped.map(s => ({
        distinta_id: distinta.id,
        spedizione_id: s.id,
        numero_spedizione: s.numero,
        importo_cod: Number(s.contrassegno),
        importo_sistema: Number(s.contrassegno),
      }))
      await supabase.from('distinte_contrassegni_righe').insert(righe)
      await supabase.from('spedizioni').update({
        stato_contrassegno: 'in_distinta',
        distinta_contrassegno_id: distinta.id
      }).in('id', sped.map(s => s.id))
      distinte.push(distinta)
    }
  }

  return NextResponse.json({ success: true, distinte })
}