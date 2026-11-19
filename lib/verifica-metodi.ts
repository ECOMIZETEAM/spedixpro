import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { createAdminSupabase } from '@/lib/supabase-admin'
import type { createServerSupabase } from '@/lib/supabase'
import { inviaCodiceAccesso } from '@/lib/email'
import { eIndirizzoInterno } from '@/lib/indirizzi-interni'
import { emailMascherata } from '@/lib/verifica-due-passaggi'

// VERIFICA IN DUE PASSAGGI: I METODI A SCELTA (scelta di Lorenzo del 17/11/2026, scripts/verifica-metodi.sql).
// Dopo la password basta UNO dei metodi attivati: l'app sul telefono (Supabase) o il codice via mail (qui),
// piu' 10 codici di riserva. Le verifiche fatte qui registrano la sessione in sessioni_verificate, e da li'
// la lascia lavorare la regola del database (sessione_verificata), la stessa che vale per l'app.
// Un metodo nuovo si aggiunge solo da una sessione gia' verificata (o se non se ne ha nessuno): altrimenti
// chi ha solo la password se ne aggiungerebbe uno suo e salterebbe quello vero.

type Admin = ReturnType<typeof createAdminSupabase>
type Server = Awaited<ReturnType<typeof createServerSupabase>>
type Utente = { id: string; email?: string | null; factors?: { id: string; status: string; factor_type?: string }[] | null }
type Esito<T = object> = ({ ok: true } & T) | { ok: false; errore: string; status: number }

export const MINUTI_VALIDITA = 10
const TENTATIVI_MAIL = 5
export const ATTESA_FRA_INVII_S = 60
const INVII_MAIL_ORA = 5
const RISERVA_QUANTI = 10
const RISERVA_ERRORI_ORA = 10
// Quanto vale una sessione verificata con la mail o con un codice di riserva; poi il codice si rimette.
const GIORNI_SESSIONE = 30
// Senza 0/O e 1/I: si leggono da un foglio stampato senza sbagliare.
const ALFABETO_RISERVA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const impronta = (sale: string, codice: string) => createHash('sha256').update(`${sale}:${codice}`).digest('hex')
const uguali = (a: string, b: string) => {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex')
  return x.length === y.length && timingSafeEqual(x, y)
}
const appVerificate = (u: Utente) => (u.factors || []).filter(f => f.status === 'verified' && (f.factor_type || 'totp') === 'totp')
const scadenzaSessione = () => new Date(Date.now() + GIORNI_SESSIONE * 864e5).toISOString()

// Chi fa la richiesta e da QUALE sessione: l'id di sessione si legge dal token verificato (getClaims),
// perche' e' la chiave con cui il database riconosce la sessione.
export async function sessioneDellaRichiesta(supabase: Server): Promise<{ user: Utente; sessionId: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims as { session_id?: string; sub?: string } | undefined
  if (!claims?.session_id || claims.sub !== user.id) return null
  return { user, sessionId: String(claims.session_id) }
}

/** La sessione ha gia' passato la verifica? Lo dice il database, con la stessa regola di ogni richiesta. */
export async function sessioneVerificata(supabase: Server): Promise<boolean> {
  const { data, error } = await supabase.rpc('sessione_verificata')
  return !error && data === true
}

export async function metodiDi(admin: Admin, user: Utente): Promise<{ app: boolean; mail: boolean; riserva: number }> {
  const [m, r] = await Promise.all([
    admin.from('verifica_metodo').select('metodo').eq('utente_id', user.id),
    admin.from('codici_riserva').select('id', { count: 'exact', head: true }).eq('utente_id', user.id).is('usato_il', null),
  ])
  return { app: appVerificate(user).length > 0, mail: (m.data || []).some((x: { metodo: string }) => x.metodo === 'mail'), riserva: r.count || 0 }
}

/** Almeno un metodo attivo? (avviso in cima, collegamento Amazon) */
export async function verificaAttiva(admin: Admin, user: Utente): Promise<boolean> {
  const m = await metodiDi(admin, user)
  return m.app || m.mail
}

async function registraSessione(admin: Admin, user: Utente, sessionId: string, metodo: 'mail' | 'riserva') {
  return admin.from('sessioni_verificate').upsert({ session_id: sessionId, utente_id: user.id, metodo, scade_il: scadenzaSessione() })
}

// ── MAIL ────────────────────────────────────────────────────────────────────────────────────────────────

