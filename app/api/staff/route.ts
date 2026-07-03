import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Lista staff del master: utenti + email/ultimo_accesso da auth
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: me } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!me?.master_id) return NextResponse.json([])

  const { data: utenti } = await supabase.from('utenti')
    .select('id,nome,cognome,telefono,ruolo,attivo,created_at')
    .eq('master_id', me.master_id)
    .order('nome', { ascending: true })

  const admin = createAdminSupabase()
  const risultato = []
  for (const u of (utenti || [])) {
    let email = ''
    let ultimoAccesso = null
    try {
      const { data: au } = await admin.auth.admin.getUserById(u.id)
      email = au?.user?.email || ''
      ultimoAccesso = au?.user?.last_sign_in_at || null
    } catch {}
    risultato.push({ ...u, email, ultimo_accesso: ultimoAccesso })
  }
  return NextResponse.json(risultato)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: me } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!me?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const body = await req.json()
  const { nome, ruolo, email } = body
  if (!nome || !nome.trim()) return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 })
  if (!email || !email.trim()) return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
  const ruoliValidi = ['admin', 'operatore', 'agente']
  if (!ruoliValidi.includes((ruolo||'').toLowerCase())) return NextResponse.json({ error: 'Ruolo non valido' }, { status: 400 })

  const admin = createAdminSupabase()
  // creo l'utente auth e invio email per impostare la password
  const { data: created, error: authErr } = await admin.auth.admin.inviteUserByEmail(email.trim())
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })
  const newId = created?.user?.id
  if (!newId) return NextResponse.json({ error: 'Creazione utente fallita' }, { status: 400 })

  const { error: insErr } = await admin.from('utenti').insert({
    id: newId,
    nome: nome.trim(),
    ruolo: (ruolo||'').toLowerCase(),
    master_id: me.master_id,
    attivo: true,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: me } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const admin = createAdminSupabase()
  await admin.from('utenti').delete().eq('id', id).eq('master_id', me?.master_id)
  try { await admin.auth.admin.deleteUser(id) } catch {}
  return NextResponse.json({ success: true })
}