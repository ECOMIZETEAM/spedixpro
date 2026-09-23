// COMPLETAMENTO DELLE SPEDIZIONI FERME SU UN NUMERO PROVVISORIO (DVA).
//
// Sui contratti DVA la lettera di vettura non arriva insieme all'ordine: l'ordine si paga, e il
// numero con le etichette si va a prendere dopo. Se in quel momento non c'e' ancora, la spedizione
// viene salvata con un numero provvisorio "TMP-<ordine>" e va completata piu' tardi.
//
// Questa funzione fa SOLO quello, su una spedizione sola o su un lotto. Sta qui, e non dentro una
// rotta, perche' la chiamano in tre: il giro veloce ogni 2 minuti, il giro grosso da 15 minuti (rete
// di sicurezza) e il pulsante "Riprova adesso" del cliente. La regola di quando e come si scrive il
// numero deve esistere in un posto solo: e' l'identita' della spedizione, sta nei movimenti, nelle
// distinte e sull'etichetta gia' stampata.
//
// MISURATO IL 23/09/2026, ed e' il motivo del giro veloce: DVA aveva gia' la lettera di vettura di 4
// spedizioni create 30 minuti prima, e il giro da 15 minuti le ha prese solo alle 16:15 — fino a un
// quarto d'ora di attesa in piu' messa da NOI, sopra a quella (piu' lunga) del fornitore.

export type EsitoTmp = {
  esaminate: number
  completate: number      // numero provvisorio sostituito con la LDV vera
  soloEtichette: number   // etichette recuperate, la LDV non c'e' ancora
  ancoraNulla: number     // il fornitore non ha ancora niente
  saltate: number         // non e' un contratto che produce numeri provvisori
}