// Chi puo' chiedere/confermare un codice via mail: chi la mail ce l'ha gia' (accesso), chi non ha nessun
// metodo (prima attivazione), oppure chi la aggiunge all'app da una sessione gia' verificata.
async function puoUsareMail(admin: Admin, user: Utente, verificata: boolean): Promise<string | null> {
  const m = await metodiDi(admin, user)
  if (m.mail || !m.app || verificata) return null
  return 'Per aggiungere la mail entra prima con l\'app sul telefono.'
}

export async function inviaCodiceMail(admin: Admin, user: Utente, sessionId: string, verificata: boolean): Promise<Esito<{ a: string; giaInviato?: boolean }>> {
  const no = await puoUsareMail(admin, user, verificata)
  if (no) return { ok: false, status: 409, errore: no }
  const email = String(user.email || '')
  // Gli account nati da Shopify e i conti-ledger hanno un indirizzo costruito da noi che nessuno legge.
  if (!email || eIndirizzoInterno(email)) return { ok: false, status: 409, errore: 'Il tuo account non ha una casella di posta a cui mandare il codice: usa l\'app sul telefono.' }
  const a = emailMascherata(email)

  const { data: ultimi, error: eL } = await admin.from('verifica_mail_codici').select('creato_il, session_id')
    .eq('utente_id', user.id).gte('creato_il', new Date(Date.now() - 3600_000).toISOString())
    .order('creato_il', { ascending: false }).limit(INVII_MAIL_ORA)
  if (eL) return { ok: false, status: 500, errore: 'Non riesco a preparare il codice, riprova tra poco.' }
  // Un codice appena mandato a QUESTA sessione vale ancora: la pagina ricaricata non ne chiede un altro.
  // Un accesso nuovo (altro computer) ne riceve uno suo: quello dell'altra sessione qui non vale.
  const recente = ultimi?.[0]
  if (recente && recente.session_id === sessionId && Date.now() - new Date(recente.creato_il).getTime() < ATTESA_FRA_INVII_S * 1000) return { ok: true, a, giaInviato: true }
  if ((ultimi?.length || 0) >= INVII_MAIL_ORA) return { ok: false, status: 429, errore: 'Hai chiesto troppi codici: aspetta un\'ora, usa un altro metodo o un codice di riserva.' }

  const codice = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const sale = randomBytes(16).toString('hex')
  const { data: riga, error: eI } = await admin.from('verifica_mail_codici').insert({
    utente_id: user.id, session_id: sessionId, sale, impronta: impronta(sale, codice),
    scade_il: new Date(Date.now() + MINUTI_VALIDITA * 60_000).toISOString(),
  }).select('id').single()
  if (eI || !riga) return { ok: false, status: 500, errore: 'Non riesco a preparare il codice, riprova tra poco.' }

  const mail = await inviaCodiceAccesso({ to: email, codice, minuti: MINUTI_VALIDITA })
  if (!mail.ok) {
    // Un codice mai arrivato non deve contare nei limiti ne' restare valido.
    await admin.from('verifica_mail_codici').delete().eq('id', riga.id)
    console.error('[VERIFICA][MAIL] codice non spedito', a, mail.error)
    return { ok: false, status: 502, errore: 'La mail non è partita, riprova tra poco.' }
  }
  return { ok: true, a }
}

