// LE NOTIFICHE SUL TELEFONO E SUL COMPUTER (calendario, fase 3, 26/11/2026). Una funzione sola manda a tutti i
// dispositivi di una persona, qualunque sia il canale:
//  - browser (computer e Android): Web Push con le chiavi VAPID nostre (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
//  - iPhone (app): APNs di Apple con la chiave .p8 del team (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8 in base64,
//    APNS_BUNDLE_ID; APNS_SANDBOX=1 solo per le build di prova);
//  - Android (app): Firebase Cloud Messaging v1, SENZA CHIAVE: Vercel dimostra a Google chi è col suo gettone OIDC e
//    Google ci presta per un'ora il conto «moovexpress-push», che può solo mandare notifiche (FCM_PROJECT_ID,
//    FCM_WIF_PROVIDER, FCM_SERVICE_ACCOUNT_EMAIL: nessuno dei tre è segreto). Perché così: l'organizzazione
//    moovexpress.com vieta le chiavi scaricabili dei conti di servizio (Google, 26/11/2026) e Lorenzo ha scelto di non
//    togliere il divieto. Resta il ripiego FCM_SERVICE_ACCOUNT (il JSON in base64) se un giorno servisse.
// Le chiavi stanno solo nelle variabili di Vercel, mai nel codice né in chat. Un canale senza chiavi resta fermo (lo
// dice il registro una volta) e gli altri vanno lo stesso.
// Un indirizzo che il servizio dichiara morto (app tolta, permesso revocato) si spegne: la riga resta con il motivo.
import { connect } from 'node:http2'
import { createSign, sign as firma } from 'node:crypto'
import webpush from 'web-push'

export type Notifica = { titolo: string; testo: string; link: string; chiave?: string }
type Dispositivo = { id: string; tipo: 'web' | 'ios' | 'android'; indirizzo: string; p256dh: string | null; auth: string | null }
type Esito = 'ok' | 'morto' | 'errore' | 'senza_chiavi'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const avvisati = new Set<string>()
const manca = (canale: string) => { if (!avvisati.has(canale)) { avvisati.add(canale); console.warn(`[PUSH] chiavi ${canale} mancanti: il canale resta fermo`) } }

// ── browser ──
let vapidPronto: boolean | null = null
function vapid(): boolean {
  if (vapidPronto !== null) return vapidPronto
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) { manca('web'); return (vapidPronto = false) }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@moovexpress.com', pub, priv)
  return (vapidPronto = true)
}
export function chiavePubblicaWeb(): string | null { return process.env.VAPID_PUBLIC_KEY || null }

