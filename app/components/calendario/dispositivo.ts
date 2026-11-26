'use client'
// QUESTO DISPOSITIVO E LE NOTIFICHE (calendario, fase 3, 26/11/2026). Tre casi:
//  - nell'app (guscio Capacitor, lib/app-nativa): il componente nativo PushNotifications dà il token di Apple o di
//    Firebase. Un'app vecchia (senza il componente) va aggiornata;
//  - nel browser: Web Push con il service worker /sw-notifiche.js e la chiave pubblica del server;
//  - Safari sull'iPhone fuori dall'app non riceve notifiche: lì si usa l'app.
// Il server (/api/notifiche/dispositivi) tiene un dispositivo per persona: chi entra per ultimo se lo prende.

export type Supporto = 'app' | 'app-vecchia' | 'web' | 'iphone-browser' | 'nessuno'
export type StatoQui = { supporto: Supporto; permesso: 'concesso' | 'negato' | 'da-chiedere'; attivo: boolean }

const CHIAVE_TOKEN = 'mx_push_token'
const cap = (): any => (typeof window !== 'undefined' ? (window as any).Capacitor : null)
export const piattaformaApp = (): 'ios' | 'android' | null => {
  const c = cap()
  if (!c?.isNativePlatform?.()) return null
  const p = c.getPlatform?.()
  return p === 'ios' || p === 'android' ? p : null
}
// Il portale gira nell'app come sito remoto: non ha la libreria JavaScript di Capacitor che costruisce gli oggetti dei
// componenti (Capacitor.Plugins è vuoto). Si parla col nativo come fa il ponte dei download (www/ponte-app.js del
// guscio): nativePromise per i comandi, addListener per gli eventi. Il componente c'è se il nativo lo elenca nelle
// PluginHeaders che inietta nella pagina; le app 1.0 e 1.1 non lo hanno e vanno aggiornate.
const pluginApp = (): any => {
  const c = cap()
  if (!c?.isNativePlatform?.() || typeof c.nativePromise !== 'function') return null
  if (!(c.PluginHeaders || []).some((h: any) => h?.name === 'PushNotifications')) return null
  const chiama = (metodo: string, opzioni: any = {}) => c.nativePromise('PushNotifications', metodo, opzioni)
  return {
    checkPermissions: () => chiama('checkPermissions'),
    requestPermissions: () => chiama('requestPermissions'),
    register: () => chiama('register'),
    unregister: () => chiama('unregister'),
    addListener: (evento: string, fn: (d: any) => void) => c.addListener('PushNotifications', evento, fn),
  }
}
const iPhoneSafari = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).navigator?.standalone

async function chiedi(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init)
  const d = await r.json().catch(() => null)
  if (!r.ok) throw new Error(d?.error || 'Operazione non riuscita')
  return d
}
const json = (method: string, body: any): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const salvaToken = (t: string | null) => { try { if (t) localStorage.setItem(CHIAVE_TOKEN, t); else localStorage.removeItem(CHIAVE_TOKEN) } catch { } }
const tokenSalvato = () => { try { return localStorage.getItem(CHIAVE_TOKEN) } catch { return null } }

function etichettaBrowser(): string {
  const ua = navigator.userAgent
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const s = /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return s ? `${b} su ${s}` : b
}
const daBase64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)) }

async function iscrizioneWeb(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

export async function statoQui(): Promise<StatoQui> {
  const app = piattaformaApp()
  if (app) {
    const p = pluginApp()
    if (!p) return { supporto: 'app-vecchia', permesso: 'da-chiedere', attivo: false }
    const r = await p.checkPermissions().catch(() => ({ receive: 'prompt' }))
    const permesso = r.receive === 'granted' ? 'concesso' : r.receive === 'denied' ? 'negato' : 'da-chiedere'
    const t = tokenSalvato()
    return { supporto: 'app', permesso, attivo: permesso === 'concesso' && !!t && await mio(t) }
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supporto: iPhoneSafari() ? 'iphone-browser' : 'nessuno', permesso: 'da-chiedere', attivo: false }
  }
  const permesso = Notification.permission === 'granted' ? 'concesso' : Notification.permission === 'denied' ? 'negato' : 'da-chiedere'
  const sub = permesso === 'concesso' ? await iscrizioneWeb().catch(() => null) : null
  return { supporto: 'web', permesso, attivo: !!sub && await mio(sub.endpoint) }
}

// il dispositivo è di chi ha la sessione? (su un computer condiviso può essere di un altro)
async function mio(indirizzo: string): Promise<boolean> {
  try { return !!(await chiedi('/api/notifiche/dispositivi?indirizzo=' + encodeURIComponent(indirizzo)))?.questo } catch { return false }
}

// ATTIVA (dopo un clic: i browser chiedono il permesso solo su un gesto di chi usa la pagina)
export async function attivaQui(): Promise<void> {
  const app = piattaformaApp()
  if (app) {
    const p = pluginApp()
    if (!p) throw new Error('Aggiorna l’app MoovExpress dallo store per ricevere le notifiche')
    const r = await p.requestPermissions()
    if (r.receive !== 'granted') throw new Error('Notifiche non permesse: attivale nelle impostazioni del telefono, alla voce MoovExpress')
    await registraApp(true)
    return
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(iPhoneSafari() ? 'Sull’iPhone le notifiche arrivano con l’app MoovExpress' : 'Questo browser non riceve notifiche')
  const permesso = await Notification.requestPermission()
  if (permesso !== 'granted') throw new Error(permesso === 'denied' ? 'Notifiche bloccate: riattivale dal lucchetto accanto all’indirizzo' : 'Permesso non concesso')
  const { vapid } = await chiedi('/api/notifiche/dispositivi')
  if (!vapid) throw new Error('Le notifiche del browser non sono ancora accese sul server')
  const reg = await navigator.serviceWorker.register('/sw-notifiche.js', { scope: '/' })
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: daBase64(vapid) }))
  await mandaIscrizioneWeb(sub, true)
}

