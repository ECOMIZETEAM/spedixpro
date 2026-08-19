import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { leggiGrigliaListino } from '@/lib/preventivo-prezzi'

// PAGINA PUBBLICA PREVENTIVO (senza login, per token — come il tracking). Lettura via service_role.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get('t') || '').trim()
  if (!/^[a-f0-9]{20,40}$/.test(token)) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi')
    .select('id,master_id,oggetto,dest_nome,valido_fino,stato,contenuto,listino_template_id,accettato_il')
    .eq('token', token).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })

  const { data: m } = await admin.from('masters').select('nome,logo_url,colore_primario,colore_secondario,email,telefono').eq('id', p.master_id).maybeSingle()
  const prezzi = await leggiGrigliaListino(admin, p.listino_template_id)

  // Prima apertura da parte del destinatario: 'inviato' -> 'visto' (informativo per il master).
  if (p.stato === 'inviato') { try { await admin.from('preventivi').update({ stato: 'visto', visto_il: new Date().toISOString() }).eq('id', p.id) } catch {} }

  const scaduto = p.valido_fino ? new Date(p.valido_fino) < new Date(new Date().toDateString()) : false
  return NextResponse.json({
    oggetto: p.oggetto, dest_nome: p.dest_nome, valido_fino: p.valido_fino,
    stato: p.stato === 'inviato' ? 'visto' : p.stato, scaduto,
    sezioni: Array.isArray(p.contenuto?.sezioni) ? p.contenuto.sezioni : [],
    prezzi,
    branding: { nome: m?.nome || 'Preventivo', logo_url: m?.logo_url || null, colore_primario: m?.colore_primario || '#f97316', colore_secondario: m?.colore_secondario || '#1a1a1a', email: m?.email || null, telefono: m?.telefono || null },
  })
}
