import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 45

// ── MOOVY VOICE — esecuzione azione CONFERMATA ───────────────────────────
// Riceve la pendingAction confermata dall'utente (conferma vocale + pulsante).
// Ri-valida lato server e riusa gli ENDPOINT esistenti (inoltrando i cookie di sessione),
// così valgono ESATTAMENTE gli stessi permessi/logiche (niente logica duplicata).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const a = body?.pendingAction
  if (!a?.azione) return NextResponse.json({ error: 'Azione mancante' }, { status: 400 })

  const origin = new URL(req.url).origin
  const cookie = req.headers.get('cookie') || ''
  const inoltra = (path: string, init: RequestInit) => fetch(origin + path, { ...init, headers: { ...(init.headers || {}), cookie } })

  try {
    if (a.azione === 'ricarica_credito') {
      const importo = Math.round((Number(a.importo) || 0) * 100) / 100
      if (!(importo > 0) || !a.targetId) return NextResponse.json({ error: 'Dati ricarica non validi' }, { status: 400 })
      const clienteId = a.targetTipo === 'master' ? 'm:' + a.targetId : a.targetId
      const r = await inoltra('/api/movimenti/crea', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, tipo: 'ricarica', importo, descrizione: `Ricarica via Moovy (assistente vocale)` }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) return NextResponse.json({ reply: `Non sono riuscito: ${d.error || 'errore'}.` }, { status: 200 })
      return NextResponse.json({ reply: `Fatto! Ho ricaricato € ${importo.toFixed(2)} a ${a.targetNome}.`, ok: true })
    }

    if (a.azione === 'elimina_spedizione') {
      if (!a.spedizioneId) return NextResponse.json({ error: 'Spedizione mancante' }, { status: 400 })
      const r = await inoltra(`/api/spedizioni/elimina?id=${encodeURIComponent(a.spedizioneId)}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || (!d.success && !d.already)) return NextResponse.json({ reply: `Non sono riuscito a eliminare: ${d.error || 'errore'}.` }, { status: 200 })
      return NextResponse.json({ reply: d.message || `Spedizione ${a.numero || ''} avviata all'eliminazione.`, ok: true })
    }

    return NextResponse.json({ error: 'Azione sconosciuta' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ reply: 'Ho avuto un problema tecnico eseguendo l\'azione.' }, { status: 200 })
  }
}
