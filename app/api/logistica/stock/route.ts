import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// LO STOCK DEI CLIENTI A COLPO D'OCCHIO: chi ha merce, quanta, e dove sta.
//
// Il dato c'era gia' tutto — `articoli_cliente.quantita` per quanta, `articoli_cliente.blocco_id`
// per dove — ma si poteva leggere solo un articolo alla volta dentro il carico. Chi lavora in
// magazzino la domanda se la fa al contrario: "di questo cliente cos'ho, e in che corsia sta?".
//
// UNA LETTURA SOLA PER TABELLA, non una per cliente: con undici clienti e 28 referenze non si nota,
// ma questa pagina serve a crescere e una query dentro un ciclo diventa lenta senza che nessuno se
// ne accorga finche' non e' tardi (e' lo stesso errore che aveva l'ordinamento per margine).
//
// Le referenze SENZA posto si contano e si dicono: sono il buco che rende cieca la mappa del
// magazzino, e finche' restano alte una piantina sarebbe un capannone vuoto disegnato bene.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, (u as any).master_id)
  const perimetro = rete.length ? rete : ['00000000-0000-0000-0000-000000000000']

  const [art, blocchi, cli] = await Promise.all([
    admin.from('articoli_cliente')
      .select('id,cliente_id,sku,nome,quantita,blocco_id,attributi,updated_at')
      .in('master_id', perimetro),
    admin.from('logistica_blocchi')
      .select('id,cliente_id,ubicazione,liberato_il,logistica_tipi_blocco(nome)')
      .in('master_id', perimetro),
    admin.from('clienti').select('id,ragione_sociale').in('master_id', perimetro),
  ])

  const nomeCliente = new Map((cli.data || []).map((c: any) => [c.id, c.ragione_sociale]))
  const posto = new Map((blocchi.data || []).map((b: any) => [b.id, b]))

  // Un cliente per riga, con dentro le sue referenze. Si tengono anche quelle a ZERO: "questo
  // articolo esiste ma e' finito" e' un'informazione, sparire dall'elenco no.
  const perCliente = new Map<string, any>()
  for (const a of (art.data || []) as any[]) {
    if (!a.cliente_id) continue
    if (!perCliente.has(a.cliente_id)) {
      perCliente.set(a.cliente_id, {
        cliente_id: a.cliente_id,
        cliente: nomeCliente.get(a.cliente_id) || 'Cliente',
        pezzi: 0, referenze: 0, referenze_senza_posto: 0,
        ubicazioni: [] as string[], articoli: [] as any[],
        // I posti di QUESTO cliente, gia' pronti: la tendina per assegnare si apre senza un'altra
        // chiamata, e non puo' proporre il posto di un altro (che il server rifiuterebbe comunque).
        posti: (blocchi.data || [])
          .filter((b: any) => b.cliente_id === a.cliente_id && !b.liberato_il)
          .map((b: any) => ({ id: b.id, ubicazione: b.ubicazione || 'senza nome' })),
      })
    }
    const r = perCliente.get(a.cliente_id)
    const q = Number(a.quantita) || 0
    const b: any = a.blocco_id ? posto.get(a.blocco_id) : null
    const ubic = b?.ubicazione || null
    r.pezzi += q
    if (q > 0) {
      r.referenze++
      if (!ubic) r.referenze_senza_posto++
      if (ubic && !r.ubicazioni.includes(ubic)) r.ubicazioni.push(ubic)
    }
    r.articoli.push({
      id: a.id, sku: a.sku, nome: a.nome, quantita: q,
      variante: Object.values(a.attributi || {}).filter(Boolean).join(' · ') || null,
      ubicazione: ubic, tipo_posto: b?.logistica_tipi_blocco?.nome || null,
      // Un posto gia' liberato che tiene ancora merce e' una contraddizione da vedere subito:
      // o la merce e' uscita e nessuno l'ha scaricata, o il posto e' stato liberato per sbaglio.
      posto_liberato: !!(b && b.liberato_il),
      aggiornato: a.updated_at,
    })
  }

  const righe = [...perCliente.values()]
    .map(r => ({ ...r, articoli: r.articoli.sort((x: any, y: any) => y.quantita - x.quantita) }))
    .sort((a, b) => b.pezzi - a.pezzi || String(a.cliente).localeCompare(String(b.cliente)))

  // I posti liberi non appartengono a nessun cliente: si contano a parte, servono a capire
  // quanto spazio resta prima di dover dire no a un cliente nuovo.
  const liberi = (blocchi.data || []).filter((b: any) => !b.cliente_id || b.liberato_il).length

  return NextResponse.json({
    righe,
    totali: {
      clienti: righe.filter(r => r.pezzi > 0).length,
      pezzi: righe.reduce((s, r) => s + r.pezzi, 0),
      referenze: righe.reduce((s, r) => s + r.referenze, 0),
      senza_posto: righe.reduce((s, r) => s + r.referenze_senza_posto, 0),
      posti_occupati: (blocchi.data || []).filter((b: any) => b.cliente_id && !b.liberato_il).length,
      posti_liberi: liberi,
    },
  })
}

// ASSEGNARE IL POSTO DA QUI, non solo durante il carico.
//
// Prima l'ubicazione si poteva dire in un momento solo: mentre si registrava la merce in entrata. Chi
// se ne dimenticava (quasi tutti: 24 referenze su 28) non aveva piu' modo di rimediare se non
// facendo un finto carico. Il posto e' un'informazione che si scopre DOPO — si sistema lo scaffale,
// si sposta un cliente — e va potuta correggere dove la si guarda.
//
// Stessi controlli del carico: l'articolo dev'essere della rete di chi scrive, e il posto dello
// STESSO cliente dell'articolo, altrimenti l'ubicazione direbbe una bugia.
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const articoloId = String(b?.articolo_id || '').trim()
  const bloccoId = b?.blocco_id ? String(b.blocco_id).trim() : null
  if (!articoloId) return NextResponse.json({ error: 'Articolo mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, (u as any).master_id)

  // service-role: il perimetro si rifa' a mano, il database qui non isola piu' nulla.
  const { data: art } = await admin.from('articoli_cliente')
    .select('id,cliente_id,master_id').eq('id', articoloId).maybeSingle()
  if (!art || !rete.includes((art as any).master_id)) {
    return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })
  }

  if (bloccoId) {
    const { data: bl } = await admin.from('logistica_blocchi')
      .select('id,cliente_id,liberato_il,ubicazione').eq('id', bloccoId).maybeSingle()
    if (!bl) return NextResponse.json({ error: 'Posto non trovato' }, { status: 404 })
    if ((bl as any).cliente_id !== (art as any).cliente_id) {
      return NextResponse.json({ error: 'Quel posto è di un altro cliente: scegline uno suo, o creane uno nuovo.' }, { status: 400 })
    }
    // Un posto liberato non e' piu' in uso: metterci merce dentro lo farebbe sparire dal magazzino
    // (e dal conto di fine mese, che guarda solo i posti occupati).
    if ((bl as any).liberato_il) {
      return NextResponse.json({ error: 'Quel posto risulta liberato: riaprilo dal Magazzino, oppure scegline un altro.' }, { status: 400 })
    }
  }

  const { error } = await admin.from('articoli_cliente').update({ blocco_id: bloccoId }).eq('id', articoloId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
