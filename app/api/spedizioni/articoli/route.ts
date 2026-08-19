import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// COSA C'E' DENTRO UN PACCO, E LO SCARICO DAL MAGAZZINO.
//
// Chi spedisce puo' dire quali articoli sta mandando: non e' obbligatorio, ma se lo dice il
// magazzino si aggiorna da solo.
//
// PERCHE' UNA ROTTA A PARTE E NON DENTRO LA CREAZIONE.
// La creazione ha QUATTRO inserimenti indipendenti, uno per corriere, senza un punto in comune:
// metterci dentro lo scarico vorrebbe dire scrivere la stessa cosa quattro volte e sperare di non
// dimenticarne una — e' l'errore che questo progetto ha gia' pagato piu' volte, e proprio in questo
// file. Qui invece il punto e' uno solo, e la creazione non viene toccata: se questo fallisce,
// nessuno smette di spedire.
//
// SI PUO' RICHIAMARE SENZA DANNI. L'indice unico (spedizione, articolo, tipo) impedisce di scaricare
// due volte lo stesso articolo per lo stesso pacco: un doppio invio, un ritentativo o un tasto
// premuto due volte non mangiano il magazzino.
//
// LA GIACENZA PUO' ANDARE SOTTO ZERO, ed e' voluto: il pacco e' reale e va spedito comunque.
// Il numero negativo si vede in rosso nel catalogo e si corregge con un conteggio.