// esplicito: chi ha premuto «Attiva» (il dispositivo passa a lui); altrimenti è il rinnovo automatico (solo se già suo)
async function mandaIscrizioneWeb(sub: PushSubscription, esplicito: boolean) {
  const j = sub.toJSON() as any
  await chiedi('/api/notifiche/dispositivi', json('POST', { tipo: 'web', indirizzo: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, etichetta: etichettaBrowser(), esplicito }))
}

// l'app: il token arriva dall'evento «registration», ascoltato una volta sola (agganciaApp)
let attesaToken: ((t: string) => void) | null = null
async function registraApp(aspetta: boolean): Promise<void> {
  const p = pluginApp()
  if (!p) return
  const arrivato = aspetta ? new Promise<string>((ok, ko) => { attesaToken = ok; setTimeout(() => ko(new Error('Il telefono non ha risposto: riprova')), 15000) }) : null
  await p.register()
  if (arrivato) await arrivato
}

export async function disattivaQui(): Promise<void> {
  const app = piattaformaApp()
  if (app) {
    const t = tokenSalvato()
    if (t) await chiedi('/api/notifiche/dispositivi', json('DELETE', { indirizzo: t }))
    salvaToken(null)
    await pluginApp()?.unregister?.().catch(() => {})
    return
  }
  const sub = await iscrizioneWeb().catch(() => null)
  if (sub) { await chiedi('/api/notifiche/dispositivi', json('DELETE', { indirizzo: sub.endpoint })).catch(() => {}); await sub.unsubscribe().catch(() => {}) }
}

export const notificaDiProva = (): Promise<{ inviate: number }> => chiedi('/api/notifiche/dispositivi/prova', { method: 'POST' })

// ── AGGANCIO A OGNI APERTURA DEL PORTALE (una volta per pagina) ──
// - app: ascolta il token (che il telefono può cambiare) e il tocco sulla notifica (apre la pagina giusta nel guscio);
//   se il permesso c'è già, si registra di nuovo: il token resta fresco e passa a chi è entrato;
// - browser: se c'è già un'iscrizione, la riassegna a chi è entrato (una volta per sessione);
// - all'«Esci» stacca questo dispositivo PRIMA di chiudere la sessione: su un computer condiviso le notifiche della
//   persona che esce non devono più arrivare lì.
let agganciato = false
export function agganciaDispositivo() {
  if (agganciato || typeof window === 'undefined') return
  agganciato = true
  const app = piattaformaApp(), p = pluginApp()
  if (app && p) {
    p.addListener('registration', async (t: { value: string }) => {
      // esplicito solo se il token arriva dopo «Attiva» (attesaToken); all'apertura è il rinnovo automatico
      const esplicito = !!attesaToken
      try {
        const r = await chiedi('/api/notifiche/dispositivi', json('POST', { tipo: app, indirizzo: t.value, etichetta: app === 'ios' ? 'iPhone' : 'Android', esplicito, precedente: tokenSalvato() }))
        if (r?.ok) salvaToken(t.value)
        attesaToken?.(t.value); attesaToken = null
      } catch (e) { console.error('[NOTIFICHE] token non salvato', e) }
    })
    p.addListener('registrationError', (e: any) => console.error('[NOTIFICHE] registrazione non riuscita', e?.error || e))
    p.addListener('pushNotificationActionPerformed', (a: any) => {
      const link = a?.notification?.data?.link
      if (typeof link === 'string' && link.startsWith('/')) window.location.href = link
    })
    p.checkPermissions().then((r: any) => { if (r.receive === 'granted') registraApp(false).catch(() => {}) }).catch(() => {})
  } else if ('serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
    let fatto = false
    try { fatto = sessionStorage.getItem('mx_push_sync') === '1' } catch { }
    if (!fatto) iscrizioneWeb().then((s) => s && mandaIscrizioneWeb(s, false)).then(() => { try { sessionStorage.setItem('mx_push_sync', '1') } catch { } }).catch(() => {})
  }
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || !a.getAttribute('href')?.includes('/api/auth/logout')) return
    e.preventDefault()
    const vai = () => { window.location.href = a.href }
    // al massimo un secondo e mezzo: uscire non deve restare appeso alla rete
    Promise.race([disattivaSoloServer(), new Promise((r) => setTimeout(r, 1500))]).finally(vai)
  }, true)
}

// all'uscita: il dispositivo si stacca dalla persona, ma il permesso del browser/telefono resta (chi rientra lo riprende)
async function disattivaSoloServer() {
  const indirizzo = piattaformaApp() ? tokenSalvato() : (await iscrizioneWeb().catch(() => null))?.endpoint
  if (indirizzo) await fetch('/api/notifiche/dispositivi', json('DELETE', { indirizzo })).catch(() => {})
  try { sessionStorage.removeItem('mx_push_sync') } catch { }
}
