import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// INOLTRA il ticket al MASTER SUPERIORE di chi lo gestisce: il ticket resta UNICO, il master
// superiore entra nella catena (rete_master_ids) e vede tutta la conversazione; i suoi messaggi
// sono SEMPRE interni (visibilita 'rete') e il cliente non saprà mai dell'inoltro.
// Possono inoltrare: l'owner (assistenza diretta) e i master già in catena (escalation a salire).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const mio = utente?.master_id
  if (!mio || (utente?.ruolo || '').toLowerCase() === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: t } = await admin.from('tickets')
    .select('id,stato,owner_master_id,aperto_master_id,rete_master_ids,rete_non_letti')
    .eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
  if (t.stato === 'chiuso') return NextResponse.json({ error: 'Ticket chiuso: non inoltrabile.' }, { status: 400 })

  const rete: string[] = Array.isArray(t.rete_master_ids) ? t.rete_master_ids : []
  const inCatena = mio === t.owner_master_id || rete.includes(mio)
  if (!inCatena) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // Il master superiore di CHI inoltra (escalation a salire, un gradino alla volta).
  const { data: me } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', mio).maybeSingle()
  const padreId = me?.parent_master_id
  if (!padreId) return NextResponse.json({ error: 'Sei al vertice della rete: non c\'è un master superiore a cui inoltrare.' }, { status: 400 })
  if (padreId === t.owner_master_id || rete.includes(padreId) || padreId === t.aperto_master_id) {
    return NextResponse.json({ error: 'Il ticket è già stato inoltrato a quel master.' }, { status: 400 })
  }
  const { data: padre } = await admin.from('masters').select('nome').eq('id', padreId).maybeSingle()

  await admin.from('tickets').update({
    inoltrato_a_master_id: padreId,
    rete_master_ids: [...rete, padreId],
    rete_non_letti: Array.from(new Set([...(t.rete_non_letti || []).filter((x: string) => x !== mio), padreId])),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Traccia dell'inoltro nella chat: INTERNA, il cliente non la vede.
  await admin.from('ticket_messaggi').insert({
    ticket_id: id, autore: 'rete', autore_nome: 'Sistema', visibilita: 'rete', autore_master_id: mio,
    testo: `📤 Ticket inoltrato da ${me?.nome || 'master'} a ${padre?.nome || 'master superiore'}.`,
  })

  return NextResponse.json({ success: true, inoltrato_a: padre?.nome || null })
}
