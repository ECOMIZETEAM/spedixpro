// Invio SMS di notifica al destinatario, con il link al tracking del NOSTRO portale (/traccia/…).
// Gateway: Esendex Italia (docs.esendex.it) — API REST "app.esendex.it/API/v1.0/REST", POST /sms.
//
// AUTENTICAZIONE — due modi, in ordine di preferenza:
//  A) TOKEN (consigliato per Vercel): headers user_key + Access_token, con un token NON scadente preso
//     UNA volta dal pannello Esendex (pagina "API & IP"). Env: ESENDEX_USER_KEY + ESENDEX_ACCESS_TOKEN.
//     È l'unico modo affidabile da server: NON passa da /login.
//  B) LOGIN Basic (ripiego): GET /login con Basic Auth -> "USER_KEY;SESSION_KEY", chiave che scade dopo
//     5 min di inattività. Env: ESENDEX_USERNAME + ESENDEX_PASSWORD.
//
// PERCHÉ il token e non il login: verificato 12/08 che un WAF di Esendex risponde 404 a QUALSIASI
// "Authorization: Basic" ben formato sul path /login (e /token) da IP non in whitelist — e Vercel ha IP
// dinamici, non whitelistabili. Il login Basic dava quindi 404 -> "gateway non configurato" -> nessun SMS.
// L'invio con user_key+Access_token su /sms NON è bloccato dal WAF: è la strada giusta da serverless.
//
// Le credenziali stanno SOLO nelle env di Vercel, mai in chat. ESENDEX_SENDER = mittente/alias
// registrato; ESENDEX_QUALITY = 'N' alta, 'L' media, 'LL' bassa. Reggo anche i vecchi nomi SKEBBY_*.
// Se non c'è nessuna credenziale, tutto è NO-OP: nessun SMS parte finché non si configura il gateway.
//
// Regole rispettate: il nome del provider tecnico non compare mai al cliente; l'invio è best-effort e
// non blocca la creazione; il credito SMS si consuma SOLO via RPC atomica (sms_consuma), con rimborso
// automatico se l'invio poi fallisce.

const BASE = 'https://app.esendex.it/API/v1.0/REST'

// Prezzo di vendita per SMS: 1.000 SMS = 100 € → 0,10 €/SMS (senza IVA — società UK, reverse charge).
// Lo compra CHI manda gli SMS (il cliente per sé, o il master per i suoi clienti), pagando su Stripe.
export const COSTO_SMS_EUR = 0.10

function tokenConfigurato(): boolean {
  return !!((process.env.ESENDEX_USER_KEY || process.env.SKEBBY_USER_KEY) && (process.env.ESENDEX_ACCESS_TOKEN || process.env.SKEBBY_ACCESS_TOKEN))
}
function basicConfigurato(): boolean {
  return !!((process.env.ESENDEX_USERNAME || process.env.SKEBBY_USERNAME) && (process.env.ESENDEX_PASSWORD || process.env.SKEBBY_PASSWORD))
}
// Il gateway è pronto se abbiamo il token (modo A, preferito) OPPURE le credenziali di login (modo B).
export function smsConfigurato(): boolean {
  return tokenConfigurato() || basicConfigurato()
}

// Header di autenticazione per /sms. Preferisce SEMPRE il token (user_key + Access_token): non passa da
// /login, quindi immune al WAF e alla scadenza della sessione. Solo se il token non c'è, ripiega sul
// login Basic (user_key + Session_key). Ritorna null se non è configurato niente.
async function authHeaders(): Promise<Record<string, string> | null> {
  const userKey = process.env.ESENDEX_USER_KEY || process.env.SKEBBY_USER_KEY
  const accessToken = process.env.ESENDEX_ACCESS_TOKEN || process.env.SKEBBY_ACCESS_TOKEN
  if (userKey && accessToken) return { user_key: userKey, Access_token: accessToken }
  const s = await login()
  if (s) return { user_key: s.userKey, Session_key: s.sessionKey }
  return null
}

// ── Normalizzazione telefono italiano a E.164, SOLO se è un cellulare (gli SMS ai fissi non arrivano).
// I numeri in `dest_telefono` arrivano in mille formati: "+39 340…", "0039340…", "340 123 4567", "06…".
export function normalizzaTelefonoIT(raw: string | null | undefined): string | null {
  let d = String(raw || '').replace(/[^0-9]/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)          // prefisso internazionale 00 → cade il prefisso
  let naz = d
  if (d.startsWith('39') && d.length >= 12) naz = d.slice(2)   // include già il prefisso Italia
  // Cellulare italiano: inizia con 3, 9–10 cifre. Tutto il resto (fissi 0…, esteri) non riceve SMS.
  if (/^3\d{8,9}$/.test(naz)) return '+39' + naz
  return null
}

// Sessione Skebby in cache (le chiavi durano a lungo: si evita un login a ogni SMS).
let sessione: { userKey: string; sessionKey: string; ts: number } | null = null
const SESSIONE_TTL = 30 * 60 * 1000

