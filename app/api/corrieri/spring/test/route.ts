import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICA connessione Spring — SOLO IL PROPRIETARIO del contratto.
//
// Una lettura sola, nessuna spedizione: i servizi attivi sull'account (GetServices). Basta a dire se la chiave
// e' buona, se il servizio scelto nel contratto e' attivo e se l'ambiente e' quello giusto.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Utente senza master' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const corriereId = String(body?.corriereId || '')
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })

  // Proprieta' col client dell'utente (RLS), SENZA credenziali: la colonna non e' leggibile da
  // 'authenticated' e un select che la nomina farebbe fallire l'intera query.
  const { data: c } = await supabase.from('corrieri')
    .select('id,settings')
    .eq('id', corriereId).eq('master_id', utente.master_id).eq('proprio', true).eq('tipo', 'spring')
    .maybeSingle()
  if (!c) return NextResponse.json({ error: 'Contratto Spring non trovato o non di tua proprietà' }, { status: 403 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { data: credRow } = await createAdminSupabase().from('corrieri').select('credenziali').eq('id', corriereId).maybeSingle()
  const cr: any = (credRow as any)?.credenziali || {}
  if (!cr.api_key) return NextResponse.json({ error: 'Chiave API non inserita nel contratto.' }, { status: 400 })

  const { serviziSpring, springInProva, NOMI_AMBITO } = await import('@/lib/spring')
  const cred = { api_key: String(cr.api_key), ambiente: String(cr.ambiente || '') }
  const st: any = (c as any)?.settings || {}
  const servizioContratto = String(st.spring_servizio || '')
  try {
    const srv = await serviziSpring(cred)
    return NextResponse.json({
      ok: true,
      inProva: springInProva(cred),
      ambito: (NOMI_AMBITO as any)[String(st.spring_ambito || '')] || null,
      servizioContratto,
      descrizioneServizio: srv.elenco[servizioContratto] || null,
      servizioAttivo: srv.consentiti.includes(servizioContratto),
      servizi: srv.consentiti.map((k) => (srv.elenco[k] ? `${k} (${srv.elenco[k]})` : k)),
      springClear: srv.springClear,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Verifica non riuscita' }, { status: 200 })
  }
}
