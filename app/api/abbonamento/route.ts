import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { PIANI_ENTERPRISE, pianoById, meseCorrente } from '@/lib/piani'
import { stripeConfigurato, IVA_PERCENTUALE } from '@/lib/stripe'
import { descriviCambio, primoDelMeseProssimo, conguaglioDelMese } from '@/lib/abbonamento-cambi'
import { GIORNI_TOLLERANZA } from '@/lib/limite-piano'

// Stato abbonamento del master + piani disponibili
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('parent_master_id,abbonamento_piano,abbonamento_limite,abbonamento_prezzo,abbonamento_mese,abbonamento_attivato_il,credito,abbonamento_esente,stripe_customer_id,stripe_subscription_id,stripe_stato,abbonamento_piano_programmato,abbonamento_programmato_dal')
    .eq('id', utente.master_id).single()

  const isRoot = !m?.parent_master_id  // il master principale: illimitato e gratis, mai bloccato

  const { data: mieiPag } = await admin.from('abbonamenti_pagamenti')
    .select('id,mese,importo,pagato,pagato_il,metodo,piano,created_at')
    .eq('master_id', utente.master_id).order('mese', { ascending: false }).limit(24)

  // PROSSIMO PAGAMENTO (solo master pagante): il rinnovo del piano corrente + il CONGUAGLIO degli
  // upgrade fatti QUESTO mese (la differenza di piano proporzionata ai giorni, che oggi non paga).
  // Stessa funzione che il checkout usa per addebitarlo: cosi' il numero mostrato e quello incassato
  // coincidono. Il master lo chiedeva e non lo vedeva da nessuna parte — "quanto andro' a pagare?".
  let prossimoPagamento: any = null
  if (!isRoot && !(m as any)?.abbonamento_esente && m?.abbonamento_piano) {
    const meseC = meseCorrente()
    const { totale: conguaglio, dettaglio } = conguaglioDelMese(
      (mieiPag || []).filter((p: any) => p.mese === meseC), meseC)
    // Rinnovo: il piano corrente, oppure il downgrade PROGRAMMATO se c'e' (parte dal 1° del mese dopo).
    const pianoRinnovo = (m as any)?.abbonamento_piano_programmato
      ? pianoById((m as any).abbonamento_piano_programmato) : pianoById(m.abbonamento_piano!)
    const rinnovo = Number(pianoRinnovo?.prezzo ?? m?.abbonamento_prezzo ?? 0)
    prossimoPagamento = {
      totale: Math.round((rinnovo + conguaglio) * 100) / 100,
      rinnovo, conguaglio, dettaglio, pianoRinnovo: pianoRinnovo?.nome || null,
    }
  }

  // Il piano conta le spedizioni di TUTTA la rete sotto questo master (sé + discendenza):
  // ogni spedizione di un sotto-master consuma il contratto/piano dei master sopra.
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const reteIds = await sottoAlberoMasterIds(admin, utente.master_id)
  // Il numero si legge dal CONTATORE (una riga per master e mese, tenuta da un trigger), non
  // contando le spedizioni: contarle era la query piu' costosa del database (~500ms a chiamata)
  // e a volume non reggerebbe. Il contatore da' lo stesso identico numero.
  const { data: righeConta } = await admin.from('contatori_spedizioni')
    .select('n').in('master_id', reteIds).eq('mese', meseCorrente())
  const count = (righeConta || []).reduce((t: number, r: any) => t + Number(r.n || 0), 0)

  // Se sono il ROOT (M1): LISTA DEI MASTER della rete (un master = una riga) + KPI mensili.
  // Ogni master paga il canone il 1° del mese (cron rinnovo-mensile); qui il root vede piano,
  // canone (0 se esente), e lo stato di incasso del pagamento più vecchio non ancora saldato.
  let abbonati: any[] = []
  let pagamenti: any[] = []
  let storicoIncassi: any[] = []
  let incassatoMese = 0, incassatoAnno = 0, previstoProssimoMese = 0, abbonatiAttivi = 0
  let incassoRealeStimato = 0, conguagliRete = 0
  if (isRoot) {
    // Pagamenti della rete (per stato incasso). I record ORFANI (master cancellato) vengono scartati sotto.
    const { data: pagTutti } = await admin.from('abbonamenti_pagamenti')
      .select('id,master_id,piano,mese,importo,pagato,pagato_il,metodo,created_at')
      .eq('root_id', utente.master_id).order('mese', { ascending: true }).limit(1000)
    // Le righe a 0€ sono le fatture-FANTASMA del cambio piano (Stripe emette un'invoice a zero quando
    // si fa l'upgrade): non sono incassi, non vanno né in lista né nei conteggi. Restano nel DB perché
    // il calcolo del conguaglio legge da lì la scaletta dei piani — qui si escludono e basta.
    const pag = (pagTutti || []).filter((p: any) => Number(p.importo || 0) !== 0)
    // Master ATTIVI della rete (con piano OPPURE esenti), escluso il root. Solo questi esistono → niente orfani.
    const { data: mastersRete } = await admin.from('masters')
      .select('id,nome,email,abbonamento_piano,abbonamento_prezzo,abbonamento_esente,stripe_subscription_id,stripe_stato,pagamento_scaduto_dal')
      .in('id', reteIds).neq('id', utente.master_id)
    const attiviRete = (mastersRete || []).filter((x: any) => x.abbonamento_piano || x.abbonamento_esente)
    const attiviIds = new Set(attiviRete.map((x: any) => x.id))

    // ARRICCHIMENTO per la panoramica: ultima SESSIONE (login) e spedizioni TOTALI di OGNI master della
    // rete — così il root vede chi usa e paga, chi ha la posizione aperta ma è fermo, chi non ha mai
    // scelto un piano. La sessione arriva da auth.users via fn_ultima_sessione (SECURITY DEFINER).
    const { data: sessioni } = await admin.rpc('fn_ultima_sessione', { p_masters: reteIds })
    const ultimaSessione = new Map<string, string>((sessioni || []).map((r: any) => [r.master_id, r.ultima_sessione]))
    const { data: contTot } = await admin.from('contatori_spedizioni').select('master_id,n').in('master_id', reteIds)
    const spedTot = new Map<string, number>()
    for (const c of (contTot || [])) spedTot.set(c.master_id, (spedTot.get(c.master_id) || 0) + Number((c as any).n || 0))

    // Pagamenti non pagati raggruppati per master (solo di master ESISTENTI e attivi → esclude orfani)
    const nonPagatiByMaster = new Map<string, any[]>()
    for (const p of (pag || [])) {
      if (!attiviIds.has(p.master_id)) continue
      if (p.pagato) continue
      if (!nonPagatiByMaster.has(p.master_id)) nonPagatiByMaster.set(p.master_id, [])
      nonPagatiByMaster.get(p.master_id)!.push(p)
    }
    // ULTIMO MESE PAGATO, master per master. Con la carta l'incasso e' immediato e la colonna
    // "da incassare" resta sempre vuota: senza questo il root non vedrebbe piu' NULLA, ne' chi ha
    // pagato ne' per quale mese. E' l'informazione che serve davvero adesso.
    const ultimoPagato = new Map<string, any>()
    for (const p of (pag || [])) {
      if (!p.pagato) continue
      const attuale = ultimoPagato.get(p.master_id)
      if (!attuale || String(p.mese) > String(attuale.mese)) ultimoPagato.set(p.master_id, p)
    }

    const nomeDi = (m: any) => (m?.nome && String(m.nome).trim()) || (m?.email && String(m.email).trim()) || ('Master #' + String(m?.id).slice(0, 6))
    // TUTTI i master della rete (non solo quelli con piano/esenti): così compaiono anche chi ha la
    // posizione aperta ma non ha mai scelto un piano / non ha mai spedito.
    abbonati = (mastersRete || []).map((m: any) => {
      // ESENTE = niente da incassare, nemmeno l'arretrato: l'esenzione CONDONA anche i vecchi bonifici
      // aperti da prima (decisione Lorenzo 01/09 sul caso Giga Express, canone luglio mai pagato). Senza
      // questo l'esente restava nei "Vecchi bonifici aperti" e nella lista da incassare, in contrasto con
      // tutte le altre caselle che gli esenti li escludono.
      const nonPagati = m.abbonamento_esente ? [] : (nonPagatiByMaster.get(m.id) || [])
      const daPagare = nonPagati[0] || null   // il più vecchio non saldato
      const prezzo = m.abbonamento_esente ? 0 : Number(m.abbonamento_prezzo || 0)
      return {
        master_id: m.id, master_nome: nomeDi(m), esente: !!m.abbonamento_esente,
        piano: m.abbonamento_piano, prezzo,
        // Come sta messo col pagamento: carta attiva, in ritardo, o nessuna carta.
        carta: m.stripe_subscription_id && m.stripe_stato !== 'canceled' ? (m.stripe_stato || 'active') : null,
        scaduto_dal: m.pagamento_scaduto_dal || null,
        // Congelato = conto alla rovescia scaduto. E' la stessa soglia che ferma le spedizioni,
        // letta qui una volta sola per non doverla ricalcolare in ogni schermata.
        congelato: !!m.pagamento_scaduto_dal &&
          (Date.now() - new Date(m.pagamento_scaduto_dal).getTime()) > GIORNI_TOLLERANZA * 86400000,
        ultimo_mese_pagato: ultimoPagato.get(m.id)?.mese || null,
        ultimo_pagamento_il: ultimoPagato.get(m.id)?.pagato_il || null,
        ultimo_metodo: ultimoPagato.get(m.id)?.metodo || null,
        pagamento_id: daPagare?.id || null,
        // Somma di TUTTE le righe aperte del master, non solo la più vecchia: se un master accumula 2+
        // mesi non pagati, il totale "Vecchi bonifici aperti" deve mostrarli tutti. pagamento_id/mese qui
        // restano il più vecchio, perché l'incasso si segna una riga (un mese) alla volta.
        importo_da_incassare: nonPagati.reduce((t: number, p: any) => t + Number(p.importo || 0), 0),
        mese_da_incassare: daPagare?.mese || null,
        n_da_incassare: nonPagati.length,
        // Panoramica: senza piano (mai scelto), ultima sessione (login), spedizioni totali (usato o mai).
        senza_piano: !m.abbonamento_piano && !m.abbonamento_esente,
        ultima_sessione: ultimaSessione.get(m.id) || null,
        spedizioni_totali: spedTot.get(m.id) || 0,
      }
    }).sort((a, b) => b.importo_da_incassare - a.importo_da_incassare)

    // KPI. NB: gli ESENTI non generano incasso reale (gratis): escludo anche loro vecchi record "pagato".
    const esentiIds = new Set(attiviRete.filter((m: any) => m.abbonamento_esente).map((m: any) => m.id))
    const mm = new Date().toISOString().slice(0, 7)
    const annoCorr = new Date().getFullYear().toString()
    // Storico incassi per MESE DI COMPETENZA (p.mese), NON per data di incasso: la una-tantum di
    // allineamento è pagata il 31/08 sera in UTC ma copre settembre (mese='2026-09'); raggruppando per
    // pagato_il finiva in agosto e settembre spariva dallo storico (mentre "Pagamenti di settembre",
    // che usa p.mese, lo mostrava — incoerenza). Fallback a pagato_il per le righe vecchie senza mese.
    const storicoMap = new Map<string, { incassato: number; n: number }>()
    for (const p of (pag || [])) {
      if (!attiviIds.has(p.master_id) || esentiIds.has(p.master_id) || !p.pagato) continue
      const k = p.mese ? String(p.mese) : String(p.pagato_il || '').slice(0, 7)
      if (!k) continue
      const cur = storicoMap.get(k) || { incassato: 0, n: 0 }
      cur.incassato += Number(p.importo || 0); cur.n++
      storicoMap.set(k, cur)
      if (k === mm) incassatoMese += Number(p.importo || 0)
      if (k.slice(0, 4) === annoCorr) incassatoAnno += Number(p.importo || 0)
    }
    // Elenco dei pagamenti, per poter guardare QUALSIASI mese e non solo il totale: e' la cosa
    // che serve davvero al master principale ("a luglio quanto ho incassato?").
    pagamenti = (pag || [])
      .filter((p: any) => attiviIds.has(p.master_id) && !esentiIds.has(p.master_id))
      .map((p: any) => ({
        master_id: p.master_id,
        master_nome: nomeDi(attiviRete.find((x: any) => x.id === p.master_id)),
        mese: p.mese, importo: Number(p.importo || 0), pagato: !!p.pagato,
        pagato_il: p.pagato_il || null, metodo: p.metodo || null, pagamento_id: p.id,
      }))

    storicoIncassi = Array.from(storicoMap.entries())
      .map(([mese, v]) => ({ mese, incassato: Math.round(v.incassato * 100) / 100, n: v.n }))
      .sort((a, b) => b.mese.localeCompare(a.mese))
    for (const m of attiviRete) if (m.abbonamento_piano && !m.abbonamento_esente) { previstoProssimoMese += Number(m.abbonamento_prezzo || 0); abbonatiAttivi++ }

    // PROSSIMO INCASSO STIMATO (reale, non teorico). previstoProssimoMese e' il VALORE della rete —
    // i canoni pieni di TUTTI, congelati e senza-carta compresi. Qui invece si stima quanto si
    // incassera' DAVVERO: solo i master con carta ATTIVA e non in ritardo (quelli che pagano) + i
    // conguagli in sospeso dei cambi piano del mese (che si incassano al prossimo rinnovo).
    const meseC = meseCorrente()
    const rowsPerMaster = new Map<string, any[]>()
    for (const p of (pagTutti || [])) {
      if (p.mese !== meseC) continue
      if (!rowsPerMaster.has(p.master_id)) rowsPerMaster.set(p.master_id, [])
      rowsPerMaster.get(p.master_id)!.push(p)
    }
    for (const rows of rowsPerMaster.values()) conguagliRete += conguaglioDelMese(rows, meseC).totale
    conguagliRete = Math.round(conguagliRete * 100) / 100
    const canoniSolidi = abbonati
      .filter((a: any) => !a.esente && a.carta && !a.scaduto_dal)   // carta attiva, non in ritardo/congelato
      .reduce((t: number, a: any) => t + Number(a.prezzo || 0), 0)
    incassoRealeStimato = Math.round((canoniSolidi + conguagliRete) * 100) / 100
  }

  return NextResponse.json({
    attivo: isRoot || !!m?.abbonamento_piano,
    illimitato: isRoot,
    esente: !!(m as any)?.abbonamento_esente,
    piano: isRoot ? 'illimitato' : (m?.abbonamento_piano || null),
    limite: m?.abbonamento_limite || 0,
    prezzo: Number(m?.abbonamento_prezzo || 0),
    spedizioni_mese: count || 0,
    credito: Number(m?.credito || 0),
    piani: PIANI_ENTERPRISE,
    // Lo storico dei PROPRI pagamenti: il master lo chiedeva e non lo vedeva da nessuna parte —
    // sapeva di aver pagato solo perche' se lo ricordava.
    // Nascondi le righe-fantasma a 0€ (cambio piano) anche dallo storico del singolo master: mostra i
    // pagamenti veri. La scaletta piani per il conguaglio la legge da mieiPag (completo), sopra.
    mieiPagamenti: (mieiPag || []).filter((p: any) => Number(p.importo || 0) !== 0),
    prossimoPagamento,
    cambioProgrammato: descriviCambio(m),
    // Pagamento con carta: disponibile solo se le chiavi ci sono. Finche' non ci sono, la
    // schermata resta identica a prima e si paga come si e' sempre pagato.
    carta: {
      disponibile: stripeConfigurato() && !isRoot && !(m as any)?.abbonamento_esente,
      attiva: !!(m as any)?.stripe_subscription_id,
      stato: (m as any)?.stripe_stato || null,
      iva: IVA_PERCENTUALE,
    },
    isRoot,
    abbonati,
    totaleDaIncassare: Math.round(abbonati.reduce((s, a) => s + Number(a.importo_da_incassare || 0), 0) * 100) / 100,
    incassatoMese: Math.round(incassatoMese * 100) / 100,
    incassatoAnno: Math.round(incassatoAnno * 100) / 100,
    annoCorrente: new Date().getFullYear(),
    previstoProssimoMese: Math.round(previstoProssimoMese * 100) / 100,
    incassoRealeStimato,
    conguagliRete,
    abbonatiAttivi,
    storicoIncassi,
    pagamenti,
    meseCorrente: meseCorrente(),
  })
}

