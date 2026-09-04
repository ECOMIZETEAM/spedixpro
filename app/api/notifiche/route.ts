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
  const { oggetto, messaggio, gruppi, allegati } = body
  if (!oggetto || !oggetto.trim()) return NextResponse.json({ error: 'Oggetto obbligatorio' }, { status: 400 })
  if (!Array.isArray(gruppi) || !gruppi.length) return NextResponse.json({ error: 'Seleziona almeno un gruppo di utenti' }, { status: 400 })

  const { data, error } = await supabase.from('notifiche').insert({
    master_id: utente?.master_id,
    oggetto: oggetto.trim(),
    messaggio: messaggio || '',
    gruppi,
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
  return NextResponse.json({ success: true, notifica })
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