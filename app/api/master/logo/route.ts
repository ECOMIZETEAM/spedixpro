import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (utente?.ruolo === 'cliente' || !utente?.master_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const masterId = utente.master_id

  const form = await req.formData()
  const file = form.get('file') as File | null
  const nome = form.get('nome') as string | null

  const admin = createAdminSupabase()
  const update: any = {}

  if (file && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Il file supera i 2MB' }, { status: 400 })
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `logo-${masterId}.${ext}`

    const bytes = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await admin.storage.from('loghi').upload(path, bytes, {
      contentType: file.type || 'image/png',
      upsert: true,
    })
    if (upErr) return NextResponse.json({ error: 'Errore upload: ' + upErr.message }, { status: 400 })

    const { data: pub } = admin.storage.from('loghi').getPublicUrl(path)
    update.logo_url = `${pub.publicUrl}?v=${Date.now()}`
  }

  if (typeof nome === 'string' && nome.trim()) {
    update.nome = nome.trim()
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'Niente da salvare' }, { status: 400 })
  }

  const { error: updErr } = await admin.from('masters').update(update).eq('id', masterId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  return NextResponse.json({ ok: true, logo_url: update.logo_url ?? null, nome: update.nome ?? null })
}

export async function DELETE() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (utente?.ruolo === 'cliente' || !utente?.master_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const admin = createAdminSupabase()
  const { error } = await admin.from('masters').update({ logo_url: null }).eq('id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