export async function confermaCodiceMail(admin: Admin, user: Utente, sessionId: string, verificata: boolean, codiceGrezzo: unknown): Promise<Esito<{ nuovo: boolean }>> {
  const no = await puoUsareMail(admin, user, verificata)
  if (no) return { ok: false, status: 409, errore: no }
  const codice = String(codiceGrezzo || '').replace(/\D/g, '')
  if (codice.length !== 6) return { ok: false, status: 400, errore: 'Il codice ha 6 cifre.' }

  const { data: r } = await admin.from('verifica_mail_codici')
    .select('id, sale, impronta, scade_il, tentativi')
    .eq('utente_id', user.id).eq('session_id', sessionId).is('usato_il', null)
    .order('creato_il', { ascending: false }).limit(1).maybeSingle()
  const scaduto = 'Il codice è scaduto o è già stato usato: fattene mandare uno nuovo.'
  if (!r || new Date(r.scade_il).getTime() < Date.now() || r.tentativi >= TENTATIVI_MAIL) return { ok: false, status: 400, errore: scaduto }
  if (!uguali(r.impronta, impronta(r.sale, codice))) {
    await admin.from('verifica_mail_codici').update({ tentativi: r.tentativi + 1 }).eq('id', r.id)
    console.warn('[VERIFICA][MAIL][SBAGLIATO]', emailMascherata(String(user.email || '')), `tentativo ${r.tentativi + 1}/${TENTATIVI_MAIL}`)
    return { ok: false, status: 400, errore: r.tentativi + 1 >= TENTATIVI_MAIL ? 'Troppi tentativi con questo codice: fattene mandare uno nuovo.' : 'Codice non valido. Controlla l\'ultima mail arrivata.' }
  }
  // Usato una volta sola: lo prende solo chi arriva per primo.
  const { data: preso } = await admin.from('verifica_mail_codici').update({ usato_il: new Date().toISOString() }).eq('id', r.id).is('usato_il', null).select('id')
  if (!preso?.length) return { ok: false, status: 400, errore: scaduto }

  const prima = await metodiDi(admin, user)
  // Chi aggiunge la mail all'app lo fa da una sessione verificata con l'app: le sue app restano valide.
  if (!prima.mail && prima.app) await approvaTutteLeApp(admin, user)
  const [s, m] = await Promise.all([
    registraSessione(admin, user, sessionId, 'mail'),
    admin.from('verifica_metodo').upsert({ utente_id: user.id, metodo: 'mail' }),
  ])
  if (s.error || m.error) {
    console.error('[VERIFICA][MAIL] sessione non registrata', s.error?.message || m.error?.message)
    return { ok: false, status: 500, errore: 'Non riesco a completare l\'accesso, riprova tra poco.' }
  }
  await admin.from('audit_accessi').insert({ utente_id: user.id, azione: prima.mail ? 'verifica_mail' : 'verifica_mail_attivata', risorsa: 'sessione' })
  return { ok: true, nuovo: !prima.mail }
}

// ── APP ─────────────────────────────────────────────────────────────────────────────────────────────────

async function approvaTutteLeApp(admin: Admin, user: Utente) {
  const righe = appVerificate(user).map(f => ({ factor_id: f.id, utente_id: user.id }))
  if (righe.length) await admin.from('fattori_approvati').upsert(righe, { onConflict: 'factor_id' })
}

/** L'app appena attivata: il portale la riconosce se l'utente non ha la mail, o se la sessione era gia' verificata. */
export async function approvaApp(admin: Admin, user: Utente, factorId: string, verificata: boolean): Promise<Esito> {
  if (!appVerificate(user).some(f => f.id === factorId)) return { ok: false, status: 404, errore: 'App non trovata.' }
  const m = await metodiDi(admin, user)
  if (m.mail && !verificata) return { ok: false, status: 403, errore: 'Per aggiungere l\'app entra prima con il codice via mail.' }
  const { error } = await admin.from('fattori_approvati').upsert({ factor_id: factorId, utente_id: user.id }, { onConflict: 'factor_id' })
  if (error) return { ok: false, status: 500, errore: 'Non riesco a registrare l\'app, riprova.' }
  await admin.from('audit_accessi').insert({ utente_id: user.id, azione: 'verifica_app_attivata', risorsa: factorId })
  return { ok: true }
}

// ── CODICI DI RISERVA ───────────────────────────────────────────────────────────────────────────────────

export async function generaCodiciRiserva(admin: Admin, user: Utente, verificata: boolean): Promise<Esito<{ codici: string[] }>> {
  const m = await metodiDi(admin, user)
  if (!m.app && !m.mail) return { ok: false, status: 409, errore: 'Attiva prima l\'app o la mail.' }
  if (!verificata) return { ok: false, status: 403, errore: 'Per i codici di riserva entra prima con uno dei tuoi metodi.' }
  const codici = Array.from({ length: RISERVA_QUANTI }, () => {
    const c = Array.from({ length: 8 }, () => ALFABETO_RISERVA[randomInt(0, ALFABETO_RISERVA.length)]).join('')
    return `${c.slice(0, 4)}-${c.slice(4)}`
  })
  // I vecchi non usati smettono di valere: valgono solo gli ultimi generati.
  const { error: eD } = await admin.from('codici_riserva').delete().eq('utente_id', user.id).is('usato_il', null)
  if (eD) return { ok: false, status: 500, errore: 'Non riesco a preparare i codici, riprova.' }
  const { error } = await admin.from('codici_riserva').insert(codici.map(c => {
    const sale = randomBytes(16).toString('hex')
    return { utente_id: user.id, sale, impronta: impronta(sale, c.replace('-', '')) }
  }))
  if (error) return { ok: false, status: 500, errore: 'Non riesco a preparare i codici, riprova.' }
  await admin.from('audit_accessi').insert({ utente_id: user.id, azione: 'codici_riserva_generati', risorsa: String(RISERVA_QUANTI) })
  return { ok: true, codici }
}

