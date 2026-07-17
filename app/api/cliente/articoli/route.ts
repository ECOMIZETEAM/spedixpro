import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Catalogo articoli del cliente: SKU -> peso (+ misure opzionali). Usato in Importa Ordini per
// applicare in automatico il peso (e le misure se presenti) in base allo SKU dell'ordine.
async function getCliente(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  return utente?.cliente_id ? utente : null
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const u = await getCliente(supabase)
  if (!u) return NextResponse.json([])
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  let query = supabase.from('articoli_cliente').select('*').eq('cliente_id', u.cliente_id).order('sku', { ascending: true })
  const { data } = await query
  let out = data || []
  if (q) out = out.filter((a: any) => (a.sku || '').toLowerCase().includes(q) || (a.nome || '').toLowerCase().includes(q))
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const u = await getCliente(supabase)
  if (!u) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const b = await req.json()
  const sku = String(b.sku || '').trim()
  if (!sku) return NextResponse.json({ error: 'SKU obbligatorio' }, { status: 400 })
  const record = {
    cliente_id: u.cliente_id, master_id: u.master_id,
    sku, nome: b.nome ? String(b.nome).trim() : null,
    peso: Number(b.peso) || 0,
    lunghezza: Number(b.lunghezza) || 0, larghezza: Number(b.larghezza) || 0, altezza: Number(b.altezza) || 0,
    updated_at: new Date().toISOString(),
  }
  if (b.id) {
    const { error } = await supabase.from('articoli_cliente').update(record).eq('id', b.id).eq('cliente_id', u.cliente_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    // upsert per (cliente, sku): se lo SKU esiste, aggiorno
    const { error } = await supabase.from('articoli_cliente').upsert(record, { onConflict: 'cliente_id,sku', ignoreDuplicates: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const u = await getCliente(supabase)
  if (!u) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  const tutti = req.nextUrl.searchParams.get('tutti') === '1'
  if (tutti) {
    const { error } = await supabase.from('articoli_cliente').delete().eq('cliente_id', u.cliente_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { error } = await supabase.from('articoli_cliente').delete().eq('id', id).eq('cliente_id', u.cliente_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
