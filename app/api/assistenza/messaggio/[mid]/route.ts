import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { partecipanteTicket as partecipante } from '@/lib/ticket-accesso'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// Gestione di un SINGOLO messaggio della chat, stile WhatsApp: modifica (PATCH) ed elimina (DELETE).
// Regola: solo l'AUTORE puo' toccare i PROPRI messaggi, e solo se partecipa ancora al ticket.
// Elimina = SOFT: la riga resta (storico), testo svuotato + allegati rimossi (anche dallo storage),
// eliminato_il valorizzato -> in chat compare "messaggio eliminato". Modifica -> modificato_il.
async function ctx(mid: string) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('ticket_messaggi')
    .select('id,ticket_id,autore_id,allegati,eliminato_il').eq('id', mid).maybeSingle()
  if (!m) return { err: NextResponse.json({ error: 'Messaggio non trovato' }, { status: 404 }) }
  // Solo i PROPRI messaggi (autore_id deve combaciare: i vecchi senza autore_id non sono modificabili).
  if (!m.autore_id || m.autore_id !== user.id) {
    return { err: NextResponse.json({ error: 'Puoi modificare o eliminare solo i tuoi messaggi.' }, { status: 403 }) }
  }
  const { data: t } = await admin.from('tickets')
    .select('id,stato,cliente_id,owner_master_id,aperto_master_id,tipo_apertura,rete_master_ids,inoltrato_a_master_id')
    .eq('id', m.ticket_id).maybeSingle()
  if (!t || !(await partecipante(utente, t))) {
    return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  }
  return { admin, m }
}

// PATCH: modifica il testo del proprio messaggio.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ mid: string }> }) {
  const { mid } = await params
  const c = await ctx(mid); if ('err' in c) return c.err
  if (c.m.eliminato_il) return NextResponse.json({ error: 'Il messaggio è stato eliminato.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const testo = String(body?.testo || '').trim()
  const haAllegati = Array.isArray(c.m.allegati) && c.m.allegati.length > 0
  if (!testo && !haAllegati) return NextResponse.json({ error: 'Il messaggio non può restare vuoto.' }, { status: 400 })
  const { error } = await c.admin.from('ticket_messaggi')
    .update({ testo, modificato_il: new Date().toISOString() }).eq('id', mid)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

// DELETE: elimina per tutti (soft). Svuota testo/allegati e rimuove i file dallo storage.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ mid: string }> }) {
  const { mid } = await params
  const c = await ctx(mid); if ('err' in c) return c.err
  if (c.m.eliminato_il) return NextResponse.json({ success: true })   // già eliminato: idempotente
  try {
    const paths = (Array.isArray(c.m.allegati) ? c.m.allegati : []).map((a: any) => a?.url).filter(Boolean)
    if (paths.length) await c.admin.storage.from(BUCKET_RISERVATI).remove(paths)
  } catch { /* best-effort: se lo storage non risponde, il messaggio resta comunque eliminato */ }
  const { error } = await c.admin.from('ticket_messaggi')
    .update({ testo: '', allegati: null, eliminato_il: new Date().toISOString() }).eq('id', mid)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