// Sceglie / cambia piano (upgrade paga la differenza, downgrade nessun addebito ora)
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { pianoId } = await req.json()
  const nuovo = pianoById(pianoId)
  if (!nuovo || !pianoId.startsWith('enterprise_')) return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })

  const admin = createAdminSupabase()
  const payer = utente.master_id
  const { data: m } = await admin.from('masters')
    .select('nome,abbonamento_piano,abbonamento_prezzo,abbonamento_mese,abbonamento_esente,stripe_subscription_id,stripe_stato').eq('id', payer).single()

  // Trova il SUPERROOT (M1): risalgo la catena fino al master senza padre.
  let rootId = payer
  { let cur: string | null = payer
    for (let i = 0; i < 20 && cur; i++) {
      const { data: mm } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      if (!mm?.parent_master_id) { rootId = cur; break }
      cur = mm.parent_master_id
    }
  }
  const isRoot = rootId === payer  // il master principale è la piattaforma: esente

  // IL CANONE SI PAGA CON CARTA, punto. La vecchia strada — scalarlo dal credito interno e poi
  // rincorrere il bonifico a mano — non e' piu' un'alternativa offerta: toglierla solo dalle
  // schermate non basterebbe, perche' questa rotta si puo' chiamare lo stesso.
  //
  // Restano fuori dalla regola solo chi non paga per davvero: il master principale (e' la
  // piattaforma) e i master esenti, per cui l'importo e' zero e non c'e' niente da incassare.
  // La regola NON dipende piu' da stripeConfigurato(). Prima si', e voleva dire che il giorno in
  // cui quella variabile d'ambiente fosse mancata — un ambiente nuovo, una chiave scaduta, una
  // svista — la strada vecchia si sarebbe riaperta da sola e avrebbe ricominciato a mangiare il
  // credito delle spedizioni, in silenzio. E' successo davvero fino al 30 luglio: quattro master
  // portano ancora addosso il canone scalato dal credito, e tre di loro sono fermi a -139,00 tondi,
  // cioe' esattamente il canone, senza aver mai spedito un pacco.
  // Chi paga, paga con carta. Senza carta non si attiva: non esiste piu' un ripiego.
  if (!isRoot && !(m as any)?.abbonamento_esente) {
    return NextResponse.json({ error: 'Il canone si paga con carta: scegli il piano e completa il pagamento.' }, { status: 400 })
  }

  const mese = meseCorrente()
  const prezzoAttuale = Number(m?.abbonamento_prezzo || 0)
  const haPianoQuestoMese = !!m?.abbonamento_piano && m?.abbonamento_mese === mese
  if (m?.abbonamento_piano === nuovo.id) return NextResponse.json({ error: 'Hai già questo piano' }, { status: 400 })

  // Importo da addebitare ORA:
  // - primo abbonamento / mese nuovo non ancora addebitato: canone pieno
  // - upgrade nello stesso mese: solo la differenza
  // - downgrade nello stesso mese: 0 (il canone più alto è già pagato)
  // Qui ci arrivano SOLO il root e i master esenti, per cui il canone e' zero: chi paga e' stato
  // rimandato alla carta qui sopra. Quindi non c'e' piu' niente da addebitare, e soprattutto non
  // c'e' piu' il codice per farlo.
  //
  // C'era: scalava il canone dal credito delle SPEDIZIONI e lo accreditava al root. E' il motivo
  // per cui un master a credito scalare, appena abbonato, si ritrovava a -139,00 e non poteva
  // spedire il primo pacco finche' non ricaricava il canone. Averlo lasciato spento dietro a un
  // controllo sulla configurazione non bastava: il codice che sa muovere soldi, se resta scritto,
  // prima o poi qualcuno lo riaccende.
  // Le voci gia' registrate restano dove sono: lo storico non si cancella.
  const importo = 0

  // DOWNGRADE: non si applica adesso. Il mese in corso e' pagato al prezzo alto, e abbassare il
  // limite subito significherebbe togliere qualcosa di gia' pagato — e magari bloccare una rete che
  // quel mese aveva gia' spedito oltre il nuovo limite. Si scrive l'intenzione e la applica il giro
  // del primo del mese. L'upgrade invece vale subito: serve proprio a non doversi fermare.
  if (haPianoQuestoMese && nuovo.prezzo < prezzoAttuale) {
    const dal = primoDelMeseProssimo().toISOString()
    await admin.from('masters').update({
      abbonamento_piano_programmato: nuovo.id, abbonamento_programmato_dal: dal,
    }).eq('id', utente.master_id)
    return NextResponse.json({ success: true, piano: nuovo.id, addebitato: 0, programmato: true, dal })
  }

  await admin.from('masters').update({
    abbonamento_piano: nuovo.id, abbonamento_limite: nuovo.limite, abbonamento_prezzo: nuovo.prezzo,
    abbonamento_mese: mese,
    // Un downgrade programmato prima non ha piu' senso dopo un upgrade.
    abbonamento_piano_programmato: null, abbonamento_programmato_dal: null,
    abbonamento_attivato_il: m?.abbonamento_piano ? undefined : new Date().toISOString(),
  }).eq('id', utente.master_id)

  return NextResponse.json({ success: true, piano: nuovo.id, addebitato: importo })
}
