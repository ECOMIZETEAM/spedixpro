import crypto from 'crypto'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { verificaUrlPubblico } from '@/lib/url-sicuro'

// Eventi notificati ai sistemi collegati.
export type EventoWebhook =
  | 'shipment.created'
  | 'tracking.updated'
  | 'tracking.delivered'
  | 'tracking.exception'

export const EVENTI_WEBHOOK: EventoWebhook[] = [
  'shipment.created', 'tracking.updated', 'tracking.delivered', 'tracking.exception',
]

// Firma HMAC-SHA256 su "{timestamp}.{body}" -> hex minuscolo.
export function firmaWebhook(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function generaSecretWebhook(): string {
  return 'whsec_' + crypto.randomBytes(24).toString('hex')
}

// Consegna con retry a backoff progressivo (come i webhook dei corrieri).
async function consegna(url: string, secret: string, payload: any, tentativi = 3) {
  // SSRF: l'URL del webhook lo sceglie il cliente. Si verifica a OGNI consegna (non solo alla
  // registrazione) che non risolva a un IP della rete interna: cosi' si copre anche il DNS rebinding
  // (URL registrato pubblico, poi fatto risolvere interno). Un URL legittimo risolve pubblico e passa;
  // uno interno viene saltato con errore, come un recapito non riuscito (i retry/stato lo gestiscono).
  const sic = await verificaUrlPubblico(url)
  if (!sic.ok) return { stato: 0, errore: 'url non consegnabile (punta alla rete interna): ' + sic.errore }
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const firma = firmaWebhook(secret, timestamp, body)
  let esito: { stato: number; errore: string | null } = { stato: 0, errore: 'nessun tentativo' }
  for (let i = 0; i < tentativi; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, i === 1 ? 1000 : 3000))
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Webhook-Timestamp': String(timestamp),
          'Webhook-Signature': `t=${timestamp},v1=${firma}`,
          'User-Agent': 'MoovExpress-Webhooks/1.0',
        },
        body,
        signal: ctrl.signal,
      })
      clearTimeout(t)
      esito = { stato: res.status, errore: res.ok ? null : `HTTP ${res.status}` }
      if (res.ok) return esito
    } catch (e: any) {
      esito = { stato: 0, errore: e?.message || 'errore di rete' }
    }
  }
  return esito
}

// Invia un evento ai webhook attivi del cliente (best-effort: non deve mai far fallire
// l'operazione che lo ha generato). Il chiamante può non attenderlo.
export async function inviaWebhook(params: {
  clienteId?: string | null
  corriereId?: string | null
  evento: EventoWebhook
  data: any
}): Promise<void> {
  try {
    if (!params.clienteId) return
    const admin = createAdminSupabase()
    const { data: hooks } = await admin.from('webhooks')
      .select('id,url,secret,eventi,corriere_id')
      .eq('attivo', true).eq('cliente_id', params.clienteId)
    if (!hooks?.length) return

    const payload = { event: params.evento, timestamp: Math.floor(Date.now() / 1000), data: params.data }
    for (const h of hooks as any[]) {
      // Filtro per eventi selezionati (NULL/vuoto = tutti) e per contratto (se il hook è legato a uno)
      if (Array.isArray(h.eventi) && h.eventi.length && !h.eventi.includes(params.evento)) continue
      if (h.corriere_id && params.corriereId && h.corriere_id !== params.corriereId) continue
      const esito = await consegna(h.url, h.secret, payload)
      try {
        await admin.from('webhooks').update({
          ultimo_invio_at: new Date().toISOString(), ultimo_stato: esito.stato, ultimo_errore: esito.errore,
        }).eq('id', h.id)
      } catch {}
    }
  } catch (e) {
    console.error('Invio webhook:', e)
  }
}
