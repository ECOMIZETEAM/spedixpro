import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { occorrenze } from '@/lib/calendario-ricorrenza'

// UNA SOLA OCCORRENZA di una voce che si ripete (fase 2): «togli solo questa» (eccezioni), «fatto» e «di nuovo da
// fare» per un promemoria che si ripete (fatti). Solo sulle voci proprie (utente_id = sessione). Il giorno deve essere
// davvero un'occorrenza della serie: una data inventata non entra nella riga.
const AZIONI = new Set(['salta', 'fatto', 'da_fare'])

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const id = String(b?.id || ''), giorno = String(b?.giorno || ''), azione = String(b?.azione || '')
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(giorno) || !AZIONI.has(azione)) return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: e, error } = await admin.from('calendario_eventi').select('id,tipo,inizio,fine,tutto_il_giorno,ricorrenza,eccezioni,fatti')
    .eq('id', id).eq('utente_id', user.id).is('eliminato_il', null).maybeSingle()
  if (error) return NextResponse.json({ error: 'Lettura non riuscita: ' + error.message }, { status: 500 })
  if (!e || !e.ricorrenza) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  // il giorno è un'occorrenza della serie? (senza contare le eccezioni: «salta» di un giorno già saltato non fa danni)
  const centro = new Date(giorno + 'T12:00:00Z')
  const vere = occorrenze({ ...e, eccezioni: [] }, new Date(centro.getTime() - 2 * 86400000), new Date(centro.getTime() + 2 * 86400000))
  if (!vere.some((o) => o.giorno === giorno)) return NextResponse.json({ error: 'Quel giorno la voce non c’è' }, { status: 400 })
  if (azione !== 'salta' && e.tipo !== 'promemoria') return NextResponse.json({ error: 'Solo i promemoria si segnano fatti' }, { status: 400 })
  const eccezioni = new Set<string>(e.eccezioni || []), fatti = new Set<string>(e.fatti || [])
  if (azione === 'salta') eccezioni.add(giorno)
  if (azione === 'fatto') fatti.add(giorno)
  if (azione === 'da_fare') fatti.delete(giorno)
  const { error: e2 } = await admin.from('calendario_eventi')
    .update({ eccezioni: [...eccezioni].sort(), fatti: [...fatti].sort(), aggiornato_il: new Date().toISOString() })
    .eq('id', id).eq('utente_id', user.id)
  if (e2) return NextResponse.json({ error: 'Salvataggio non riuscito: ' + e2.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
