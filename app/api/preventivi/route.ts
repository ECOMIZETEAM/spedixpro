import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// PREVENTIVI (Fase 1): lista dei preventivi del master (clienti e sotto-master separati) + crea bozza +
// elimina. L'editor, l'invio email, la pagina pubblica e l'accetta→listino arrivano nelle fasi dopo.
// Ogni master vede SOLO i propri preventivi (master_id esatto).

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { data, error } = await admin.from('preventivi')
    .select('id,token,dest_tipo,dest_nome,dest_email,oggetto,stato,valido_fino,inviato_il,visto_il,accettato_il,created_at,cliente_id,master_target_id')
    .eq('master_id', s.master_id).order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const righe = data || []
  // Split come chiesto: destinatari clienti vs sotto-master.
  return NextResponse.json({
    clienti: righe.filter((r: any) => !String(r.dest_tipo || '').startsWith('master')),
    master: righe.filter((r: any) => String(r.dest_tipo || '').startsWith('master')),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  const dest_tipo = ['cliente_nuovo', 'cliente', 'master', 'master_nuovo'].includes(b.dest_tipo) ? b.dest_tipo : 'cliente_nuovo'
  const { data, error } = await admin.from('preventivi').insert({
    master_id: s.master_id,
    dest_tipo,
    cliente_id: dest_tipo === 'cliente' ? (b.cliente_id || null) : null,
    master_target_id: dest_tipo === 'master' ? (b.master_target_id || null) : null,
    dest_nome: b.dest_nome ? String(b.dest_nome).slice(0, 200) : null,
    dest_email: b.dest_email ? String(b.dest_email).slice(0, 200).trim() : null,
    oggetto: (b.oggetto ? String(b.oggetto).slice(0, 300) : 'Preventivo').trim(),
    created_by: s.user.id,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  // Solo un preventivo del MIO master, e solo se non gia' accettato (lo storico dell'accettato resta).
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id) return NextResponse.json({ error: 'Non trovato' }, { status: 403 })
  if (p.stato === 'accettato') return NextResponse.json({ error: 'Un preventivo accettato non si elimina (ha creato un listino).' }, { status: 400 })
  const { error } = await admin.from('preventivi').delete().eq('id', id).eq('master_id', s.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
