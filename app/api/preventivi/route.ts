import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { attorePreventivi } from '@/lib/preventivo-attore'

// PREVENTIVI: lista + crea bozza + elimina. Il MASTER vede TUTTI i preventivi del suo master (compresi
// quelli dei suoi agenti, col tag agente). L'AGENTE vede e crea SOLO i propri (agente = suo nome), solo
// verso clienti. Perimetro in lib/preventivo-attore.
const staff = attorePreventivi

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  let q = admin.from('preventivi')
    .select('id,token,dest_tipo,dest_nome,dest_email,oggetto,stato,valido_fino,inviato_il,visto_il,accettato_il,created_at,cliente_id,master_target_id,agente')
    .eq('master_id', s.master_id)
  if (s.isAgente) q = q.eq('agente', s.agenteNome)   // l'agente vede solo i PROPRI preventivi
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const righe = data || []
  // Marca come SCADUTI i preventivi inviati/visti la cui validità è passata: prima lo stato 'scaduto'
  // non veniva mai scritto (si calcolava solo a video). Aggiornamento pigro, alla lettura della lista.
  const oggi = new Date().toISOString().slice(0, 10)
  const daScadere = righe.filter((r: any) => (r.stato === 'inviato' || r.stato === 'visto') && r.valido_fino && String(r.valido_fino) < oggi).map((r: any) => r.id)
  if (daScadere.length) {
    await admin.from('preventivi').update({ stato: 'scaduto', updated_at: new Date().toISOString() }).in('id', daScadere)
    for (const r of righe) if (daScadere.includes(r.id)) r.stato = 'scaduto'
  }
  // Split come chiesto: destinatari clienti vs sotto-master. isAgente serve alla lista per nascondere
  // la sezione sotto-master (l'agente non ne fa mai) e adattare i testi.
  return NextResponse.json({
    clienti: righe.filter((r: any) => !String(r.dest_tipo || '').startsWith('master')),
    master: righe.filter((r: any) => String(r.dest_tipo || '').startsWith('master')),
    isAgente: s.isAgente,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  let dest_tipo = ['cliente_nuovo', 'cliente', 'master', 'master_nuovo'].includes(b.dest_tipo) ? b.dest_tipo : 'cliente_nuovo'
  // L'AGENTE fa preventivi solo verso CLIENTI (mai sotto-master) e li marca col proprio nome.
  if (s.isAgente && dest_tipo !== 'cliente') dest_tipo = 'cliente_nuovo'
  const { data, error } = await admin.from('preventivi').insert({
    master_id: s.master_id,
    dest_tipo,
    cliente_id: dest_tipo === 'cliente' ? (b.cliente_id || null) : null,
    master_target_id: dest_tipo === 'master' ? (b.master_target_id || null) : null,
    dest_nome: b.dest_nome ? String(b.dest_nome).slice(0, 200) : null,
    dest_email: b.dest_email ? String(b.dest_email).slice(0, 200).trim() : null,
    oggetto: (b.oggetto ? String(b.oggetto).slice(0, 300) : 'Preventivo').trim(),
    agente: s.isAgente ? s.agenteNome : null,
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
  // Solo un preventivo del MIO master (e, se agente, SOLO i suoi), e solo se non gia' accettato.
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato,listino_template_id,agente').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id || (s.isAgente && p.agente !== s.agenteNome)) return NextResponse.json({ error: 'Non trovato' }, { status: 403 })
  if (p.stato === 'accettato') return NextResponse.json({ error: 'Un preventivo accettato non si elimina (ha creato un listino).' }, { status: 400 })
  const { error } = await admin.from('preventivi').delete().eq('id', id).eq('master_id', s.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // La bozza-listino collegata scende col preventivo. La si cancella per BACK-LINK autorevole
  // (listini_clienti.preventivo_id), NON per il puntatore listino_template_id — che può essere NULL o
  // stale se 'crea_listino' si è interrotto fra l'insert della bozza e la scrittura del puntatore,
  // lasciando bozze orfane. Il filtro preventivo_id=id non tocca mai un listino reale (che ha NULL).
  await admin.from('listini_clienti').delete().eq('preventivo_id', id)
  return NextResponse.json({ ok: true })
}
