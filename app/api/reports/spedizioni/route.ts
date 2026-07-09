import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { creaCalcolatoreCorriere } from '@/lib/pricing'
import { SPED_COLS } from '@/lib/spedizioni-cols'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,nome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente)
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')
  const contrassegno = p.get('contrassegno')
  const provincia = p.get('provincia')

  // Sotto-master selezionato: uso il client admin e filtro sul suo sotto-albero
  let db: any = supabase
  let subtreeSel: string[] | null = null
  if (masterSel && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  }

  let query = db.from('spedizioni')
    .select(`${SPED_COLS}, clienti(ragione_sociale,agente), corrieri(id,nome_contratto)`)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (subtreeSel) query = query.in('master_id', subtreeSel)
  else query = query.eq('master_id', utente?.master_id)
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  if (contrassegno === 'si') query = query.gt('contrassegno', 0)
  if (contrassegno === 'no') query = query.eq('contrassegno', 0)
  if (provincia) query = query.eq('dest_provincia', provincia)

  const { data: spedizioni } = await query
  // Prezzo corriere: precarico listini/fasce/zone UNA volta, poi calcolo in memoria
  // (stesso risultato di calcolaPrezzoCorriere, ma senza ~query-per-riga).
  const calcCorriere = await creaCalcolatoreCorriere(supabase, utente?.master_id)
  const conPrezzoCorriere = (spedizioni || []).map((s: any) => {
    const dett = s.corriere_id ? calcCorriere(s) : null
    // Lato cliente: nolo = costo_spedizione salvato; le fee combinate = totale - nolo
    const noloCliente = Number(s.costo_spedizione || 0)
    const totCliente = Number(s.costo_totale || 0)
    return {
      ...s,
      prezzo_corriere: dett ? dett.totale : null,
      dett_corriere: dett || null,          // { totale, nolo, sponda, contrassegno, assicurazione }
      cli_nolo: noloCliente,
      cli_supplementi: Math.max(0, Math.round((totCliente - noloCliente) * 100) / 100),
    }
  })
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