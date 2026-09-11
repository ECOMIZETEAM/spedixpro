import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { caricaAllegati } from '@/lib/allegati-ticket'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()

  const body = await req.json()
  const { oggetto, messaggio, gruppi, allegati, reteModo } = body
  if (!oggetto || !oggetto.trim()) return NextResponse.json({ error: 'Oggetto obbligatorio' }, { status: 400 })
  const gruppiArr: string[] = Array.isArray(gruppi) ? gruppi : []
  // Destinatari di RETE (sotto-master): 'diretti' | 'tutti' | 'contratto'. Calcolati ORA (snapshot) e
  // salvati in target_master_ids; li leggerà /api/notifiche/mie via admin (l'RLS non mostra a un
  // sotto-master le notifiche di un antenato). Vedi lib/rete-notifiche.
  const modo: 'diretti' | 'tutti' | 'contratto' | null = ['diretti', 'tutti', 'contratto'].includes(reteModo) ? reteModo : null
  let target_master_ids: string[] | null = null
  if (modo && utente?.master_id) {
    const { masterDestinatariRete } = await import('@/lib/rete-notifiche')
    const ids = await masterDestinatariRete(createAdminSupabase(), utente.master_id, modo)
    target_master_ids = ids.length ? ids : null
  }
  // Serve almeno un destinatario: un gruppo del proprio portale OPPURE dei sotto-master raggiunti.
  if (!gruppiArr.length && !target_master_ids) {
    return NextResponse.json({ error: modo ? 'Nessun sotto-master da raggiungere con questa scelta. Seleziona anche un gruppo del tuo portale.' : 'Seleziona almeno un destinatario (un gruppo del tuo portale o i sotto-master)' }, { status: 400 })
  }

  const { data, error } = await supabase.from('notifiche').insert({
    master_id: utente?.master_id,
    oggetto: oggetto.trim(),
    messaggio: messaggio || '',
    gruppi: gruppiArr,
    target_master_ids,
    created_by: user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Allegati (moduli/PDF/immagini): caricati nel bucket privato SOTTO l'id della notifica appena
  // creata, così /api/file può delimitare cosa può scaricare ogni destinatario (path
  // `allegati/notifiche/<id>/…`). L'upload usa l'admin perché il bucket è privato; i riferimenti
  // ({url,nome,tipo}) vanno nella colonna `allegati` della riga.
  let notifica = data
  const allegatiIn = Array.isArray(allegati) ? allegati : []
  if (allegatiIn.length && data?.id) {
    const admin = createAdminSupabase()
    const refs = await caricaAllegati(admin, `notifiche/${data.id}`, allegatiIn)
    if (refs.length) {
      const { data: agg } = await admin.from('notifiche').update({ allegati: refs }).eq('id', data.id).select().single()
      if (agg) notifica = agg
    }
  }
  return NextResponse.json({ success: true, notifica, masterRaggiunti: target_master_ids?.length || 0 })
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const { data } = await supabase.from('notifiche')
    .select('*')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
    .limit(100)
  return NextResponse.json(data || [])
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { error } = await supabase.from('notifiche')
    .delete()
    .eq('id', id)
    .eq('master_id', utente?.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}