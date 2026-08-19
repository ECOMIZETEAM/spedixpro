import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// Singolo preventivo: GET (con il branding del master per l'anteprima) + PATCH (dettagli + contenuto).
// Il contenuto e' un jsonb flessibile: { sezioni: [{id,tipo,titolo,testo}], corrieri: [{corriere_id,nome,markup,righe}] }.

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('*').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  // Branding del master per l'anteprima (logo, nome, colori). Vive su masters.
  const { data: m } = await admin.from('masters').select('nome,logo_url,colore_primario,colore_secondario,email,telefono,indirizzo,citta,cap,provincia,pec,partita_iva,piva').eq('id', s.master_id).maybeSingle()
  return NextResponse.json({ preventivo: p, branding: m || {} })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  if (p.stato === 'accettato') return NextResponse.json({ error: 'Un preventivo accettato non si modifica.' }, { status: 400 })

  const b = await req.json().catch(() => ({}))
  const patch: any = { updated_at: new Date().toISOString() }
  if (b.dest_tipo && ['cliente_nuovo', 'cliente', 'master'].includes(b.dest_tipo)) patch.dest_tipo = b.dest_tipo
  if (b.dest_nome !== undefined) patch.dest_nome = b.dest_nome ? String(b.dest_nome).slice(0, 200) : null
  if (b.dest_email !== undefined) patch.dest_email = b.dest_email ? String(b.dest_email).slice(0, 200).trim() : null
  if (b.cliente_id !== undefined) patch.cliente_id = b.cliente_id || null
  if (b.master_target_id !== undefined) patch.master_target_id = b.master_target_id || null
  if (b.oggetto !== undefined) patch.oggetto = b.oggetto ? String(b.oggetto).slice(0, 300) : null
  if (b.valido_fino !== undefined) patch.valido_fino = b.valido_fino || null
  if (b.contenuto !== undefined && b.contenuto && typeof b.contenuto === 'object') patch.contenuto = b.contenuto

  const { error } = await admin.from('preventivi').update(patch).eq('id', id).eq('master_id', s.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
