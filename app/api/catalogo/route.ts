import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente, isAgente, clientiAgente } from '@/lib/agente'

// IL CATALOGO, DAL LATO DEL MASTER.
//
// Il catalogo e' del CLIENTE — e' la sua merce, e lo SKU e' il codice con cui lui la riconosce —
// ma finora poteva compilarlo solo lui, dal suo portale. Quasi nessuno lo faceva: due clienti su
// tutta la rete. Da qui puo' farlo il master, che e' quello che i pesi veri li conosce perche' i
// pacchi li vede passare.
//
// La tabella e' quella che c'era gia' (articoli_cliente): un secondo catalogo avrebbe voluto dire
// due verita' sullo stesso SKU e la solita domanda su quale sia quella buona.
//
// Il senso e' una riga sola: peso e misure li mette il sistema. Chi spedisce sempre le stesse cose
// oggi le ridigita ogni volta, e quando sbaglia il volumetrico se ne accorge in fattura.

async function contesto() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('id,master_id,cliente_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  return { supabase, admin: createAdminSupabase(), user, utente }
}

// Il cliente su cui si sta lavorando, con la prova che chi chiama puo' davvero toccarlo: le
// scritture usano il client amministrativo, che scavalca l'isolamento.
async function clienteDiLavoro(supabase: any, admin: any, utente: any, clienteId: string | null) {
  if (utente.ruolo === 'cliente') {
    if (!utente.cliente_id) return null
    const { data: c } = await admin.from('clienti').select('id,master_id').eq('id', utente.cliente_id).maybeSingle()
    return c || null
  }
  if (!clienteId) return null
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, utente.master_id)
  const { data: c } = await admin.from('clienti').select('id,master_id').eq('id', clienteId).maybeSingle()
  if (!c || !rete.includes(c.master_id)) return null
  if (isAgente(utente)) {
    const miei = await clientiAgente(supabase, utente)
    if (!miei.includes(c.id)) return null
  }
  return c
}

const CAMPI = ['sku', 'nome', 'ean13', 'asin', 'prezzo', 'url_immagine', 'peso', 'lunghezza', 'larghezza',
  'altezza', 'descrizione_doganale', 'valore_dichiarato', 'codice_hs', 'codice_mid', 'paese_origine',
  'corriere_id', 'corriere_estero_id'] as const
const NUMERICI = new Set(['prezzo', 'peso', 'lunghezza', 'larghezza', 'altezza', 'valore_dichiarato'])
const RIFERIMENTI = new Set(['corriere_id', 'corriere_estero_id'])

function ripulisci(p: any) {
  const out: any = {}
  for (const c of CAMPI) {
    if (!(c in p)) continue
    const v = p[c]
    if (NUMERICI.has(c)) {
      // La virgola decimale e' come la scrivono tutti, ed e' quella che esce da un foglio Excel
      // italiano: leggerla come "non numero" vorrebbe dire buttare via il peso.
      const n = parseFloat(String(v ?? '').replace(',', '.'))
      out[c] = isFinite(n) && n >= 0 ? n : null
      continue
    }
    const s = String(v ?? '').trim()
    // Un riferimento vuoto e' NULL, non stringa vuota: su una colonna uuid la stringa vuota esplode.
    out[c] = s === '' ? null : (RIFERIMENTI.has(c) ? s : s.slice(0, 500))
  }
  return out
}

export async function GET(req: NextRequest) {
  const ctx = await contesto()
  if (ctx instanceof NextResponse) return ctx
  const { supabase, admin, utente } = ctx
  const cliente = await clienteDiLavoro(supabase, admin, utente, req.nextUrl.searchParams.get('cliente_id'))
  if (!cliente) return NextResponse.json({ articoli: [], cliente: null })

  const cerca = (req.nextUrl.searchParams.get('cerca') || '').trim()
  let q = admin.from('articoli_cliente').select('*').eq('cliente_id', cliente.id).order('sku').limit(1000)
  if (cerca) {
    // Le virgole spezzerebbero la lista dei filtri di PostgREST: si tolgono prima di comporla.
    const t = cerca.replace(/[,()]/g, ' ').trim()
    if (t) q = q.or(`sku.ilike.%${t}%,nome.ilike.%${t}%,ean13.ilike.%${t}%`)
  }
  const { data } = await q
  return NextResponse.json({ articoli: data || [], cliente: cliente.id })
}

export async function POST(req: NextRequest) {
  const ctx = await contesto()
  if (ctx instanceof NextResponse) return ctx
  const { supabase, admin, utente } = ctx
  const _b = bloccaAgente(utente); if (_b) return _b        // agente = sola lettura

  const body = await req.json()
  const cliente = await clienteDiLavoro(supabase, admin, utente, body?.cliente_id || null)
  if (!cliente) return NextResponse.json({ error: 'Cliente non valido' }, { status: 400 })

  // Un articolo solo o un'importazione intera: stessa strada, cosi' le regole sono le stesse.
  const righe: any[] = Array.isArray(body?.articoli) ? body.articoli : [body]
  const validi: any[] = []
  let senzaSku = 0
  for (const r of righe) {
    const p = ripulisci(r)
    if (!p.sku) { senzaSku++; continue }
    if (!p.nome) p.nome = p.sku            // meglio un nome uguale allo SKU che una riga persa
    validi.push({ ...p, master_id: cliente.master_id, cliente_id: cliente.id })
  }
  if (!validi.length) return NextResponse.json({ error: 'Nessuna riga valida: manca lo SKU', senzaSku }, { status: 400 })

  // Lo SKU gia' in catalogo si AGGIORNA, non si duplica: e' cosi' che si ricarica il listino
  // quando cambiano i pesi. Il vincolo unico e' (cliente_id, sku), che e' esattamente la chiave.
  const { data, error } = await admin.from('articoli_cliente')
    .upsert(validi, { onConflict: 'cliente_id,sku', ignoreDuplicates: false }).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, salvati: (data || []).length, senzaSku })
}

export async function DELETE(req: NextRequest) {
  const ctx = await contesto()
  if (ctx instanceof NextResponse) return ctx
  const { supabase, admin, utente } = ctx
  const _b = bloccaAgente(utente); if (_b) return _b
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  const cliente = await clienteDiLavoro(supabase, admin, utente, req.nextUrl.searchParams.get('cliente_id'))
  if (!cliente) return NextResponse.json({ error: 'Cliente non valido' }, { status: 400 })
  // eq sul cliente: un id preso dal browser non basta a dire che l'articolo e' suo.
  const { error } = await admin.from('articoli_cliente').delete().eq('id', id).eq('cliente_id', cliente.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
