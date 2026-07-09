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
  // Creo l'utente con password diretta (mostrata a schermo). L'email di credenziali
  // parte comunque via Resend: quando il dominio è verificato arriva da sola.
  const password = generaPassword()
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: email.trim(), password, email_confirm: true,
  })
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

  // email credenziali (best-effort, funziona quando Resend è verificato)
  const { data: masterRec } = await admin.from('masters').select('nome').eq('id', me.master_id).single()
  try {
    const { inviaCredenzialiCliente } = await import('@/lib/email')
    await inviaCredenzialiCliente({ email: email.trim(), nomeCliente: nome.trim(), masterNome: masterRec?.nome || 'MoovExpress', dominio: 'moovexpress.com', password })
  } catch (e) { console.error('Errore invio credenziali staff:', e) }

  return NextResponse.json({ success: true, email: email.trim(), password })
}

function generaPassword(len = 10): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return 'Mv' + Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// Reimposta password (+ resend credenziali) e/o cambia email di un account staff
export async function PUT(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: me } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!me?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const body = await req.json()
  const { id, resetPassword, nuova_email } = body
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  // Dev'essere uno staff del mio master
  const { data: st } = await supabase.from('utenti').select('id,nome,master_id').eq('id', id).eq('master_id', me.master_id).maybeSingle()
  if (!st) return NextResponse.json({ error: 'Account non trovato' }, { status: 404 })

  // Email attuale (da auth)
  let emailAttuale = ''
  try { const { data: au } = await admin.auth.admin.getUserById(id); emailAttuale = au?.user?.email || '' } catch {}

  // Cambio email di accesso
  const emailNuova = (nuova_email || '').trim().toLowerCase()
  if (emailNuova && emailNuova !== emailAttuale.toLowerCase()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNuova)) return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
    const { error: eEm } = await admin.auth.admin.updateUserById(id, { email: emailNuova, email_confirm: true })
    if (eEm) return NextResponse.json({ error: 'Impossibile aggiornare l\'email: ' + eEm.message }, { status: 400 })
    emailAttuale = emailNuova
  }

  // Reset password + invio credenziali
  let passwordImpostata: string | undefined
  if (resetPassword) {
    const password = generaPassword()
    const { error: ePw } = await admin.auth.admin.updateUserById(id, { password })
    if (ePw) return NextResponse.json({ error: 'Impossibile reimpostare la password: ' + ePw.message }, { status: 400 })
    passwordImpostata = password
    if (emailAttuale) {
      try {
        const { data: masterRec } = await admin.from('masters').select('nome').eq('id', me.master_id).single()
        const { inviaCredenzialiCliente } = await import('@/lib/email')
        await inviaCredenzialiCliente({ email: emailAttuale, nomeCliente: (st as any).nome || 'Collaboratore', masterNome: masterRec?.nome || 'MoovExpress', dominio: 'moovexpress.com', password })
      } catch (e) { console.error('Errore invio credenziali staff (reset):', e) }
    }
  }

  return NextResponse.json({ success: true, email: emailAttuale, ...(passwordImpostata ? { password: passwordImpostata } : {}) })
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