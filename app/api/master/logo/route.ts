import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) {   // branding del master: solo chi gestisce la rete
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
    // IL FORMATO SI RICONOSCE DAI BYTE, non dal nome del file ne' dal tipo dichiarato dal browser:
    // erano entrambi scelti da chi carica, e finivano tali e quali su un bucket PUBBLICO. Bastava
    // chiamare un file "logo.html" e dichiararlo text/html per farsi ospitare una pagina qualsiasi
    // sul nostro spazio.
    // E il formato conta anche dopo: l'etichetta interna incorpora solo PNG e JPG, quindi un logo
    // in un altro formato sparirebbe dalle etichette senza un errore. Meglio dirlo qui, mentre
    // c'e' davanti qualcuno che puo' cambiarlo, che scoprirlo dai pacchi gia' partiti.
    // La pagina di caricamento converte gia' tutto in PNG, ma la conversione sta nel browser: la
    // rotta e' la porta da cui passano tutti, anche una pagina futura o una chiamata diretta.
    const bytes = Buffer.from(await file.arrayBuffer())
    const tipo =
      bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        ? { ext: 'png', mime: 'image/png' }
      : bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? { ext: 'jpg', mime: 'image/jpeg' }
      : null
    if (!tipo) {
      return NextResponse.json({ error: 'Il logo deve essere un\'immagine PNG o JPG' }, { status: 400 })
    }
    const path = `logo-${masterId}.${tipo.ext}`

    const { error: upErr } = await admin.storage.from('loghi').upload(path, bytes, {
      contentType: tipo.mime,
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
  if (!utente?.master_id || !gestisceLaRete(utente)) {   // branding del master: solo chi gestisce la rete
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const admin = createAdminSupabase()
  const { error } = await admin.from('masters').update({ logo_url: null }).eq('id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
