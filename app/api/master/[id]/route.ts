import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
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
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })
  const admin = createAdminSupabase()
  if (!(await puoGestire(admin, utente, id))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { data: m } = await admin.from('masters')
    .select('id,nome,email,telefono,piva,tipo_contratto,parent_master_id,parent_listino_id,indirizzo_operativo,citta_operativo,provincia_operativo,cap_operativo').eq('id', id).single()
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
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { puoGestireRete } = await import('@/lib/permessi')
  if (!(await puoGestireRete())) return NextResponse.json({ error: 'Gestione rete non abilitata per questo account' }, { status: 403 })
  const admin = createAdminSupabase()
  if (!(await puoGestire(admin, utente, id))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json()
  const authId = await authUserIdDelMaster(admin, id)

  // Stato attuale: serve per capire se il LISTINO assegnato sta davvero CAMBIANDO. Solo in quel caso
  // va rimaterializzato (vedi sotto): rifarlo a ogni salvataggio anagrafica sarebbe inutile e costoso.
  const { data: mAttuale } = await admin.from('masters').select('parent_listino_id').eq('id', id).maybeSingle()
  const listinoInBody = 'parent_listino_id' in body
  const listinoNuovo = listinoInBody ? (body.parent_listino_id || null) : undefined
  const listinoAttuale = mAttuale?.parent_listino_id || null
  const listinoCambiato = listinoInBody && listinoNuovo !== listinoAttuale

  // Se si ASSEGNA un nuovo listino, dev'essere un listino di CHI assegna (come in /api/master/crea):
  // impedisce di puntare un sotto-master al listini_clienti di un altro (IDOR).
  if (listinoCambiato && listinoNuovo) {
    const { data: lisOk } = await admin.from('listini_clienti').select('id').eq('id', listinoNuovo).eq('master_id', utente.master_id).maybeSingle()
    if (!lisOk) return NextResponse.json({ error: 'Listino non valido o non tuo' }, { status: 400 })
  }

  // anagrafica
  const upd: any = {}
  if (typeof body.nome === 'string' && body.nome.trim()) upd.nome = body.nome.trim()
  if ('telefono' in body) upd.telefono = body.telefono || null
  if ('piva' in body) upd.piva = body.piva || null
  if (body.tipo_contratto === 'credito_scalare' || body.tipo_contratto === 'fattura_mensile') upd.tipo_contratto = body.tipo_contratto
  if (listinoInBody) upd.parent_listino_id = listinoNuovo
  // Sede operativa (mittente quando si spedisce per conto del sotto-master)
  if ('indirizzo_operativo' in body) upd.indirizzo_operativo = body.indirizzo_operativo || null
  if ('citta_operativo' in body) upd.citta_operativo = body.citta_operativo || null
  if ('provincia_operativo' in body) upd.provincia_operativo = body.provincia_operativo || null
  if ('cap_operativo' in body) upd.cap_operativo = body.cap_operativo || null

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

  // RIMATERIALIZZA il listino quando l'assegnazione CAMBIA. Prima la PATCH aggiornava solo il
  // puntatore parent_listino_id senza ricopiare le fasce: il sotto-master restava "tutto a 0"
  // (o col vecchio listino) finché qualcuno non premeva "Risincronizza" a mano. È il buco per cui
  // un contratto appena assegnato risultava senza prezzi. Stessa verifica fasce di /api/master/crea.
  let avvisoListino: string | null = null
  if (listinoCambiato) {
    if (listinoNuovo) {
      try {
        const { copiaListinoAlSottoMaster } = await import('@/lib/copia-listino-submaster')
        let res: any = await copiaListinoAlSottoMaster(admin, id, { force: true })
        if (!res?.ok) res = await copiaListinoAlSottoMaster(admin, id, { force: true })  // un retry
        const { data: liste } = await admin.from('listini_corrieri').select('id').eq('master_id', id)
        const listeIds = (liste || []).map((l: any) => l.id)
        const { count } = listeIds.length
          ? await admin.from('listini_corrieri_fasce').select('id', { count: 'exact', head: true }).in('listino_id', listeIds)
          : { count: 0 }
        if (!count) avvisoListino = 'ATTENZIONE: il listino assegnato non ha prodotto prezzi (il sotto-master resta senza tariffe). Verifica che il listino non sia vuoto e usa "Risincronizza listino".'
      } catch (e: any) {
        console.error('Rimaterializza listino sotto-master:', e)
        avvisoListino = 'ATTENZIONE: errore nella copia del listino. Usa "Risincronizza listino" nell\'Elenco Master.'
      }
    } else {
      avvisoListino = 'Listino rimosso: il sotto-master non potrà spedire finché non gliene assegni uno.'
    }
  }

  // reset password MANUALE (password digitata a mano)
  let passwordImpostata: string | undefined
  const nuovaPassword = (body.nuova_password || '').trim()
  if (nuovaPassword) {
    if (nuovaPassword.length < 12) return NextResponse.json({ error: 'La password deve avere almeno 12 caratteri' }, { status: 400 })
    if (!authId) return NextResponse.json({ error: 'Utente di login del master non trovato' }, { status: 400 })
    const { error } = await admin.auth.admin.updateUserById(authId, { password: nuovaPassword })
    if (error) return NextResponse.json({ error: 'Password: ' + error.message }, { status: 400 })
    passwordImpostata = nuovaPassword
  }

  // reset CREDENZIALI (auto-genera nuova password e INVIA via email) — come per il cliente.
  let emailInviata = false
  if (body.resetPassword) {
    if (!authId) return NextResponse.json({ error: 'Utente di login del master non trovato' }, { status: 400 })
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
    // 14 caratteri: sotto i 12 Supabase RIFIUTA la password e il reset falliva.
    const newPassword = Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    const { error } = await admin.auth.admin.updateUserById(authId, { password: newPassword })
    if (error) return NextResponse.json({ error: 'Password: ' + error.message }, { status: 400 })
    passwordImpostata = newPassword
    // email del master (nuova se cambiata, altrimenti quella di login)
    let emailDest = nuovaEmail
    if (!emailDest) { const { data: au } = await admin.auth.admin.getUserById(authId); emailDest = au?.user?.email || '' }
    const { data: m } = await admin.from('masters').select('nome').eq('id', id).single()
    if (emailDest) {
      try {
        const { inviaCredenzialiCliente } = await import('@/lib/email')
        const res = await inviaCredenzialiCliente({ email: emailDest, nomeCliente: m?.nome || 'Master', masterNome: 'MoovExpress', dominio: 'moovexpress.com', password: newPassword, areaStaff: true })
        emailInviata = !!(res as any)?.ok
      } catch (e) { console.error('Invio credenziali master:', e) }
    }
  }

  return NextResponse.json({ ok: true, emailInviata, ...(avvisoListino ? { avvisoListino } : {}), ...(passwordImpostata ? { password: passwordImpostata } : {}) })
}
