import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// IL MASTER CARICA MERCE A NOME DEL CLIENTE.
//
// Arriva un bancale, il magazziniere lo mette a posto e registra cosa e' entrato: sceglie il
// cliente, l'articolo e quanti pezzi. Non serve una bolla ne' un documento — anche a mano.
//
// La quantita' finisce nello STESSO registro del portale cliente (`articoli_movimenti`), non in una
// tabella parallela: cosi' il cliente vede il carico nel suo magazzino, e il saldo e' uno solo.
// Se ci fossero due registri, prima o poi direbbero due numeri diversi.
//
// Si puo' anche dire in quale POSTO e' finita la merce: l'ubicazione si legge dal blocco, cosi' non
// e' scritta due volte e non puo' divergere da quella che si fattura.

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const articoloId = String(b.articolo_id || '')
  const n = Math.trunc(Number(b.quantita))
  if (!articoloId) return NextResponse.json({ error: 'Scegli l\'articolo' }, { status: 400 })
  if (!isFinite(n) || n === 0) return NextResponse.json({ error: 'Quantita non valida' }, { status: 400 })

  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, u.master_id)

  // L'articolo dev'essere di un cliente della MIA rete: non basta conoscerne l'id.
  //
  // DUE LETTURE, NON UNA CON LA RELAZIONE INCORPORATA. Con `clienti!inner(master_id)` il dato
  // arriva a volte come oggetto e a volte come elenco di uno, a seconda di come PostgREST decide di
  // tipizzare la join: leggendolo come oggetto tornava undefined, e un carico legittimo veniva
  // rifiutato con "Articolo non trovato nella tua rete" — successo davvero, al primo uso vero.
  // Due query separate costano niente e non hanno forme ambigue.
  const { data: art } = await admin.from('articoli_cliente')
    .select('id,cliente_id,sku').eq('id', articoloId).maybeSingle()
  if (!art) return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })
  const { data: cli } = await admin.from('clienti').select('master_id').eq('id', art.cliente_id).maybeSingle()
  if (!cli?.master_id || !rete.includes(cli.master_id)) {
    return NextResponse.json({ error: 'Articolo non trovato nella tua rete' }, { status: 403 })
  }

  // Dove l'ho messo. Il blocco dev'essere dello stesso cliente, altrimenti l'ubicazione direbbe una
  // cosa e la fattura un'altra.
  if (b.blocco_id) {
    const { data: bl } = await admin.from('logistica_blocchi').select('id,cliente_id').eq('id', b.blocco_id).maybeSingle()
    if (!bl || bl.cliente_id !== art.cliente_id) {
      return NextResponse.json({ error: 'Il posto scelto non e di questo cliente' }, { status: 400 })
    }
    await admin.from('articoli_cliente').update({ blocco_id: b.blocco_id }).eq('id', art.id)
  }

  const { error } = await admin.from('articoli_movimenti').insert({
    articolo_id: art.id, cliente_id: art.cliente_id, quantita: n,
    tipo: n > 0 ? 'carico' : 'rettifica',
    nota: b.nota ? String(b.nota).trim().slice(0, 200) : 'carico a magazzino',
    created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { data: dopo } = await admin.from('articoli_cliente').select('quantita').eq('id', art.id).single()
  return NextResponse.json({ ok: true, quantita: dopo?.quantita ?? null })
}
