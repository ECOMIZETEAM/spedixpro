import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
async function getClienteId(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  return utente?.cliente_id || null
}
export async function GET() {
  const supabase = await createServerSupabase()
  const id = await getClienteId(supabase)
  if (!id) return NextResponse.json([])
  const { data: cliente } = await supabase.from('clienti').select('listino_cliente_id,master_id').eq('id', id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json([])
  const { data: agganci } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto)')
    .eq('listino_id', cliente.listino_cliente_id)
  // QUELLO CHE IL PADRE NON HA PIU', IL FIGLIO NON PUO' VENDERLO.
  // Un contratto si spegne dalla scheda del cliente o del sotto-master, e l'effetto scende lungo
  // tutta la catena: se il master sopra smette di dare BRT al suo sotto-master, i clienti di quel
  // sotto-master non devono piu' vederlo — anche se nel loro listino c'e' ancora, perche' il
  // listino non viene toccato: si nasconde, non si cancella, e riaccendendolo torna tutto.
  // Qui la regola mancava: il contratto restava nell'elenco delle impostazioni e il cliente poteva
  // pure accenderlo, salvo poi scoprire in creazione che non si puo' usare. Le rotte che contano
  // (tariffe, creazione, API) la applicavano gia': era questa a raccontare un'altra storia.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesi = await contrattiSospesiSopra(cliente.master_id)
  const contratti = (agganci||[]).map((r:any) => r.corrieri).filter(Boolean)
    // BUG: prima confrontava `sospesi.has(c.id)`, ma il set contiene i NOMI dei contratti (minuscoli),
    // non gli id → sempre falso, il filtro non toglieva nulla e un contratto tolto sopra restava
    // accendibile dal cliente. Ora si confronta per nome, come tutte le altre porte.
    .filter((c:any) => !sospesoDallaCatena(c.nome_contratto, sospesi))
  const { data: stati } = await supabase.from('clienti_corrieri_abilitati')
    .select('corriere_id, abilitato, settings').eq('cliente_id', id)
  const mappaAbil = new Map((stati||[]).map((s:any) => [s.corriere_id, s.abilitato]))
  const mappaSett = new Map((stati||[]).map((s:any) => [s.corriere_id, s.settings || {}]))
  const risultato = contratti.map((c:any) => ({
    // Niente campo `tipo`: e' il sistema tecnico dietro il contratto e non deve arrivare al
    // cliente. La rotta gemella /api/cliente/corrieri lo toglieva gia'; qui era rimasto, e
    // usciva nel JSON di tre pagine del portale. Nessuna pagina lo usa.
    id: c.id, nome_contratto: c.nome_contratto,
    abilitato: mappaAbil.has(c.id) ? mappaAbil.get(c.id) : true,
    settings: mappaSett.has(c.id) ? mappaSett.get(c.id) : {},
  }))
  return NextResponse.json(risultato)
}
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const id = await getClienteId(supabase)
  if (!id) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { corriereId, abilitato, settings } = await req.json()
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })
  const payload: any = { cliente_id: id, corriere_id: corriereId }
  if (abilitato !== undefined) payload.abilitato = abilitato
  if (settings !== undefined) payload.settings = settings
  const { error } = await supabase.from('clienti_corrieri_abilitati')
    .upsert(payload, { onConflict: 'cliente_id,corriere_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}