import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// IL LINK PER GOOGLE E IPHONE (fase 2): uno per persona, di chi ha la sessione. Il codice si mostra UNA volta, quando
// si crea: nel database c'è solo la sua impronta (sha256), come per le chiavi API. Rigenerare = il vecchio link smette
// di funzionare; disattivare = la riga si toglie (è una chiave d'accesso, non storico).
async function utente() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await utente()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data, error } = await createAdminSupabase().from('calendario_feed').select('creato_il,ultimo_uso').eq('utente_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Lettura non riuscita: ' + error.message }, { status: 500 })
  return NextResponse.json({ attivo: !!data, creato_il: data?.creato_il || null, ultimo_uso: data?.ultimo_uso || null })
}

export async function POST() {
  const user = await utente()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const token = randomBytes(32).toString('base64url')
  const token_hash = createHash('sha256').update(token).digest('hex')
  const { error } = await createAdminSupabase().from('calendario_feed')
    .upsert({ utente_id: user.id, token_hash, creato_il: new Date().toISOString(), ultimo_uso: null }, { onConflict: 'utente_id' })
  if (error) return NextResponse.json({ error: 'Link non creato: ' + error.message }, { status: 500 })
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const url = `${base}/api/calendario/ical/${token}.ics`
  return NextResponse.json({ url, webcal: url.replace(/^https?:/, 'webcal:') })
}

export async function DELETE() {
  const user = await utente()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { error } = await createAdminSupabase().from('calendario_feed').delete().eq('utente_id', user.id)
  if (error) return NextResponse.json({ error: 'Link non disattivato: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
