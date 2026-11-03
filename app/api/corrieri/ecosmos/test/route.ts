import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICA connessione Ecosmos — SOLO IL PROPRIETARIO del contratto.
//
// Solo letture, nessuna spedizione: la chiave (ping), i servizi con orario limite e fasce di peso, e la
// copertura di un CAP del centro di Roma. Il ping restituisce la ragione sociale dell'account: e' cosi'
// che ci si accorge subito di aver incollato la chiave di un altro cliente Ecosmos, che altrimenti si
// scoprirebbe solo a spedizioni gia' fatturate al cliente sbagliato.
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
    .eq('id', corriereId).eq('master_id', utente.master_id).eq('proprio', true).eq('tipo', 'ecosmos')
    .maybeSingle()
  if (!c) return NextResponse.json({ error: 'Contratto Ecosmos non trovato o non di tua proprietà' }, { status: 403 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { data: credRow } = await createAdminSupabase().from('corrieri').select('credenziali').eq('id', corriereId).maybeSingle()
  const apiKey = String((credRow as any)?.credenziali?.api_key || '')
  if (!apiKey) return NextResponse.json({ error: 'Chiave API non inserita nel contratto.' }, { status: 400 })

  const { pingEcosmos, serviziEcosmos, coperturaEcosmos } = await import('@/lib/ecosmos')
  const cred = { api_key: apiKey }
  const servizioContratto = String((c as any)?.settings?.servizio || 'express_24h')
  try {
    const ping = await pingEcosmos(cred)
    const srv = await serviziEcosmos(cred)
    const cop = await coperturaEcosmos(cred, '00184')
    return NextResponse.json({
      ok: true,
      account: ping.account, ambiente: ping.ambiente, richiedeConferma: ping.richiedeConferma,
      servizi: srv.servizi.map((s) => s.code), servizioContratto,
      servizioAttivo: srv.servizi.some((s) => s.code === servizioContratto),
      orarioLimite: srv.orarioLimite, contrassegno: srv.contrassegno, pesoMassimo: srv.pesoMassimo, fasce: srv.fasce,
      coperturaRoma: { cap: '00184', servito: cop.servito, servizi: cop.servizi },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Verifica non riuscita' }, { status: 200 })
  }
}
