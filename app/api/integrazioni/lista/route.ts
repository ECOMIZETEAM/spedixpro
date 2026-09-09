import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('integrazioni')
    // NB: non selezioniamo "credenziali" (dato sensibile) verso il client
    .select('id, piattaforma, nome_negozio, identificativo, stato, ultimo_sync, ordini_totali, errore, created_at')
    .eq('cliente_id', utente.cliente_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Espone SOLO stati_ordini (non sensibile) dei negozi WooCommerce, leggendo credenziali via
  // service-role (le chiavi API non escono mai verso il client). Serve alla UI per mostrare/modificare
  // gli stati ordine da importare (custom compresi).
  const rows = data || []
  const wooIds = rows.filter((r: any) => r.piattaforma === 'woocommerce').map((r: any) => r.id)
  if (wooIds.length) {
    const { data: creds } = await createAdminSupabase().from('integrazioni').select('id, credenziali').in('id', wooIds)
    const statiDi = new Map<string, string>((creds || []).map((c: any) => [c.id, String(c.credenziali?.stati_ordini || '')]))
    for (const r of rows as any[]) if (r.piattaforma === 'woocommerce') r.stati_ordini = statiDi.get(r.id) || ''
  }
  return NextResponse.json({ integrazioni: rows })
}