async function login(): Promise<{ userKey: string; sessionKey: string } | null> {
  if (sessione && Date.now() - sessione.ts < SESSIONE_TTL) return sessione
  const u = process.env.ESENDEX_USERNAME || process.env.SKEBBY_USERNAME
  const p = process.env.ESENDEX_PASSWORD || process.env.SKEBBY_PASSWORD
  if (!u || !p) return null
  try {
    // Login in Basic Auth (consigliato dai doc Esendex): niente password nell'URL.
    const r = await fetch(`${BASE}/login`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') },
    })
    const txt = (await r.text()).trim()   // formato: "USER_KEY;SESSION_KEY"
    if (!r.ok) { console.error('[SMS][LOGIN] HTTP ' + r.status + ' ' + txt.slice(0, 160)); return null }
    const [userKey, sessionKey] = txt.split(';')
    if (!userKey || !sessionKey) { console.error('[SMS][LOGIN] risposta inattesa: ' + txt.slice(0, 160)); return null }
    sessione = { userKey, sessionKey, ts: Date.now() }
    return sessione
  } catch { return null }
}

// Invio grezzo di un SMS. Ritorna ok/errore, non lancia.
export async function inviaSms(telefono: string, messaggio: string): Promise<{ ok: boolean; error?: string }> {
  const dest = normalizzaTelefonoIT(telefono)
  if (!dest) return { ok: false, error: 'numero non cellulare' }
  const auth = await authHeaders()
  if (!auth) return { ok: false, error: 'gateway non configurato' }
  try {
    const r = await fetch(`${BASE}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        // Esendex: 'N' alta qualità/consegna, 'L' media, 'LL' bassa/economica.
        message_type: process.env.ESENDEX_QUALITY || process.env.SKEBBY_QUALITY || 'N',
        message: messaggio,
        sender: process.env.ESENDEX_SENDER || process.env.SKEBBY_SENDER || 'MoovExpress',
        recipient: [dest],
      }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (r.ok && (j?.result === 'OK' || j?.result === undefined)) return { ok: true }
    console.error('[SMS][INVIO] HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 200))
    // Esendex riporta l'errore in error_message (es. "Invalid value for parameter [user_key]").
    return { ok: false, error: j?.error_message || j?.result || j?.message || `HTTP ${r.status}` }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// AUTO-RICARICA: se il titolare (cliente o master) l'ha attivata e scende sotto la soglia, riaddebita
// un pacchetto sulla carta salvata (off_session). L'accredito lo fa il webhook (payment_intent.succeeded,
// scopo='sms'), idempotente. Best-effort: non lancia, non blocca l'invio. Un timbro `ultimo_addebito`
// evita doppioni da invii ravvicinati (finestra 30 min).
async function autoRicaricaSeServe(admin: any, tipo: 'cliente' | 'master', id: string): Promise<void> {
  try {
    const { stripeConfigurato, stripeClient } = await import('@/lib/stripe')
    if (!stripeConfigurato()) return
    const tab = tipo === 'cliente' ? 'clienti' : 'masters'
    const { data: t } = await admin.from(tab).select('credito_sms,impostazioni,stripe_customer_id').eq('id', id).maybeSingle()
    const imp = (t?.impostazioni as any) || {}
    const auto = imp.sms_auto
    if (!auto?.attiva || !t?.stripe_customer_id) return
    const soglia = Number(auto.soglia) || 0
    const pacchetto = Number(auto.pacchetto) || 1000
    const rimanenti = Math.floor(Number(t.credito_sms || 0) / COSTO_SMS_EUR)
    if (rimanenti >= soglia) return
    // Non riaddebitare se si è già tentato di recente (evita doppioni e non martella una carta ko).
    if (auto.ultimo_addebito && Date.now() - new Date(auto.ultimo_addebito).getTime() < 30 * 60 * 1000) return
    // Timbra SUBITO il tentativo (prima dell'addebito): due invii ravvicinati non fanno due ricariche.
    await admin.from(tab).update({ impostazioni: { ...imp, sms_auto: { ...auto, ultimo_addebito: new Date().toISOString() } } }).eq('id', id)

    const s = stripeClient()
    const cust: any = await s.customers.retrieve(t.stripe_customer_id)
    let pm: string | null = (cust?.invoice_settings?.default_payment_method as string) || null
    if (!pm) { const pms = await s.paymentMethods.list({ customer: t.stripe_customer_id, type: 'card', limit: 1 }); pm = pms.data[0]?.id || null }
    if (!pm) return
    await s.paymentIntents.create({
      amount: Math.round(pacchetto * COSTO_SMS_EUR * 100), currency: 'eur',
      customer: t.stripe_customer_id, payment_method: pm, off_session: true, confirm: true,
      metadata: { scopo: 'sms', quantita_sms: String(pacchetto), ...(tipo === 'cliente' ? { cliente_id: id } : { master_id: id }) },
    })
  } catch (e: any) {
    // Off_session può richiedere autenticazione (3DS) e fallire: pazienza, il titolare comprerà a mano.
    console.error('[SMS][AUTO-RICARICA]', tipo, id, e?.message)
  }
}

function urlTracking(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  return `${base}/traccia/${token}`
}

// Costruisce il testo dal template del cliente, risolvendo i segnaposto. I vecchi template usavano
// {sito-corriere} (mai risolto): ora punta al NOSTRO tracking. Se non c'è alcun segnaposto-link,
// il link si aggiunge in coda.
function costruisciMessaggio(template: string | null | undefined, numero: string, url: string, brand: string): string {
  let t = String(template || '').trim()
  if (!t) t = `${brand}: la tua spedizione {numero-spedizione} è in viaggio. Seguila qui: {tracking}`
  t = t.replace(/\{numero-spedizione\}/gi, numero || '')
       .replace(/\{sito-corriere\}/gi, url)
       .replace(/\{tracking\}/gi, url)
       .replace(/\{link\}/gi, url)
  if (!t.includes(url)) t = `${t} ${url}`.trim()
  return t
}

// ── ORCHESTRAZIONE: invio SMS "spedizione creata" per una spedizione appena inserita ────────────────
// Best-effort: gatea sulla preferenza notifica_sms del titolare, consuma 1 SMS dal credito (RPC atomica),
// invia, e in caso di errore rimborsa. Non lancia mai (non deve toccare la creazione).
export async function inviaSmsCreazione(spedizioneId: string | null | undefined): Promise<void> {
  if (!spedizioneId || !smsConfigurato()) return
  try {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sp } = await admin.from('spedizioni')
      .select('id,cliente_id,master_id,dest_telefono,tracking_token,numero')
      .eq('id', spedizioneId).maybeSingle()
    if (!sp || !sp.tracking_token) return

    // Account demo: nessun SMS reale parte (non si consuma credito, non si tocca il gateway).
    const { masterEDemo } = await import('@/lib/demo')
    if (await masterEDemo(sp.master_id, admin)) return

    const tel = normalizzaTelefonoIT(sp.dest_telefono)
    if (!tel) return   // niente numero cellulare: non si consuma credito

    // Preferenza + testo: dal cliente se è una spedizione cliente, altrimenti dal master (spedizione propria).
    let abilitato = false, testo: string | null = null
    if (sp.cliente_id) {
      const { data: c } = await admin.from('clienti').select('impostazioni').eq('id', sp.cliente_id).maybeSingle()
      const imp = (c?.impostazioni as any) || {}
      abilitato = imp.notifica_sms === true
      testo = imp.testo_sms || null
    } else if (sp.master_id) {
      const { data: m } = await admin.from('masters').select('impostazioni').eq('id', sp.master_id).maybeSingle()
      const imp = (m?.impostazioni as any) || {}
      abilitato = imp.notifica_sms === true
      testo = imp.testo_sms || null
    }
    if (!abilitato) return

    // Brand del master per il testo di default (white-label), ripiego MoovExpress.
    let brand = 'MoovExpress'
    if (sp.master_id) {
      const { data: mb } = await admin.from('masters').select('nome').eq('id', sp.master_id).maybeSingle()
      if (mb?.nome) brand = mb.nome
    }

    // Consuma 1 SMS dal credito del titolare (atomico): se il credito non basta, NON si invia.
    const { data: ok } = await admin.rpc('sms_consuma', { p_spedizione_id: sp.id, p_costo: COSTO_SMS_EUR, p_quantita: 1 })
    if (ok !== true) return

    const messaggio = costruisciMessaggio(testo, sp.numero || '', urlTracking(sp.tracking_token), brand)
    const esito = await inviaSms(tel, messaggio)
    if (esito.ok) {
      // Segna sulla spedizione che l'SMS è partito (per i report).
      await admin.from('spedizioni').update({ notifica_sms: true }).eq('id', sp.id)
      // Auto-ricarica del titolare, se attiva e sotto soglia (best-effort, non blocca).
      if (sp.cliente_id) await autoRicaricaSeServe(admin, 'cliente', sp.cliente_id)
      else if (sp.master_id) await autoRicaricaSeServe(admin, 'master', sp.master_id)
    } else {
      // Invio fallito dopo aver consumato: rimborsa il credito, così non si paga un SMS mai partito.
      console.error('[SMS][CREAZIONE] invio non riuscito per spedizione ' + sp.id + ': ' + esito.error)
      await admin.rpc('sms_rettifica', {
        p_master_id: sp.master_id, p_cliente_id: sp.cliente_id,
        p_importo: COSTO_SMS_EUR, p_note: 'Rimborso SMS non inviato', p_created_by: null,
      })
    }
  } catch { /* best-effort: la spedizione è già creata */ }
}
