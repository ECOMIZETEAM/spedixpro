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
    .select('id,master_id,cliente_id,stato,corriere_id,raw_response,tracking_number,numero,dest_nome,created_at,distinta_id')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // ── Permessi: cliente = le proprie; master = le sue + quelle dei discendenti ──
  // (Il blocco "vieta_cancellazione" è stato RIMOSSO: non serve più, vale la regola 48h di SpediamoPro.)
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
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
  }

  // UN PACCO CONSEGNATO NON SI ANNULLA. Sembra ovvio e invece non era scritto da nessuna parte:
  // la cancellazione passava, e 48 ore dopo il cron rimborsava cliente e catena per merce che il
  // destinatario aveva gia' in casa. Sul circuito interno e' immediato — l'autista consegna e
  // segna, e il giorno dopo si clicca il cestino — ma vale per qualsiasi corriere.
  if (sped.stato === 'consegnata') {
    return NextResponse.json({ error: 'La spedizione risulta consegnata: non può essere annullata. Se il pacco è tornato indietro usa il reso.' }, { status: 400 })
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

  // ── CONTRATTI DVA: il corriere non ha proprio una chiamata di annullo. Metterli in attesa 48h
  //    sarebbe solo tempo perso e una promessa falsa: dopo due giorni si scoprirebbe comunque che
  //    va fatto a mano. Vanno subito in coda al detentore del contratto, come per l'altro caso
  //    non annullabile via API, con un messaggio che dice come stanno le cose. ──
  if (corr?.tipo === 'easyparcel') {
    const ownerId = await trovaOwnerContratto(admin, corr.master_id, corr.nome_contratto)
    const { error: manErr } = await admin.from('spedizioni').update({
      stato: 'annullamento_manuale', stato_precedente: sped.stato, annullamento_owner_id: ownerId,
      annullamento_richiesto_at: new Date().toISOString(), annullamento_da: user.id, annullamento_errore: null,
    }).eq('id', spedizioneId)
    if (manErr) return NextResponse.json({ error: manErr.message }, { status: 400 })
    return NextResponse.json({ success: true, manuale: true, message: 'Richiesta di annullo inviata: questo corriere non consente la cancellazione automatica, quindi verrà annullata dal detentore del contratto e il credito stornato a tutta la rete.' })
  }

  // ── GLS / BRT DIRETTI: annullo IMMEDIATO, mai la coda 48h. ──
  // GLS è "attesa-chiusura": PRIMA della chiusura distinta (confermata_vettore) la spedizione NON è ancora
  // trasmessa a GLS, quindi si annulla in sicurezza (DeleteSped) e si rimborsa; DOPO la chiusura GLS
  // consegna il pacco → non si annulla a vuoto. BRT AUTO-CONFERMA alla creazione, annullabile solo subito
  // (retry sul -153); poco dopo risponde "già spedita". Prima cadevano nel ramo 48h generico: il cron
  // tentava l'annullo due giorni dopo — BRT diceva "già spedita" (l'utente aspettava 2 giorni per un
  // rifiuto, pacco già partito) e la GLS, ormai in distinta, veniva marcata annullata e RIMBORSATA a tutta
  // la catena mentre GLS la consegnava. Ora si tenta subito, nella finestra in cui l'annullo vale davvero.
  if (corr?.tipo === 'gls' || corr?.tipo === 'brt') {
    // "Trasmessa a GLS" = la sua DISTINTA e' confermata_vettore (il flag vive sulla distinta, NON sulla
    // spedizione). Lo leggo qui e lo attacco a `sped`, cosi' vale anche la guardia in annullaSpedizione.
    if (corr.tipo === 'gls' && (sped as any).distinta_id) {
      const { data: dist } = await admin.from('distinte').select('confermata_vettore').eq('id', (sped as any).distinta_id).maybeSingle()
      ;(sped as any).confermata_vettore = !!dist?.confermata_vettore
      if ((sped as any).confermata_vettore) {
        const msg = 'Spedizione GLS già trasmessa al corriere (distinta confermata): non è più annullabile in automatico. Va gestita direttamente col corriere.'
        await admin.from('spedizioni').update({ annullamento_errore: msg }).eq('id', spedizioneId)
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }
    const esito = await annullaSpedizioneSulCorriere(admin, sped as any)
    if (esito.ok) {
      await admin.from('spedizioni').update({
        stato: 'annullata', stato_precedente: sped.stato,
        annullamento_richiesto_at: new Date().toISOString(), annullamento_da: user.id, annullamento_errore: null,
      }).eq('id', spedizioneId)
      await rimborsaAnnulloSpedizione(admin, sped as any, user.id)
      return NextResponse.json({ success: true, annullata: true, message: 'Spedizione annullata e credito stornato a tutta la rete.' })
    }
    // Non annullabile ORA (BRT ancora "in processing"/già spedita, o GLS che non conferma): niente rimborso
    // a vuoto e niente attesa 48h. Resta valida, con l'errore in chiaro; l'utente può riprovare a breve.
    const msg = `Annullo non riuscito: ${esito.reason || 'il corriere non consente la cancellazione (spedizione già in lavorazione)'}. La spedizione resta valida.`
    await admin.from('spedizioni').update({ annullamento_errore: msg }).eq('id', spedizioneId)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // ── SpediamoPro oltre 15 giorni: il corriere NON annulla più (limite fisso di Poste, mostrato
  //    anche dal pannello SpediamoPro). Aspettare 48h per un rifiuto certo — e poi vederla "tornare
  //    disponibile" — confonde e basta, e la coda manuale sarebbe una promessa falsa (nemmeno a mano
  //    si annulla). Lo diciamo SUBITO e lo scriviamo sulla spedizione, che resta valida. ──
  if (corr?.tipo === 'spediamopro' && (sped as any).created_at &&
      new Date((sped as any).created_at).getTime() < Date.now() - 15 * 24 * 60 * 60 * 1000) {
    const msg = 'Non annullabile: sono passati più di 15 giorni dalla creazione — il corriere non consente più l\'annullo.'
    await admin.from('spedizioni').update({ annullamento_errore: msg }).eq('id', spedizioneId)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // ── ALTRI CORRIERI (SpediamoPro entro i 15 giorni): ATTESA 48h (pending). Nessuna chiamata ora. ──
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