async function mandaWeb(d: Dispositivo, n: Notifica): Promise<Esito> {
  if (!vapid()) return 'senza_chiavi'
  if (!d.p256dh || !d.auth) return 'morto'
  try {
    await webpush.sendNotification({ endpoint: d.indirizzo, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(n),
      { TTL: 6 * 3600, urgency: 'high', ...(n.chiave ? { topic: b64url(n.chiave).slice(0, 32) } : {}) })
    return 'ok'
  } catch (e: any) {
    // 404 e 410: l'iscrizione non esiste più (permesso tolto, browser cancellato)
    if (e?.statusCode === 404 || e?.statusCode === 410) return 'morto'
    console.error('[PUSH] web non mandata:', e?.statusCode || '', String(e?.body || e?.message || e).slice(0, 200))
    return 'errore'
  }
}

// ── iPhone (APNs) ──
let apnsJwt: { t: string; scade: number } | null = null
function chiaveApns(): { jwt: string; bundle: string; host: string } | null {
  const kid = process.env.APNS_KEY_ID, team = process.env.APNS_TEAM_ID, p8 = process.env.APNS_KEY_P8, bundle = process.env.APNS_BUNDLE_ID || 'com.moovexpress.app'
  if (!kid || !team || !p8) { manca('ios'); return null }
  const host = process.env.APNS_SANDBOX === '1' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
  const ora = Math.floor(Date.now() / 1000)
  // Apple vuole un gettone fra 20 e 60 minuti di vita: se ne fa uno ogni 50
  if (!apnsJwt || apnsJwt.scade < ora) {
    const testa = b64url(JSON.stringify({ alg: 'ES256', kid })), corpo = b64url(JSON.stringify({ iss: team, iat: ora }))
    const pem = Buffer.from(p8, 'base64').toString('utf8')
    const sig = firma('sha256', Buffer.from(`${testa}.${corpo}`), { key: pem, dsaEncoding: 'ieee-p1363' })
    apnsJwt = { t: `${testa}.${corpo}.${b64url(sig)}`, scade: ora + 50 * 60 }
  }
  return { jwt: apnsJwt.t, bundle, host }
}

async function mandaIos(lista: Dispositivo[], n: Notifica): Promise<Map<string, Esito>> {
  const esiti = new Map<string, Esito>()
  const k = chiaveApns()
  if (!k) { for (const d of lista) esiti.set(d.id, 'senza_chiavi'); return esiti }
  const sessione = connect(k.host)
  sessione.on('error', (e) => console.error('[PUSH] apns connessione:', e?.message))
  const corpo = JSON.stringify({ aps: { alert: { title: n.titolo, body: n.testo }, sound: 'default', 'thread-id': 'calendario' }, link: n.link })
  try {
    await Promise.all(lista.map((d) => new Promise<void>((fatto) => {
      const req = sessione.request({
        ':method': 'POST', ':path': `/3/device/${d.indirizzo}`,
        authorization: `bearer ${k.jwt}`, 'apns-topic': k.bundle, 'apns-push-type': 'alert', 'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 6 * 3600),
        ...(n.chiave ? { 'apns-collapse-id': n.chiave.slice(0, 64) } : {}),
        'content-type': 'application/json',
      })
      let stato = 0, testo = ''
      req.setTimeout(10000, () => { req.close(); esiti.set(d.id, 'errore'); fatto() })
      req.on('response', (h) => { stato = Number(h[':status']) })
      req.on('data', (c) => { testo += c })
      req.on('end', () => {
        // 410 Unregistered e 400 BadDeviceToken: il token non vale più (app tolta, o build di un altro ambiente)
        const motivo = (() => { try { return JSON.parse(testo).reason } catch { return '' } })()
        if (stato === 200) esiti.set(d.id, 'ok')
        else if (stato === 410 || motivo === 'BadDeviceToken' || motivo === 'Unregistered') esiti.set(d.id, 'morto')
        else { esiti.set(d.id, 'errore'); console.error('[PUSH] apns non mandata:', stato, motivo) }
        fatto()
      })
      req.on('error', (e) => { esiti.set(d.id, 'errore'); console.error('[PUSH] apns:', e?.message); fatto() })
      req.end(corpo)
    })))
  } finally { sessione.close() }
  return esiti
}

// ── Android (FCM v1) ──
let fcmToken: { t: string; scade: number; progetto: string } | null = null
const fcmConfigurato = () => !!(process.env.FCM_SERVICE_ACCOUNT || (process.env.FCM_PROJECT_ID && process.env.FCM_WIF_PROVIDER && process.env.FCM_SERVICE_ACCOUNT_EMAIL))

// Il gettone OIDC di Vercel di QUESTA richiesta: Vercel lo mette nell'intestazione x-vercel-oidc-token, che legge dal
// contesto della richiesta (lo stesso simbolo che usa il pacchetto @vercel/oidc); in locale arriva da VERCEL_OIDC_TOKEN.
// Dura pochi minuti e dice chi siamo (team ecomize, progetto, ambiente): Google lo accetta solo per produzione e sviluppo.
function gettoneVercel(): string | null {
  const contesto = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.()
  return contesto?.headers?.['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || null
}

async function accessoFcm(): Promise<{ t: string; progetto: string } | null> {
  if (!fcmConfigurato()) { manca('android'); return null }
  const ora = Math.floor(Date.now() / 1000)
  if (fcmToken && fcmToken.scade > ora + 60) return fcmToken
  if (process.env.FCM_SERVICE_ACCOUNT) return accessoFcmConChiave(ora)
  const oidc = gettoneVercel()
  if (!oidc) { console.error('[PUSH] fcm: manca il gettone OIDC di Vercel (OIDC Federation spenta nel progetto?)'); return null }
  // 1) Google scambia il gettone di Vercel con un suo gettone federato (regola «vercel» del progetto Google)
  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: `//iam.googleapis.com/${process.env.FCM_WIF_PROVIDER}`,
      scope: 'https://www.googleapis.com/auth/cloud-platform', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken: oidc,
    }),
  })
  const s = await sts.json().catch(() => null)
  if (!sts.ok || !s?.access_token) { console.error('[PUSH] fcm: Google non ha accettato il gettone di Vercel:', sts.status, s?.error || '', s?.error_description || ''); return null }
  // 2) col gettone federato, un'ora del conto «moovexpress-push» (può solo mandare notifiche)
  const imp = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(process.env.FCM_SERVICE_ACCOUNT_EMAIL!)}:generateAccessToken`, {
    method: 'POST', headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/firebase.messaging'], lifetime: '3600s' }),
  })
  const i = await imp.json().catch(() => null)
  if (!imp.ok || !i?.accessToken) { console.error('[PUSH] fcm: conto di servizio non prestato:', imp.status, i?.error?.status || '', String(i?.error?.message || '').slice(0, 160)); return null }
  const scade = Math.floor(new Date(i.expireTime).getTime() / 1000) || ora + 3000
  fcmToken = { t: i.accessToken, scade, progetto: process.env.FCM_PROJECT_ID! }
  return fcmToken
}

// ripiego: il JSON del conto di servizio (oggi l'organizzazione non permette di crearlo)
async function accessoFcmConChiave(ora: number): Promise<{ t: string; progetto: string } | null> {
  const sa = JSON.parse(Buffer.from(process.env.FCM_SERVICE_ACCOUNT!, 'base64').toString('utf8'))
  const testa = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: ora, exp: ora + 3600 }))
  const s = createSign('RSA-SHA256'); s.update(`${testa}.${corpo}`)
  const asserzione = `${testa}.${corpo}.${b64url(s.sign(sa.private_key))}`
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: asserzione }) })
  const d = await r.json().catch(() => null)
  if (!r.ok || !d?.access_token) { console.error('[PUSH] fcm accesso non riuscito:', r.status, d?.error || ''); return null }
  fcmToken = { t: d.access_token, scade: ora + Number(d.expires_in || 3600), progetto: sa.project_id }
  return fcmToken
}

async function mandaAndroid(d: Dispositivo, n: Notifica): Promise<Esito> {
  const a = await accessoFcm()
  if (!a) return fcmConfigurato() ? 'errore' : 'senza_chiavi'
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.progetto}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${a.t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token: d.indirizzo,
      notification: { title: n.titolo, body: n.testo },
      data: { link: n.link },
      android: { priority: 'HIGH', ttl: '21600s', notification: { ...(n.chiave ? { tag: n.chiave.slice(0, 64) } : {}) } },
    } }),
  })
  if (r.ok) return 'ok'
  const e = await r.json().catch(() => null)
  const codice = (e?.error?.details || []).map((x: any) => x.errorCode).find(Boolean) || e?.error?.status
  // UNREGISTERED: app tolta o token scaduto; un token storto torna INVALID_ARGUMENT con «registration token»
  if (codice === 'UNREGISTERED' || r.status === 404 || (codice === 'INVALID_ARGUMENT' && /registration token/i.test(e?.error?.message || ''))) return 'morto'
  console.error('[PUSH] fcm non mandata:', r.status, codice || '')
  return 'errore'
}

// A TUTTI I DISPOSITIVI ATTIVI DI UNA PERSONA. Ritorna quanti l'hanno ricevuta: 0 non è un errore (nessun dispositivo).
export async function mandaPush(admin: any, utenteId: string, n: Notifica): Promise<{ inviate: number; spenti: number; errori: number }> {
  const conti = { inviate: 0, spenti: 0, errori: 0 }
  const { data, error } = await admin.from('notifiche_dispositivi').select('id,tipo,indirizzo,p256dh,auth').eq('utente_id', utenteId).is('disattivato_il', null).limit(20)
  if (error) { console.error('[PUSH] dispositivi non letti:', error.message); conti.errori++; return conti }
  const lista = (data || []) as Dispositivo[]
  if (!lista.length) return conti
  const notifica = { ...n, titolo: n.titolo.slice(0, 120), testo: n.testo.slice(0, 300) }
  const esiti = new Map<string, Esito>()
  const ios = lista.filter((d) => d.tipo === 'ios')
  const [, altri] = await Promise.all([
    ios.length ? mandaIos(ios, notifica).then((m) => m.forEach((v, k) => esiti.set(k, v))) : Promise.resolve(),
    Promise.all(lista.filter((d) => d.tipo !== 'ios').map(async (d) => esiti.set(d.id, d.tipo === 'web' ? await mandaWeb(d, notifica) : await mandaAndroid(d, notifica)))),
  ])
  void altri
  const morti: string[] = [], usati: string[] = []
  for (const [id, e] of esiti) {
    if (e === 'ok') { conti.inviate++; usati.push(id) }
    else if (e === 'morto') { conti.spenti++; morti.push(id) }
    else if (e === 'errore') conti.errori++
  }
  const adesso = new Date().toISOString()
  if (usati.length) await admin.from('notifiche_dispositivi').update({ ultimo_uso: adesso }).in('id', usati)
  if (morti.length) await admin.from('notifiche_dispositivi').update({ disattivato_il: adesso, motivo_spento: 'il servizio dice che non esiste più' }).in('id', morti)
  return conti
}
