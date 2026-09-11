import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

// Rubrica destinatari del cliente: elenco / aggiunta manuale / eliminazione.
// La tabella rubrica_destinatari nega anon/authenticated: si passa dall'admin (service_role) e si
// restringe QUI a mano al cliente loggato (stesso schema degli altri percorsi del portale cliente).
async function cliente(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('ruolo,cliente_id,master_id').eq('id', user.id).single()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) return { err: NextResponse.json({ error: 'Solo i clienti' }, { status: 403 }) }
  return { u }
}

// GET /api/cliente/rubrica?q=&limit=&offset=
export async function GET(req: NextRequest) {
  const { u, err } = await cliente(req); if (err) return err
  const admin = createAdminSupabase()
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100))
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0)
  let query = admin.from('rubrica_destinatari')
    .select('id,nome,indirizzo,citta,provincia,cap,paese,telefono,email,note', { count: 'exact' })
    .eq('cliente_id', u!.cliente_id)
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1)
  if (q) query = query.or(`nome.ilike.%${q}%,citta.ilike.%${q}%,cap.ilike.%${q}%,indirizzo.ilike.%${q}%`)
  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ righe: data || [], totale: count ?? (data?.length || 0) })
}

// POST /api/cliente/rubrica  { id?, nome, indirizzo, citta, provincia, cap, paese, telefono, email, note }
export async function POST(req: NextRequest) {
  const { u, err } = await cliente(req); if (err) return err
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  const nome = String(b?.nome || '').trim()
  if (!nome) return NextResponse.json({ error: 'Il nominativo è obbligatorio' }, { status: 400 })
  const rec: any = {
    cliente_id: u!.cliente_id,
    master_id: u!.master_id,
    nome: nome.slice(0, 120),
    indirizzo: String(b?.indirizzo || '').trim().slice(0, 200),
    citta: String(b?.citta || '').trim().slice(0, 80),
    provincia: String(b?.provincia || '').trim().slice(0, 2).toUpperCase(),
    cap: String(b?.cap || '').replace(/\s+/g, '').slice(0, 10),
    paese: (String(b?.paese || '').trim() || 'IT').slice(0, 40),
    telefono: String(b?.telefono || '').trim().slice(0, 40),
    email: String(b?.email || '').trim().slice(0, 120),
    note: String(b?.note || '').trim().slice(0, 200),
    updated_at: new Date().toISOString(),
  }
  // Modifica di una riga esistente (verificando che sia del cliente) o inserimento nuovo.
  if (b?.id) {
    const { data, error } = await admin.from('rubrica_destinatari').update(rec).eq('id', b.id).eq('cliente_id', u!.cliente_id).select('id').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })
    return NextResponse.json({ ok: true, id: data.id })
  }
  // Upsert sulla chiave, così un duplicato aggiorna invece di fallire.
  const { data, error } = await admin.from('rubrica_destinatari').upsert(rec, { onConflict: 'cliente_id,nome,indirizzo,cap', ignoreDuplicates: false }).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data?.id })
}

// DELETE /api/cliente/rubrica?id=...
export async function DELETE(req: NextRequest) {
  const { u, err } = await cliente(req); if (err) return err
  const admin = createAdminSupabase()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  const { error } = await admin.from('rubrica_destinatari').delete().eq('id', id).eq('cliente_id', u!.cliente_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
