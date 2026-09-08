import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { generaSecretWebhook, EVENTI_WEBHOOK } from '@/lib/webhooks'

// GET/POST /api/v1/webhooks — registrazione SELF-SERVICE delle callback per chi si integra via API,
// così da non dover fare polling. La chiave API è PER CONTRATTO: il webhook creato qui resta legato
// al contratto di quella chiave (niente consegne doppie se un partner con più contratti registra lo
// stesso URL su ogni chiave). Il secret di firma si vede SOLO alla creazione (e con rotate): dopo è
// mascherato — chi lo perde lo rigenera con PATCH { rotateSecret:true }. Vedi lib/webhooks.

const maschera = (s: string) => { const t = String(s || ''); return t.length <= 14 ? '••••' : t.slice(0, 10) + '••••' + t.slice(-4) }

// GET: elenco dei webhook dell'account (secret mascherato) + eventi disponibili.
export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b

  const admin = createAdminSupabase()
  const { data } = await admin.from('webhooks')
    .select('id,url,eventi,corriere_id,attivo,secret,ultimo_invio_at,ultimo_stato,ultimo_errore,created_at')
    .eq('cliente_id', ctx.clienteId)
    .order('created_at', { ascending: false })
  const webhooks = (data || []).map((h: any) => ({
    id: h.id, url: h.url, eventi: h.eventi || EVENTI_WEBHOOK, contratto_id: h.corriere_id,
    attivo: h.attivo, secret: maschera(h.secret),
    ultimo_invio_at: h.ultimo_invio_at, ultimo_stato: h.ultimo_stato, ultimo_errore: h.ultimo_errore,
    created_at: h.created_at,
  }))
  return NextResponse.json({ webhooks, eventi_disponibili: EVENTI_WEBHOOK })
}

// POST: crea un webhook. Body: { url (https, obbligatorio), eventi?: string[] }.
// Il contratto è quello della chiave API (non impostabile da qui: evita di registrare per contratti
// altrui). Il secret è restituito UNA sola volta, in chiaro: va annotato subito.
export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b

  const body = await req.json().catch(() => ({}))
  const url = String(body?.url || '').trim()
  if (!/^https:\/\/.+/i.test(url)) {
    return NextResponse.json({ error: 'URL non valido: deve iniziare con https://' }, { status: 400 })
  }
  // Eventi: se non indicati o vuoti -> tutti. Gli sconosciuti si scartano.
  let eventi: string[] | null = Array.isArray(body?.eventi) ? body.eventi.filter((e: any) => EVENTI_WEBHOOK.includes(e)) : null
  if (eventi && !eventi.length) eventi = null

  const admin = createAdminSupabase()
  // Un solo webhook per (account, contratto, URL): niente doppioni sullo stesso indirizzo (che
  // significherebbero consegne duplicate). Per un secret nuovo: PATCH rotateSecret, o elimina e ricrea.
  const { data: gia } = await admin.from('webhooks').select('id')
    .eq('cliente_id', ctx.clienteId).eq('corriere_id', ctx.corriereId).eq('url', url).maybeSingle()
  if (gia) return NextResponse.json({ error: 'Webhook già registrato per questo URL e contratto.', id: (gia as any).id }, { status: 409 })

  const secret = generaSecretWebhook()
  const { data, error } = await admin.from('webhooks').insert({
    master_id: ctx.masterId, cliente_id: ctx.clienteId, corriere_id: ctx.corriereId,
    url, secret, eventi, attivo: true,
  }).select('id,url,eventi,corriere_id,attivo,created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    id: data!.id, url: data!.url, eventi: data!.eventi || EVENTI_WEBHOOK, contratto_id: data!.corriere_id,
    attivo: data!.attivo, created_at: data!.created_at,
    // ANNOTA ORA: il secret non verrà più mostrato in chiaro (in GET è mascherato).
    secret,
    firma: 'HMAC-SHA256 (hex) su "{Webhook-Timestamp}.{corpo grezzo}"; header "Webhook-Signature: t=<unix>,v1=<hmac>"',
  }, { status: 201 })
}
