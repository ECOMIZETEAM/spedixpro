import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Il chiamante può gestire il master target se è admin, oppure se è un suo antenato
async function puoGestire(admin: any, utente: any, targetId: string): Promise<boolean> {
  if (utente?.ruolo === 'admin') return true
  if (!utente?.master_id) return false
  if (utente.master_id === targetId) return true
  let cur: string | null = targetId
  for (let i = 0; i < 20 && cur; i++) {
    const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    if (!m) break
    if (m.parent_master_id === utente.master_id) return true
    cur = m.parent_master_id
  }
  return false
}

async function authUserIdDelMaster(admin: any, masterId: string): Promise<string | null> {
  const { data: u } = await admin.from('utenti').select('id').eq('master_id', masterId).eq('ruolo', 'master').limit(1).maybeSingle()
  return u?.id || null
}

// Anagrafica master + email di login
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  if (!(await puoGestire(admin, utente, id))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { data: m } = await admin.from('masters')
    .select('id,nome,email,telefono,piva,tipo_contratto,parent_master_id,parent_listino_id').eq('id', id).single()
  if (!m) return NextResponse.json({ error: 'Master non trovato' }, { status: 404 })

  const authId = await authUserIdDelMaster(admin, id)
  let loginEmail: string | null = m.email
  if (authId) { const { data: au } = await admin.auth.admin.getUserById(authId); loginEmail = au?.user?.email || m.email }
  return NextResponse.json({ ...m, login_email: loginEmail })
}

// Modifica anagrafica + (opz.) cambio email + (opz.) reset password
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  if (!(await puoGestire(admin, utente, id))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json()
  const authId = await authUserIdDelMaster(admin, id)

  // anagrafica
  const upd: any = {}
  if (typeof body.nome === 'string' && body.nome.trim()) upd.nome = body.nome.trim()
  if ('telefono' in body) upd.telefono = body.telefono || null
  if ('piva' in body) upd.piva = body.piva || null
  if (body.tipo_contratto === 'credito_scalare' || body.tipo_contratto === 'fattura_mensile') upd.tipo_contratto = body.tipo_contratto
  if ('parent_listino_id' in body) upd.parent_listino_id = body.parent_listino_id || null

  // cambio email (aggiorna auth + anagrafica)
  const nuovaEmail = (body.nuova_email || '').toLowerCase().trim()
  if (nuovaEmail) {
    if (authId) {
      const { error } = await admin.auth.admin.updateUserById(authId, { email: nuovaEmail, email_confirm: true })
      if (error) return NextResponse.json({ error: 'Email: ' + error.message }, { status: 400 })
    }
    upd.email = nuovaEmail
  }

  if (Object.keys(upd).length) {
    const { error } = await admin.from('masters').update(upd).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // reset password
  let passwordImpostata: string | undefined
  const nuovaPassword = (body.nuova_password || '').trim()
  if (nuovaPassword) {
    if (nuovaPassword.length < 8) return NextResponse.json({ error: 'La password deve avere almeno 8 caratteri' }, { status: 400 })
    if (!authId) return NextResponse.json({ error: 'Utente di login del master non trovato' }, { status: 400 })
    const { error } = await admin.auth.admin.updateUserById(authId, { password: nuovaPassword })
    if (error) return NextResponse.json({ error: 'Password: ' + error.message }, { status: 400 })
    passwordImpostata = nuovaPassword
  }

  return NextResponse.json({ ok: true, ...(passwordImpostata ? { password: passwordImpostata } : {}) })
}
