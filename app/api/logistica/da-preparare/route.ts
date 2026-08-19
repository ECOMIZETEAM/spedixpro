import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'
import { SPED_COLS } from '@/lib/spedizioni-cols'

// SPEDIZIONI DA PREPARARE (fulfillment logistica).
//
// Quando un cliente "gestione_logistica" crea una spedizione, la merce sta nel magazzino del master
// detentore: la spedizione nasce preparazione_stato='da_preparare' (vedi crea/route.ts) e lo staff
// del master la trova qui, la prepara fisicamente e la segna 'preparata'. Il cliente riceve la
// notifica di ritorno. L'etichetta e' gia' stata comprata e addebitata alla creazione: qui NON si
// tocca ne' corriere ne' credito, e' solo il passo operativo di preparazione del pacco.

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

const NESSUNO = ['00000000-0000-0000-0000-000000000000']

// GET: lista delle spedizioni ancora da preparare della RETE del master (come la lista giacenze),
// con gli articoli da prelevare quando il cliente li ha dichiarati.
// Con ?count=1 torna solo { count } (leggero): serve al badge rosso numerato sul menu, stile ticket.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, s.master_id)
  const reteSafe = rete.length ? rete : NESSUNO

  // Solo conteggio (badge): niente join/blob, TUTTA la rete del master.
  if (req.nextUrl.searchParams.get('count')) {
    const { count } = await admin.from('spedizioni')
      .select('id', { count: 'exact', head: true })
      .eq('preparazione_stato', 'da_preparare')
      .in('master_id', reteSafe)
    return NextResponse.json({ count: count || 0 })
  }

  const { data: speds, error } = await admin.from('spedizioni')
    .select(`${SPED_COLS}, preparazione_stato, clienti(ragione_sociale), corrieri(nome_contratto)`)
    .eq('preparazione_stato', 'da_preparare')
    .in('master_id', reteSafe)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Articoli da prelevare per questi pacchi (solo se il cliente li ha dichiarati alla spedizione).
  const ids = (speds || []).map((r: any) => r.id)
  const articoli: Record<string, any[]> = {}
  if (ids.length) {
    const { data: mov } = await admin.from('articoli_movimenti')
      .select('spedizione_id, articolo_id, quantita, articoli_cliente(sku,nome,prodotto)')
      .eq('tipo', 'spedizione').in('spedizione_id', ids)
    for (const m of (mov || [])) {
      const sid = (m as any).spedizione_id; if (!sid) continue
      const a = (m as any).articoli_cliente || {}
      ;(articoli[sid] ||= []).push({ articolo_id: (m as any).articolo_id, sku: a.sku, nome: a.nome || a.prodotto || a.sku, quantita: Math.abs(Number((m as any).quantita) || 0) })
    }
  }
  return NextResponse.json({ spedizioni: speds || [], articoli })
}

// POST: il master segna una spedizione come PREPARATA e avvisa il cliente.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const spedId = String(b.spedizioneId || b.id || '')
  if (!spedId) return NextResponse.json({ error: 'spedizioneId mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, s.master_id)
  const reteSafe = rete.length ? rete : NESSUNO

  // La spedizione dev'essere della rete di chi scrive: conoscere un id qualsiasi non basta.
  const { data: sped } = await admin.from('spedizioni')
    .select('id, master_id, cliente_id, numero, preparazione_stato')
    .eq('id', spedId).in('master_id', reteSafe).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata nella tua rete' }, { status: 403 })
  if (sped.preparazione_stato === 'preparata') return NextResponse.json({ ok: true, gia: true })

  const { error } = await admin.from('spedizioni').update({ preparazione_stato: 'preparata' }).eq('id', spedId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Notifica di ritorno al CLIENTE (evento per-cliente: cliente_id valorizzato, gruppi vuoto).
  if (sped.cliente_id) {
    try {
      await admin.from('notifiche').insert({
        master_id: sped.master_id,
        cliente_id: sped.cliente_id,
        gruppi: [],
        oggetto: 'Spedizione preparata',
        messaggio: `La spedizione ${sped.numero || ''} è stata preparata e affidata al corriere.`.replace(/\s+/g, ' ').trim(),
        link: '/cliente/spedizioni',
        created_by: s.user.id,
      })
    } catch (e) { console.error('[da-preparare] notifica cliente fallita', e) }
  }
  return NextResponse.json({ ok: true })
}
