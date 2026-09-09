import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Salva gli STATI ORDINE WooCommerce da importare per un negozio (credenziali.stati_ordini).
// Serve ai negozi che usano uno STATO PERSONALIZZATO: aggiungendolo qui i loro ordini tornano a
// comparire nel portale (il default importa solo processing/on-hold). Stesso perimetro della sync:
// solo il cliente proprietario del negozio, scrittura via service-role (credenziali non è scrivibile
// dalla sessione utente), merge dentro credenziali senza toccare le chiavi API.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Solo i clienti possono modificare le integrazioni' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const integrazioneId = body.integrazione_id || body.id
  if (!integrazioneId) return NextResponse.json({ error: 'integrazione_id mancante' }, { status: 400 })

  // Pulizia: slug separati da virgola (lettere/numeri/trattino), senza prefisso wc-, max 10 stati.
  const stati = String(body.stati || '')
    .split(',').map((s: string) => s.trim().toLowerCase().replace(/^wc-/, '').replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean).slice(0, 10)
  const statiStr = Array.from(new Set(stati)).join(',')

  const admin = createAdminSupabase()
  const { data: integr } = await admin.from('integrazioni').select('id, credenziali')
    .eq('id', integrazioneId).eq('cliente_id', utente.cliente_id).eq('piattaforma', 'woocommerce').maybeSingle()
  if (!integr) return NextResponse.json({ error: 'Integrazione non trovata' }, { status: 404 })

  const nuoveCred = { ...(integr.credenziali as any || {}), stati_ordini: statiStr }
  const { error } = await admin.from('integrazioni').update({ credenziali: nuoveCred }).eq('id', integr.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, stati: statiStr })
}
