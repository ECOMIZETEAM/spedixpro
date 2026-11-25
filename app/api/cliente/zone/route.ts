import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contrattoDelCliente, zoneDelContrattoCliente, provinciaPerVerifica } from '@/lib/zone-cliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ELENCO ZONE del cliente, in SOLA LETTURA (scheda "Elenco zone" del Listino Prezzi).
// Il perche' e le regole stanno in lib/zone-cliente.ts.

// GET ?corriere=<id>: le zone che il cliente paga su quel contratto, con le loro righe.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const corriereId = String(req.nextUrl.searchParams.get('corriere') || '').trim()
  const c = await contrattoDelCliente(supabase, user.id, corriereId)
  if (!c) return NextResponse.json({ error: 'Contratto non disponibile' }, { status: 404 })
  try {
    const zone = await zoneDelContrattoCliente(supabase, createAdminSupabase(), c)
    return NextResponse.json({ contratto: c.nomeContratto, zone })
  } catch (e: any) {
    console.error('[CLIENTE-ZONE] lettura', corriereId, e?.message)
    return NextResponse.json({ error: 'Elenco zone non disponibile in questo momento: riprova tra poco.' }, { status: 500 })
  }
}

// POST { corriere, cap, citta, paese?, provincia? }: in che zona cade un indirizzo su quel contratto.
// Stesso percorso della creazione: controllo della citta' (lib/citta-spedizione), poi il calcolo con
// cui si addebita (calcolaPrezzoListino). La risposta e' la zona che verra' fatta pagare.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const c = await contrattoDelCliente(supabase, user.id, String(body?.corriere || '').trim())
  if (!c) return NextResponse.json({ error: 'Contratto non disponibile' }, { status: 404 })

  const paese = String(body?.paese || 'IT').trim().toUpperCase().slice(0, 2) || 'IT'
  const cap = String(body?.cap || '').trim().toUpperCase()
  const citta = String(body?.citta || '').trim()
  if (!cap) return NextResponse.json({ error: 'Scrivi il CAP.' }, { status: 400 })
  if (paese === 'IT' && !/^\d{5}$/.test(cap)) return NextResponse.json({ error: 'Il CAP italiano ha 5 cifre.' }, { status: 400 })
  const provincia = provinciaPerVerifica(paese, cap, body?.provincia)
  if (paese === 'IT' && !provincia) return NextResponse.json({ error: 'Non riesco a ricavare la provincia da questo CAP: controlla il CAP.' }, { status: 400 })

  const admin = createAdminSupabase()
  try {
    const { cittaPerLaSpedizione } = await import('@/lib/citta-spedizione')
    const esitoCitta = await cittaPerLaSpedizione({ admin, corriereId: c.corriereId, cap, citta, paese, daImport: false })
    if (!esitoCitta.ok) return NextResponse.json({ esito: 'citta', messaggio: esitoCitta.errore, suggeriti: esitoCitta.suggeriti || [] })

    const { calcolaPrezzoListino } = await import('@/lib/pricing')
    const ris = await calcolaPrezzoListino(admin, {
      listinoId: c.listinoId, corriereId: c.corriereId, provincia, cap, paese, citta: esitoCitta.citta,
      packages: [{ weight: 1, length: 10, width: 10, height: 10 }],
    })
    if (!ris) return NextResponse.json({ esito: 'non_disponibile' })
    return NextResponse.json({ esito: 'ok', zona: ris.zona, provincia })
  } catch (e: any) {
    console.error('[CLIENTE-ZONE] verifica', c.corriereId, cap, e?.message)
    return NextResponse.json({ error: 'Verifica non disponibile in questo momento: riprova tra poco.' }, { status: 500 })
  }
}
