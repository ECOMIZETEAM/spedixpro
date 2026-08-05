import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// LA GIACENZA SI MUOVE SOLO DA QUI.
//
// `articoli_cliente.quantita` non si scrive mai a mano: e' il saldo del registro
// `articoli_movimenti`, tenuto da un trigger. E' la stessa forma del credito, e per lo stesso
// motivo — a un "perche' ne ho 3?" si deve poter rispondere leggendo la storia, e dopo un annullo o
// un reso si deve sapere quanto rimettere senza indovinare.
//
// Due gesti, che sono due cose diverse e vanno distinte nel registro:
//  - CARICO: e' arrivata merce. Si aggiunge N a quello che c'e'.
//  - INVENTARIO: ho contato, ce ne sono N. Si scrive la DIFFERENZA, non il numero: cosi' resta
//    scritto quanto mancava (o avanzava) rispetto a quello che il sistema credeva.

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,cliente_id').eq('id', user.id).single()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const articoloId = String(b.articolo_id || '')
  const tipo = String(b.tipo || 'carico')
  if (!articoloId) return NextResponse.json({ error: 'Articolo mancante' }, { status: 400 })
  if (!['carico', 'inventario'].includes(tipo)) {
    return NextResponse.json({ error: 'Movimento non ammesso da qui' }, { status: 400 })
  }

  // L'articolo dev'essere suo. La RLS lo garantirebbe comunque, ma un 404 chiaro e' meglio di una
  // riga che sparisce in silenzio.
  const { data: art } = await supabase
    .from('articoli_cliente').select('id,sku,quantita').eq('id', articoloId).eq('cliente_id', u.cliente_id).maybeSingle()
  if (!art) return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })

  const n = Math.trunc(Number(b.quantita))
  if (!isFinite(n)) return NextResponse.json({ error: 'Quantita non valida' }, { status: 400 })

  let delta = n
  if (tipo === 'inventario') {
    if (n < 0) return NextResponse.json({ error: 'Un conteggio non puo\' essere negativo' }, { status: 400 })
    delta = n - Number(art.quantita || 0)
    if (delta === 0) return NextResponse.json({ ok: true, invariato: true, quantita: n })
  } else {
    if (n <= 0) return NextResponse.json({ error: 'Il carico dev\'essere maggiore di zero' }, { status: 400 })
  }

  const { error } = await supabase.from('articoli_movimenti').insert({
    articolo_id: art.id, cliente_id: u.cliente_id, quantita: delta, tipo,
    nota: b.nota ? String(b.nota).trim().slice(0, 200) : null, created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { data: dopo } = await supabase
    .from('articoli_cliente').select('quantita').eq('id', art.id).single()
  return NextResponse.json({ ok: true, quantita: dopo?.quantita ?? null, applicato: delta })
}

// La storia di un articolo: serve a rispondere a "perche' ne ho 3?".
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,cliente_id').eq('id', user.id).single()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const articoloId = req.nextUrl.searchParams.get('articolo_id') || ''
  if (!articoloId) return NextResponse.json([])
  const { data } = await supabase
    .from('articoli_movimenti')
    .select('id,quantita,tipo,nota,spedizione_id,created_at,spedizioni(numero)')
    .eq('articolo_id', articoloId).eq('cliente_id', u.cliente_id)
    .order('created_at', { ascending: false }).limit(100)
  return NextResponse.json(data || [])
}
