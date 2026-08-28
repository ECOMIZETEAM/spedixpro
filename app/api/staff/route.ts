import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Lista staff del master: utenti + email/ultimo_accesso da auth
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: me } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!me?.master_id) return NextResponse.json([])
  if ((me.ruolo || '').toLowerCase() === 'agente') return NextResponse.json([])   // l'agente non vede lo staff

  const { data: utenti } = await supabase.from('utenti')
    .select('id,nome,cognome,telefono,ruolo,attivo,created_at,listino_agente_id,agente_metodo,agente_valore')
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
  if ((me.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non consentito' }, { status: 403 })

  const body = await req.json()
  const { nome, ruolo, email } = body
  if (!nome || !nome.trim()) return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 })
  if (!email || !email.trim()) return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
  // 'autista' e' uno staff a tutti gli effetti, ma non entra nel portale: dal telefono vede solo
  // le sue consegne. E' il modo di dargli un accesso senza dovergli far installare niente.
  const ruoliValidi = ['admin', 'operatore', 'agente', 'autista']
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

  const daInserire: any = {
    id: newId,
    nome: nome.trim(),
    ruolo: (ruolo||'').toLowerCase(),
    master_id: me.master_id,
    attivo: true,
  }
  // Compenso agente gia' alla creazione (uno dei 4 metodi): il master di riferimento lo assegna qui,
  // senza dover aprire la modifica subito dopo. Stessa validazione della PUT.
  if ((ruolo||'').toLowerCase() === 'agente') {
    const metodo = ['listino','perc_netto','perc_lordo','fisso'].includes(body.agente_metodo) ? body.agente_metodo : 'listino'
    daInserire.agente_metodo = metodo
    daInserire.agente_valore = metodo !== 'listino' ? Math.max(0, Number(body.agente_valore) || 0) : 0
    if (metodo === 'listino' && body.listino_agente_id) {
      const { data: lk } = await admin.from('listini_clienti').select('id').eq('id', body.listino_agente_id).eq('master_id', me.master_id).maybeSingle()
      daInserire.listino_agente_id = lk?.id || null
    }
  }
  const { error: insErr } = await admin.from('utenti').insert(daInserire)
  if (insErr) {
    // Senza la riga in `utenti` l'account resta orfano: non entra da nessuna parte e quell'email
    // non e' piu' riutilizzabile. Si ripulisce l'account auth appena creato.
    await admin.auth.admin.deleteUser(newId).catch(() => {})
    return NextResponse.json({ error: insErr.message }, { status: 400 })
  }

  // Un autista e' anche una riga nell'anagrafica autisti: e' quella che porta la zona e su cui si
  // contano le consegne. Averne due separate vorrebbe dire tenerle allineate a mano, e infatti
  // prima o poi si scollegano. Se c'e' gia' un autista con quel nome senza accesso, si aggancia
  // quello invece di crearne un altro.
  if ((ruolo || '').toLowerCase() === 'autista') {
    const { data: esistente } = await admin.from('autisti')
      .select('id,utente_id').eq('master_id', me.master_id).ilike('nome', nome.trim()).is('utente_id', null).maybeSingle()
    if (esistente) {
      await admin.from('autisti').update({ utente_id: newId, email: email.trim() }).eq('id', esistente.id)
    } else {
      await admin.from('autisti').insert({ master_id: me.master_id, nome: nome.trim(), email: email.trim(), utente_id: newId, attivo: true })
    }
  }

  // email credenziali (best-effort, funziona quando Resend è verificato)
  const { data: masterRec } = await admin.from('masters').select('nome').eq('id', me.master_id).single()
  try {
    const { inviaCredenzialiCliente } = await import('@/lib/email')
    await inviaCredenzialiCliente({ email: email.trim(), nomeCliente: nome.trim(), masterNome: masterRec?.nome || 'MoovExpress', dominio: 'moovexpress.com', password, areaStaff: true })
  } catch (e) { console.error('Errore invio credenziali staff:', e) }

  return NextResponse.json({ success: true, email: email.trim(), password })
}

// 'Mv' + len: totale >= 12, soglia minima accettata da Supabase.
function generaPassword(len = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return 'Mv' + Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// Reimposta password (+ resend credenziali) e/o cambia email di un account staff
export async function PUT(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: me } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!me?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  if ((me.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non consentito' }, { status: 403 })

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
        await inviaCredenzialiCliente({ email: emailAttuale, nomeCliente: (st as any).nome || 'Collaboratore', masterNome: masterRec?.nome || 'MoovExpress', dominio: 'moovexpress.com', password, areaStaff: true })
      } catch (e) { console.error('Errore invio credenziali staff (reset):', e) }
    }
  }

  // Aggiornamento anagrafica (nome/cognome/ruolo/telefono/attivo)
  const anagrafica: any = {}
  if (typeof body.nome === 'string') anagrafica.nome = body.nome.trim()
  if (typeof body.cognome === 'string') anagrafica.cognome = body.cognome.trim() || null
  if (typeof body.telefono === 'string') anagrafica.telefono = body.telefono.trim() || null
  if (body.ruolo && ['admin', 'operatore', 'agente', 'autista'].includes(String(body.ruolo).toLowerCase())) anagrafica.ruolo = String(body.ruolo).toLowerCase()
  if (typeof body.attivo === 'boolean') anagrafica.attivo = body.attivo
  // Listino agente (costo dell'agente): un listino cliente di proprietà del master.
  if ('listino_agente_id' in body) {
    const lid = body.listino_agente_id || null
    if (lid) {
      const { data: lk } = await admin.from('listini_clienti').select('id').eq('id', lid).eq('master_id', me.master_id).maybeSingle()
      anagrafica.listino_agente_id = lk?.id || null
    } else {
      anagrafica.listino_agente_id = null
    }
  }
  // Compenso agente: metodo (uno dei 4) + valore (% per perc_*, € a spedizione per fisso).
  if (typeof body.agente_metodo === 'string' && ['listino', 'perc_netto', 'perc_lordo', 'fisso'].includes(body.agente_metodo)) {
    anagrafica.agente_metodo = body.agente_metodo
    anagrafica.agente_valore = Math.max(0, Number(body.agente_valore) || 0)
  }
  if (Object.keys(anagrafica).length) {
    const { error } = await admin.from('utenti').update(anagrafica).eq('id', id).eq('master_id', me.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, email: emailAttuale, emailInviata: !!passwordImpostata && !!emailAttuale, ...(passwordImpostata ? { password: passwordImpostata } : {}) })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: me } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if ((me?.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non consentito' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const admin = createAdminSupabase()
  await admin.from('utenti').delete().eq('id', id).eq('master_id', me?.master_id)
  try { await admin.auth.admin.deleteUser(id) } catch {}
  return NextResponse.json({ success: true })
}