export async function completaTmp(
  admin: any,
  opts: { limite?: number; spedizioneId?: string; giorni?: number } = {},
): Promise<EsitoTmp> {
  const esito: EsitoTmp = { esaminate: 0, completate: 0, soloEtichette: 0, ancoraNulla: 0, saltate: 0 }

  let q = admin.from('spedizioni')
    .select('id,numero,colli,corriere_id,stato,colli_dettaglio,created_at,dest_nome,corrieri(tipo,credenziali)')
    .like('numero', 'TMP-%')
    // UNA SPEDIZIONE IN CODA DI ANNULLO MANUALE E' ANCORA VIVA PRESSO IL FORNITORE, e va completata
    // come le altre: senza il numero vero nemmeno i suoi movimenti verrebbero risistemati, e chi deve
    // chiedere l'annullo non avrebbe una lettera di vettura da citare.
    .not('stato', 'in', '(annullata)')

  if (opts.spedizioneId) {
    q = q.eq('id', opts.spedizioneId)
  } else {
    // Oltre una settimana la lettera di vettura non arriva piu': quella spedizione va guardata a
    // mano, non ritentata all'infinito. Il limite tiene anche la ricerca leggera su una tabella che
    // cresce di 1.500 righe al giorno.
    q = q.gte('created_at', new Date(Date.now() - (opts.giorni ?? 7) * 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(opts.limite ?? 50)
  }

  const { data: ferme } = await q
  esito.esaminate = (ferme || []).length
  if (!esito.esaminate) return esito

  const { easyparcelWaybillGrezza, unisciEtichette } = await import('@/lib/easyparcel')

  for (const s of (ferme || [])) {
    const corr: any = (s as any).corrieri
    // Il numero provvisorio nasce solo sul ramo DVA: su qualsiasi altro tipo non si tocca niente.
    if (corr?.tipo !== 'easyparcel') { esito.saltate++; continue }
    const apikey = corr?.credenziali?.apikey
    if (!apikey) { esito.saltate++; continue }

    const ordine = String(s.numero).replace(/^TMP-/, '')
    let w: any = null
    try {
      // I colli servono: le etichette per-collo si chiedono solo sui multicollo, perche' su alcuni
      // prodotti quel parametro fa cadere il fornitore (vedi lib/easyparcel).
      w = await easyparcelWaybillGrezza(apikey, ordine, Number((s as any).colli) || 1)
    } catch (e: any) {
      console.warn('[TMP] waybill non ancora disponibile', s.numero, e?.message)
      esito.ancoraNulla++
      continue
    }

    const patch: any = {}

    // LE ETICHETTE SI SALVANO ANCHE SENZA LETTERA DI VETTURA: sono valide di per se', il pacco con
    // quelle parte. Buttarle perche' manca un altro campo e' il motivo per cui certi pacchi sono
    // rimasti fermi mezza giornata.
    const singole: string[] = (w?.singole || []).map((x: any) => x?.pdfBase64).filter(Boolean)
    if (singole.length) {
      const unito = (await unisciEtichette(singole)) || w?.pdfBase64
      if (unito) patch.etichetta_url = `data:application/pdf;base64,${unito}`
      const dett = Array.isArray(s.colli_dettaglio) ? [...s.colli_dettaglio] : []
      if (dett.length) {
        for (let i = 0; i < dett.length; i++) {
          if (singole[i]) dett[i] = {
            ...dett[i],
            etichetta_url: `data:application/pdf;base64,${singole[i]}`,
            numero: w.singole[i]?.numero || dett[i]?.numero,
          }
        }
        patch.colli_dettaglio = dett
      }
    } else if (w?.pdfBase64) {
      patch.etichetta_url = `data:application/pdf;base64,${w.pdfBase64}`
    }

    // IL NUMERO si cambia solo se la LDV c'e' davvero ed e' diversa. Mai per un valore vuoto o dubbio.
    const ldv = String(w?.numero || '').trim()
    if (ldv && ldv !== s.numero) {
      // Se quel numero esiste gia' su un'altra spedizione non si sovrascrive niente: si segnala.
      const { data: gia } = await admin.from('spedizioni').select('id').eq('numero', ldv).neq('id', s.id).maybeSingle()
      if (gia) console.error('[TMP] LDV gia in uso da un altra spedizione, non riassegnata', ldv, s.numero)
      else { patch.numero = ldv; patch.tracking_number = ldv }
    }

    if (!Object.keys(patch).length) { esito.ancoraNulla++; continue }
    const { error } = await admin.from('spedizioni').update(patch).eq('id', s.id)
    if (error) { console.error('[TMP] aggiornamento fallito', s.numero, error.message); continue }

    if (patch.numero) {
      esito.completate++
      console.log('[TMP] completata', s.numero, '->', patch.numero)
      // ANCHE L'ESTRATTO CONTO: il movimento porta il numero nella descrizione e nel riferimento. Se
      // resta quello provvisorio, il cliente si ritrova addebitata una spedizione con un numero che
      // non esiste da nessuna parte. Cambia solo il testo — mai l'importo.
      //
      // DUE MODI DI SCRIVERE QUELLA RIGA, e servono entrambi. Le righe vecchie hanno il numero
      // provvisorio dentro al testo e si sistemano sostituendolo. Quelle nuove NON lo nominano: dicono
      // "In attesa di lettera di vettura", e vanno RICOSTRUITE dal numero vero. Guardare solo le prime
      // e' il guasto del 23/09: il riferimento veniva corretto qui, e proprio per questo la rete di
      // sicurezza del cron — che pesca le righe dal riferimento ancora provvisorio — non le ritrovava
      // piu'. Dodici righe su quattro spedizioni sono rimaste senza numero in modo definitivo.
      const { descrizioneSpedizione, ATTESA_LDV } = await import('@/lib/movimenti')
      const { data: mv } = await admin.from('movimenti').select('id,descrizione,riferimento').eq('spedizione_id', s.id)
      for (const m of (mv || [])) {
        const t = String(m.descrizione || '')
        const upd: any = {}
        if (t.includes(s.numero)) upd.descrizione = t.split(s.numero).join(patch.numero)
        else if (t.startsWith(ATTESA_LDV)) upd.descrizione = descrizioneSpedizione(patch.numero, (s as any).dest_nome)
        if (String(m.riferimento || '') === s.numero) upd.riferimento = patch.numero
        if (Object.keys(upd).length) await admin.from('movimenti').update(upd).eq('id', m.id)
      }
    } else {
      esito.soloEtichette++
      console.log('[TMP] recuperate solo le etichette', s.numero)
    }
  }

  return esito
}
