import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const ldv = req.nextUrl.searchParams.get('ldv')
  if (!ldv) return NextResponse.json({ error: 'LDV obbligatoria' }, { status: 400 })
  // RLS + catena: cerco la LDV su tutta la discendenza (solo discesa)
  const adminDb = createAdminSupabase()
  const { data: spedizione } = await adminDb.from('spedizioni')
    .select('id,numero,mitt_nome,dest_nome,dest_citta,colli,costo_totale,stato,tracking_number,cliente_id,master_id')
    .or(`numero.eq.${ldv},tracking_number.eq.${ldv}`)
    .single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // chi cerca deve essere il master della spedizione o un suo antenato
  let cur: string | null = spedizione.master_id
  let idx = -1
  for (let i = 0; i < 20 && cur; i++) {
    if (cur === utente?.master_id) { idx = i; break }
    const { data: mm } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = mm?.parent_master_id || null
  }
  if (idx === -1) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // target per la distinta: null se cliente diretto (idx 0), altrimenti il primo master sotto chi cerca
  let targetMasterId: string | null = null
  let targetMasterNome: string | null = null
  if (idx > 0) {
    // ricostruisco il percorso per prendere il livello idx-1
    const percorso: string[] = []
    let c2: string | null = spedizione.master_id
    for (let i = 0; i < 20 && c2; i++) {
      percorso.push(c2)
      const { data: mm } = await adminDb.from('masters').select('parent_master_id').eq('id', c2).maybeSingle()
      c2 = mm?.parent_master_id || null
    }
    const pos = percorso.indexOf(utente!.master_id)
    if (pos > 0) {
      targetMasterId = percorso[pos - 1]
      const { data: tm } = await adminDb.from('masters').select('nome').eq('id', targetMasterId).maybeSingle()
      targetMasterNome = tm?.nome || null
    }
  }
  // anti-duplicato PER LIVELLO: blocco solo se GIA' in una distinta reso del MIO master
  // (la stessa LDV puo' legittimamente stare in una distinta di M1 verso M2 e in una di M2 verso il suo cliente)
  const { data: giaMia } = await adminDb.from('distinte_resi')
    .select('id')
    .eq('master_id', utente!.master_id)
    .contains('voci', JSON.stringify([{ id: spedizione.id }]))
    .limit(1)
  if (giaMia && giaMia.length > 0) {
    return NextResponse.json({ error: 'Spedizione già messa in reso e addebitata' }, { status: 400 })
  }

  return NextResponse.json({ ...spedizione, target_master_id: targetMasterId, target_master_nome: targetMasterNome })
}