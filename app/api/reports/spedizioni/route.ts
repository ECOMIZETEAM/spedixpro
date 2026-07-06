import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaPrezzoCorriere } from '@/lib/pricing'
import { SPED_COLS } from '@/lib/spedizioni-cols'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,nome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')
  const contrassegno = p.get('contrassegno')
  const provincia = p.get('provincia')

  let query = supabase.from('spedizioni')
    .select(`${SPED_COLS}, clienti(ragione_sociale)`)
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  if (provincia) query = query.eq('dest_provincia', provincia)

  const { data: spedizioni } = await query
  // calcolo il prezzo corriere per ogni spedizione
  const conPrezzoCorriere = []
  for (const s of (spedizioni || [])) {
    let pc: number | null = null
    if (s.corriere_id) {
      pc = await calcolaPrezzoCorriere(supabase, {
        corriereId: s.corriere_id, masterId: utente?.master_id, provincia: s.dest_provincia || '',
        cap: s.dest_cap || '', paese: s.dest_paese || 'IT',
        pesoReale: Number(s.peso_reale) || 1,
        packages: [{ length: s.lunghezza, width: s.larghezza, height: s.altezza }],
        contrassegno: Number(s.contrassegno) || 0, assicurazione: Number(s.assicurazione) || 0,
      })
    }
    conPrezzoCorriere.push({ ...s, prezzo_corriere: pc })
  }
  return NextResponse.json(conPrezzoCorriere)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,nome').eq('id', user.id).single()
  const body = await req.json()

  const { data: report, error } = await supabase.from('reports_generati').insert({
    master_id: utente?.master_id,
    tipo: 'spedizioni',
    formato: body.formato || 'pdf',
    filtri: body.filtri || {},
    utente_nome: (utente as any)?.nome || 'Admin',
    stato: 'disponibile',
    size: null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ id: report.id })
}