import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// ELENCO DEI REPORT GENERATI, sotto il modulo di ogni pagina report del portale master.
// Prima: gli ultimi 50 di qualunque utente del master, compresi quelli che i CLIENTI si generano dal
// loro portale (QUICK: 76 su 106). Lo staff si ritrovava l'elenco pieno di file non suoi e i propri
// report spinti oltre il cinquantesimo, cioe' spariti. Ora lo staff vede i report di staff e agenti del
// suo master, l'agente i suoi, il cliente i suoi; fino a 200.
const LIMITE = 200

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const ruolo = (utente?.ruolo || '').toLowerCase()
  if (ruolo === 'autista') return NextResponse.json([])
  const tipo = req.nextUrl.searchParams.get('tipo')

  const base = () => {
    let q = supabase.from('reports_generati')
      .select('*')
      .eq('master_id', utente.master_id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIMITE)
    if (tipo) q = q.eq('tipo', tipo)
    return q
  }

  // Agente: SOLO i report che ha generato lui (per created_by, allineato alla RLS).
  if (ruolo === 'agente') {
    const { data, error } = await base().eq('created_by', user.id)
    if (error) return NextResponse.json({ error: 'Elenco report non disponibile: ' + error.message }, { status: 500 })
    return NextResponse.json(data || [])
  }
  // Cliente: la pagina Report Spedizioni del portale cliente rilegge l'elenco da qui dopo aver salvato.
  // Solo i suoi, come /api/cliente/reports/lista da cui la stessa pagina lo carica all'apertura.
  if (ruolo === 'cliente' || utente.cliente_id) {
    if (!utente.cliente_id) return NextResponse.json([])
    const { data, error } = await base().eq('cliente_id', utente.cliente_id)
    if (error) return NextResponse.json({ error: 'Elenco report non disponibile: ' + error.message }, { status: 500 })
    return NextResponse.json(data || [])
  }

  // Staff del master: i report generati da utenti NON cliente del master (staff e agenti). Gli id si
  // leggono con la chiave di servizio, ma solo quelli del MIO master; l'elenco resta letto col client
  // dell'utente, sotto la RLS di sempre.
  const admin = createAdminSupabase()
  const { data: staff, error: eS } = await admin.from('utenti').select('id,ruolo')
    .eq('master_id', utente.master_id).is('cliente_id', null)
  if (eS) return NextResponse.json({ error: 'Elenco report non disponibile: ' + eS.message }, { status: 500 })
  const ids = (staff || []).filter((u: any) => String(u.ruolo || '').toLowerCase() !== 'cliente').map((u: any) => u.id)
  if (!ids.length) return NextResponse.json([])
  // A blocchi di 200 (un master ne ha qualche decina): ogni blocco porta i suoi 200 piu' recenti, e
  // dalla fusione si tengono i 200 piu' recenti in tutto.
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await base().in('created_by', ids.slice(i, i + 200))
    if (error) return NextResponse.json({ error: 'Elenco report non disponibile: ' + error.message }, { status: 500 })
    out.push(...(data || []))
  }
  out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
  return NextResponse.json(out.slice(0, LIMITE))
}