export async function usaCodiceRiserva(admin: Admin, user: Utente, sessionId: string, codiceGrezzo: unknown): Promise<Esito<{ restano: number }>> {
  const m = await metodiDi(admin, user)
  if (!m.app && !m.mail) return { ok: false, status: 409, errore: 'Non hai ancora attivato la verifica.' }
  const codice = String(codiceGrezzo || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (codice.length !== 8) return { ok: false, status: 400, errore: 'Il codice di riserva ha 8 caratteri (per esempio ABCD-EF23).' }

  const unOraFa = new Date(Date.now() - 3600_000).toISOString()
  const { count: errori } = await admin.from('verifica_tentativi').select('id', { count: 'exact', head: true }).eq('utente_id', user.id).eq('tipo', 'riserva').gte('quando', unOraFa)
  if ((errori || 0) >= RISERVA_ERRORI_ORA) return { ok: false, status: 429, errore: 'Troppi codici sbagliati: riprova tra un\'ora.' }

  const { data: liberi } = await admin.from('codici_riserva').select('id, sale, impronta').eq('utente_id', user.id).is('usato_il', null)
  const trovato = (liberi || []).find((r: { sale: string; impronta: string }) => uguali(r.impronta, impronta(r.sale, codice)))
  if (!trovato) {
    await admin.from('verifica_tentativi').insert({ utente_id: user.id, tipo: 'riserva' })
    console.warn('[VERIFICA][RISERVA][SBAGLIATO]', emailMascherata(String(user.email || '')))
    return { ok: false, status: 400, errore: 'Codice di riserva non valido o già usato.' }
  }
  const { data: preso } = await admin.from('codici_riserva').update({ usato_il: new Date().toISOString() }).eq('id', trovato.id).is('usato_il', null).select('id')
  if (!preso?.length) return { ok: false, status: 400, errore: 'Codice di riserva non valido o già usato.' }
  const s = await registraSessione(admin, user, sessionId, 'riserva')
  if (s.error) return { ok: false, status: 500, errore: 'Non riesco a completare l\'accesso, riprova tra poco.' }
  await admin.from('audit_accessi').insert({ utente_id: user.id, azione: 'verifica_codice_riserva', risorsa: 'sessione' })
  return { ok: true, restano: Math.max(0, (liberi?.length || 1) - 1) }
}

// ── TOGLIERE UN METODO ──────────────────────────────────────────────────────────────────────────────────

/** Toglie l'app o la mail: solo da una sessione verificata, e ne deve restare almeno uno. */
export async function togliMetodo(admin: Admin, user: Utente, metodo: string, verificata: boolean): Promise<Esito> {
  if (!verificata) return { ok: false, status: 403, errore: 'Entra prima con uno dei tuoi metodi.' }
  const m = await metodiDi(admin, user)
  if (metodo === 'app') {
    if (!m.app) return { ok: true }
    if (!m.mail) return { ok: false, status: 409, errore: 'È il tuo unico metodo: aggiungi prima la mail.' }
    for (const f of (user.factors || []).filter(f => (f.factor_type || 'totp') === 'totp')) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id })
      if (error) return { ok: false, status: 500, errore: 'Non riesco a togliere l\'app, riprova.' }
    }
    await admin.from('fattori_approvati').delete().eq('utente_id', user.id)
  } else if (metodo === 'mail') {
    if (!m.mail) return { ok: true }
    if (!m.app) return { ok: false, status: 409, errore: 'È il tuo unico metodo: aggiungi prima l\'app.' }
    const { error } = await admin.from('verifica_metodo').delete().eq('utente_id', user.id).eq('metodo', 'mail')
    if (error) return { ok: false, status: 500, errore: 'Non riesco a togliere la mail, riprova.' }
  } else return { ok: false, status: 400, errore: 'Metodo sconosciuto.' }
  await admin.from('audit_accessi').insert({ utente_id: user.id, azione: 'verifica_metodo_tolto', risorsa: metodo })
  return { ok: true }
}
