import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { annullaSpedizioneSulCorriere, rimborsaAnnulloSpedizione, trovaOwnerContratto } from '@/lib/annullaSpedizione'

// Cancellazione LDV:
// - SPEDISCI ONLINE: annullo IMMEDIATO (niente 48h). Si prova ad annullare via API; se riesce
//   -> 'annullata' + storno a tutta la rete. Se NON riesce (tipico: contratto della rete, non
//   annullabile via API) -> 'annullamento_manuale' SUBITO, in coda al DETENTORE del contratto,
//   che la annulla su Spedisci col suo capo e poi conferma su Moove (storno a tutta la rete).
// - ALTRI CORRIERI (SpediamoPro): ATTESA 48h in 'annullamento_pending' (ripristinabile), poi il
//   cron /api/spedizioni/annullamenti-cron annulla via API + storno.
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,stato,corriere_id,raw_response,tracking_number,numero,dest_nome')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // ── Permessi (invariati): cliente = le proprie; master = le sue + quelle dei discendenti ──
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    const { data: cli } = await supabase.from('clienti').select('vieta_cancellazione').eq('id', sped.cliente_id).single()
    if (cli?.vieta_cancellazione === true) return NextResponse.json({ error: 'Cancellazione spedizioni non consentita per questo cliente.' }, { status: 403 })
  } else {
    let autorizzato = sped.master_id === utente?.master_id
    if (!autorizzato && utente?.master_id) {
      let cur: string | null = sped.master_id
      for (let i = 0; i < 20 && cur; i++) {
        const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        if (!m) break
        if (m.parent_master_id === utente.master_id) { autorizzato = true; break }
        cur = m.parent_master_id
      }
    }
    if (!autorizzato) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    if (sped.master_id === utente?.master_id) {
      const { data: mio } = await admin.from('masters').select('vieta_cancellazione').eq('id', utente.master_id).maybeSingle()
      if (mio?.vieta_cancellazione === true) return NextResponse.json({ error: 'Cancellazione spedizioni non consentita per questo account.' }, { status: 403 })
    }
  }

  // Idempotente: già annullata o già in attesa
  if (sped.stato === 'annullata') return NextResponse.json({ success: true, already: true })
  if (sped.stato === 'annullamento_pending') return NextResponse.json({ success: true, pending: true })
  if (sped.stato === 'annullamento_manuale') return NextResponse.json({ success: true, manuale: true })

  // ── SPEDISCI ONLINE: annullo IMMEDIATO (niente 48h) ──
  const { data: corr } = await admin.from('corrieri').select('tipo,nome_contratto,master_id').eq('id', (sped as any).corriere_id).maybeSingle()
  if (corr?.tipo === 'spedisci') {
    // 1) Provo l'annullo via API (funziona solo se il richiedente possiede davvero l'account Spedisci)
    const esito = await annullaSpedizioneSulCorriere(admin, sped as any)
    if (esito.ok) {
      await admin.from('spedizioni').update({
        stato: 'annullata', stato_precedente: sped.stato,
        annullamento_richiesto_at: new Date().toISOString(), annullamento_da: user.id, annullamento_errore: null,
      }).eq('id', spedizioneId)
      await rimborsaAnnulloSpedizione(admin, sped as any, user.id)
      return NextResponse.json({ success: true, annullata: true, message: 'Spedizione annullata e credito stornato a tutta la rete.' })
    }
    // 2) Non annullabile via API -> coda manuale del DETENTORE, SUBITO (niente attesa 48h).
    const ownerId = await trovaOwnerContratto(admin, corr.master_id, corr.nome_contratto)
    const { error: manErr } = await admin.from('spedizioni').update({
      stato: 'annullamento_manuale', stato_precedente: sped.stato, annullamento_owner_id: ownerId,
      annullamento_richiesto_at: new Date().toISOString(), annullamento_da: user.id, annullamento_errore: null,
    }).eq('id', spedizioneId)
    if (manErr) return NextResponse.json({ error: manErr.message }, { status: 400 })
    return NextResponse.json({ success: true, manuale: true, message: 'Richiesta di annullo inviata: la spedizione è in cancellazione. Verrà annullata dal detentore del contratto e il credito stornato a tutta la rete.' })
  }

  // ── ALTRI CORRIERI (SpediamoPro): ATTESA 48h (pending). Nessuna chiamata al corriere ora. ──
  const { error: updErr } = await admin.from('spedizioni').update({
    stato: 'annullamento_pending',
    stato_precedente: sped.stato,
    annullamento_richiesto_at: new Date().toISOString(),
    annullamento_da: user.id,
    annullamento_errore: null,
  }).eq('id', spedizioneId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  return NextResponse.json({ success: true, pending: true, message: 'Annullamento programmato: la spedizione resta in elenco come "In annullamento" e puoi ripristinarla. La richiesta verrà inviata al corriere tra 48 ore.' })
}
