import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { calendarioIcs, type VoceIcs } from '@/lib/calendario-ical'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// IL CALENDARIO PER GOOGLE E IPHONE (fase 2). Lo leggono i server di Google e di Apple, senza sessione: la chiave è il
// codice nel link (32 byte casuali), di cui il database tiene solo l'impronta. Link sconosciuto, disattivato o di un
// utente spento → 404, senza dire quale dei tre. Cosa esce lo decide lib/calendario-ical (solo il minimo, niente nomi).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: grezzo } = await params
  const token = String(grezzo || '').replace(/\.ics$/i, '')
  const nonTrovato = () => new NextResponse('Calendario non trovato', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return nonTrovato()
  const admin = createAdminSupabase()
  const hash = createHash('sha256').update(token).digest('hex')
  const { data: feed, error } = await admin.from('calendario_feed').select('utente_id,ultimo_uso').eq('token_hash', hash).maybeSingle()
  if (error) { console.error('[CALENDARIO-ICS] link non letto:', error.message); return new NextResponse('Riprova più tardi', { status: 503 }) }
  if (!feed) return nonTrovato()
  const { data: u } = await admin.from('utenti').select('attivo,cliente_id,masters(nome)').eq('id', feed.utente_id).maybeSingle()
  if (!u || (u as any).attivo === false) return nonTrovato()

  // le voci proprie (singole degli ultimi 90 giorni e in avanti, e le serie) e gli inviti non rifiutati
  const da = new Date(Date.now() - 90 * 86400000).toISOString()
  const COL = 'id,titolo,inizio,fine,tutto_il_giorno,luogo,ricorrenza,eccezioni,collegamento,aggiornato_il,creato_il'
  const [singole, serie, inviti] = await Promise.all([
    admin.from('calendario_eventi').select(COL).eq('utente_id', feed.utente_id).is('eliminato_il', null).is('ricorrenza', null).gte('inizio', da).limit(2000),
    admin.from('calendario_eventi').select(COL).eq('utente_id', feed.utente_id).is('eliminato_il', null).not('ricorrenza', 'is', null).limit(500),
    admin.from('calendario_inviti').select('evento_id').eq('utente_id', feed.utente_id).is('eliminato_il', null).neq('stato', 'rifiutato').limit(1000),
  ])
  if (singole.error || serie.error || inviti.error) {
    console.error('[CALENDARIO-ICS] voci non lette:', singole.error?.message || serie.error?.message || inviti.error?.message)
    return new NextResponse('Riprova più tardi', { status: 503 })
  }
  let invitate: any[] = []
  const ids = (inviti.data || []).map((i: any) => i.evento_id)
  if (ids.length) {
    const r = await admin.from('calendario_eventi').select(COL).in('id', ids).is('eliminato_il', null)
    if (r.error) { console.error('[CALENDARIO-ICS] voci degli inviti non lette:', r.error.message); return new NextResponse('Riprova più tardi', { status: 503 }) }
    // di una voce a cui si è invitati non esce la spedizione collegata (non è mia)
    invitate = (r.data || []).filter((e: any) => e.ricorrenza || e.inizio >= da).map((e: any) => ({ ...e, collegamento: null }))
  }
  const voci: VoceIcs[] = [...(singole.data || []), ...(serie.data || []), ...invitate].map((e: any) => ({
    id: e.id, titolo: e.titolo, inizio: e.inizio, fine: e.fine, tutto_il_giorno: !!e.tutto_il_giorno, luogo: e.luogo,
    ricorrenza: e.ricorrenza, eccezioni: e.eccezioni, collegamento: e.collegamento, aggiornato: e.aggiornato_il || e.creato_il,
  }))
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const nome = [(u as any).masters?.nome, 'Calendario'].filter(Boolean).join(' · ')
  const corpo = calendarioIcs(nome, voci, `${base}${(u as any).cliente_id ? '/cliente/calendario' : '/dashboard/calendario'}`)

  // l'ultimo uso, al massimo una scrittura l'ora (Google e l'iPhone lo rileggono spesso)
  if (!feed.ultimo_uso || Date.now() - new Date(feed.ultimo_uso).getTime() > 3600000) {
    await admin.from('calendario_feed').update({ ultimo_uso: new Date().toISOString() }).eq('utente_id', feed.utente_id)
  }
  return new NextResponse(corpo, {
    status: 200,
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="calendario.ics"', 'Cache-Control': 'private, max-age=300' },
  })
}
