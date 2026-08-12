// Invio SMS di notifica al destinatario, con il link al tracking del NOSTRO portale (/traccia/…).
// Gateway: Esendex Italia (docs.esendex.it) — API REST "app.esendex.it/API/v1.0/REST": login in Basic
// Auth -> "USER_KEY;SESSION_KEY", poi POST /sms. Le credenziali stanno SOLO nelle env di Vercel, mai in
// chat: ESENDEX_USERNAME (email dell'account), ESENDEX_PASSWORD, ESENDEX_SENDER (mittente/alias
// registrato), ESENDEX_QUALITY ('N' alta, 'L' media, 'LL' bassa). Reggo anche i vecchi nomi SKEBBY_*
// come ripiego. Se le env non ci sono, tutto è NO-OP: nessun SMS parte finché non si configura il gateway.
//
// Regole rispettate: il nome del provider tecnico non compare mai al cliente; l'invio è best-effort e
// non blocca la creazione; il credito SMS si consuma SOLO via RPC atomica (sms_consuma), con rimborso
// automatico se l'invio poi fallisce.

const BASE = 'https://app.esendex.it/API/v1.0/REST'

// Prezzo di vendita per SMS: 1.000 SMS = 100 € → 0,10 €/SMS (senza IVA — società UK, reverse charge).
// Lo compra CHI manda gli SMS (il cliente per sé, o il master per i suoi clienti), pagando su Stripe.
export const COSTO_SMS_EUR = 0.10

export function smsConfigurato(): boolean {
  return !!((process.env.ESENDEX_USERNAME || process.env.SKEBBY_USERNAME) && (process.env.ESENDEX_PASSWORD || process.env.SKEBBY_PASSWORD))
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
    if (!r.ok) return null
    const txt = (await r.text()).trim()   // formato: "USER_KEY;SESSION_KEY"
    const [userKey, sessionKey] = txt.split(';')
    if (!userKey || !sessionKey) return null
    sessione = { userKey, sessionKey, ts: Date.now() }
    return sessione
  } catch { return null }
}

// Invio grezzo di un SMS. Ritorna ok/errore, non lancia.
export async function inviaSms(telefono: string, messaggio: string): Promise<{ ok: boolean; error?: string }> {
  const dest = normalizzaTelefonoIT(telefono)
  if (!dest) return { ok: false, error: 'numero non cellulare' }
  const s = await login()
  if (!s) return { ok: false, error: 'gateway non configurato' }
  try {
    const r = await fetch(`${BASE}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', user_key: s.userKey, Session_key: s.sessionKey },
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
    return { ok: false, error: j?.result || `HTTP ${r.status}` }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
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
    } else {
      // Invio fallito dopo aver consumato: rimborsa il credito, così non si paga un SMS mai partito.
      await admin.rpc('sms_rettifica', {
        p_master_id: sp.master_id, p_cliente_id: sp.cliente_id,
        p_importo: COSTO_SMS_EUR, p_note: 'Rimborso SMS non inviato', p_created_by: null,
      })
    }
  } catch { /* best-effort: la spedizione è già creata */ }
}
