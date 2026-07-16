import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { generaSecretWebhook, EVENTI_WEBHOOK } from '@/lib/webhooks'

// Elenca i webhook del cliente (il secret serve al suo sistema per verificare la firma)
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { data } = await admin.from('webhooks')
    .select('id,corriere_id,url,secret,eventi,attivo,ultimo_invio_at,ultimo_stato,ultimo_errore,created_at')
    .eq('cliente_id', utente.cliente_id)
    .order('created_at', { ascending: false })
  return NextResponse.json(data || [])
}

// Crea un webhook: { url, eventi?: string[], corriereId?: string }
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const url = String(body.url || '').trim()
  if (!/^https:\/\/.+/i.test(url)) {
    return NextResponse.json({ error: 'URL non valido: deve iniziare con https://' }, { status: 400 })
  }
  // Eventi: se non indicati o vuoti -> tutti
  let eventi: string[] | null = Array.isArray(body.eventi) ? body.eventi.filter((e: any) => EVENTI_WEBHOOK.includes(e)) : null
  if (eventi && !eventi.length) eventi = null

  const admin = createAdminSupabase()
  const { data: cliente } = await admin.from('clienti').select('master_id').eq('id', utente.cliente_id).single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  const { data, error } = await admin.from('webhooks').insert({
    master_id: cliente.master_id, cliente_id: utente.cliente_id,
    corriere_id: body.corriereId || null,
    url, secret: generaSecretWebhook(), eventi, attivo: true,
  }).select('id,url,secret,eventi,attivo,created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