// Chi puo' toccare gli articoli di QUESTA spedizione: il cliente le sue, lo staff di rete (mai
// agente/autista) quelle della sua rete. Ritorna { user, sped } oppure { err } con la risposta pronta.
async function autorizzaSped(supabase: any, admin: any, spedizioneId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('ruolo,cliente_id,master_id').eq('id', user.id).single()
  const { data: sped } = await admin.from('spedizioni').select('id,cliente_id,master_id').eq('id', spedizioneId).maybeSingle()
  if (!sped) return { err: NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 }) }
  if ((u?.ruolo || '').toLowerCase() === 'cliente') {
    if (!u?.cliente_id || sped.cliente_id !== u.cliente_id) return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  } else if (vedeLaRete(u)) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(admin, u.master_id)
    if (!rete.includes(sped.master_id)) return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  } else {
    return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  }
  return { user, sped }
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,cliente_id,master_id').eq('id', user.id).single()

  const b = await req.json().catch(() => ({}))
  const spedizioneId = String(b.spedizione_id || '')
  const righe: { articolo_id: string; quantita: number }[] = Array.isArray(b.articoli) ? b.articoli : []
  if (!spedizioneId || !righe.length) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  // LA SPEDIZIONE DEV'ESSERE SUA. Il cliente puo' toccare solo le proprie; chi governa la rete
  // (master, admin, operatore — mai agente o autista) quelle della sua rete.
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,cliente_id,master_id').eq('id', spedizioneId).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  if ((u?.ruolo || '').toLowerCase() === 'cliente') {
    if (!u?.cliente_id || sped.cliente_id !== u.cliente_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  } else if (vedeLaRete(u)) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(admin, u.master_id)
    if (!rete.includes(sped.master_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  } else {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Il magazzino e' del CLIENTE della spedizione: una spedizione propria del master non ne ha uno.
  if (!sped.cliente_id) return NextResponse.json({ error: 'Questa spedizione non ha un cliente a cui scaricare la merce' }, { status: 400 })

  // Solo articoli di QUEL cliente, e quantita' sensate: cosi' non si puo' scaricare il magazzino
  // di un altro passando un id qualsiasi.
  const ids = Array.from(new Set(righe.map(r => String(r.articolo_id || '')).filter(Boolean)))
  const { data: articoli } = await admin.from('articoli_cliente')
    .select('id').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    .eq('cliente_id', sped.cliente_id)
  const ammessi = new Set((articoli || []).map((a: any) => a.id))

  const daScaricare = righe
    .map(r => ({ id: String(r.articolo_id || ''), q: Math.trunc(Number(r.quantita)) }))
    .filter(r => ammessi.has(r.id) && isFinite(r.q) && r.q > 0)
  if (!daScaricare.length) return NextResponse.json({ error: 'Nessun articolo valido' }, { status: 400 })

  let scaricati = 0, gia = 0
  for (const r of daScaricare) {
    const { error } = await admin.from('articoli_movimenti').insert({
      articolo_id: r.id, cliente_id: sped.cliente_id, quantita: -Math.abs(r.q),
      tipo: 'spedizione', spedizione_id: spedizioneId, created_by: user.id,
    })
    // 23505 = l'indice unico ha gia' visto questo articolo per questa spedizione: e' il caso del
    // secondo invio, e non e' un errore da mostrare.
    if (error) {
      if ((error as any).code === '23505') { gia++; continue }
      console.error('[SPED-ARTICOLI] scarico fallito', spedizioneId, r.id, error.message)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    scaricati++
  }
  return NextResponse.json({ ok: true, scaricati, gia_scaricati: gia })
}

// IMPOSTA la lista completa degli articoli del pacco (aggiungi / modifica quantita' / togli).
// Serve alla logistica quando il cliente si dimentica il pezzo o sbaglia: il master corregge cosa
// c'e' davvero nel pacco. Riconcilia il registro articoli_movimenti (tipo 'spedizione') sulla lista
// DESIDERATA: aggiorna le quantita' esistenti, inserisce le nuove, toglie quelle non piu' presenti.
// Il saldo di magazzino (articoli_cliente.quantita) lo ricalcola il trigger. Lista vuota = svuota.
export async function PUT(req: NextRequest) {
  const supabase = await createServerSupabase()
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  const spedizioneId = String(b.spedizione_id || '')
  if (!spedizioneId) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  const a = await autorizzaSped(supabase, admin, spedizioneId)
  if ('err' in a) return a.err!
  const { user, sped } = a
  if (!sped.cliente_id) return NextResponse.json({ error: 'Questa spedizione non ha un cliente a cui scaricare la merce' }, { status: 400 })

  // Solo articoli di QUEL cliente, quantita' intere positive: niente scarico del magazzino altrui.
  const righe: { articolo_id: string; quantita: number }[] = Array.isArray(b.articoli) ? b.articoli : []
  const ids = Array.from(new Set(righe.map(r => String(r.articolo_id || '')).filter(Boolean)))
  const { data: art } = await admin.from('articoli_cliente')
    .select('id').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).eq('cliente_id', sped.cliente_id)
  const ammessi = new Set((art || []).map((x: any) => x.id))
  const desiderati = new Map<string, number>()
  for (const r of righe) {
    const id = String(r.articolo_id || ''); const q = Math.trunc(Number(r.quantita))
    if (ammessi.has(id) && isFinite(q) && q > 0) desiderati.set(id, q)
  }

  // Cosa c'e' gia' scaricato per questo pacco (una riga per articolo grazie all'indice unico).
  const { data: esistenti } = await admin.from('articoli_movimenti')
    .select('id,articolo_id').eq('spedizione_id', spedizioneId).eq('tipo', 'spedizione')
  const movDiArticolo = new Map<string, string>()
  for (const e of (esistenti || [])) movDiArticolo.set((e as any).articolo_id, (e as any).id)

  // Aggiorna/inserisce i desiderati.
  for (const [artId, q] of desiderati) {
    const movId = movDiArticolo.get(artId)
    if (movId) await admin.from('articoli_movimenti').update({ quantita: -Math.abs(q) }).eq('id', movId)
    else await admin.from('articoli_movimenti').insert({
      articolo_id: artId, cliente_id: sped.cliente_id, quantita: -Math.abs(q),
      tipo: 'spedizione', spedizione_id: spedizioneId, created_by: user!.id,
    })
  }
  // Toglie quelli non piu' nella lista (il trigger rimette la giacenza).
  const daTogliere = (esistenti || []).filter((e: any) => !desiderati.has(e.articolo_id)).map((e: any) => e.id)
  if (daTogliere.length) await admin.from('articoli_movimenti').delete().in('id', daTogliere)

  return NextResponse.json({ ok: true, articoli: desiderati.size })
}

// Cosa risulta dentro una spedizione: si legge dal registro, che e' l'unico posto dove sta scritto.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const spedizioneId = req.nextUrl.searchParams.get('spedizione_id') || ''
  if (!spedizioneId) return NextResponse.json([])
  const { data } = await supabase
    .from('articoli_movimenti')
    .select('quantita,articolo_id,articoli_cliente(sku,nome,prodotto,attributi)')
    .eq('spedizione_id', spedizioneId).eq('tipo', 'spedizione')
  return NextResponse.json(data || [])
}
