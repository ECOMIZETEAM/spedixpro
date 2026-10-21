import { spediamoproSearchStocks, spediamoproReleaseStock } from '@/lib/spediamopro'
import { erroreSvincoloPulito } from '@/lib/errore-corriere'
import { registraMovimento } from '@/lib/movimenti'
import { addebitaServizioGiacenza, totaleResoAddebitato, pianoServizioGiacenzaCondivisione } from '@/lib/giacenza-cascata'
import { gambePerTracking } from '@/lib/condivisione-catena'
import { prossimoNumeroDistintaResi } from '@/lib/distinte-resi'

// LA PORTA UNICA DELLO SVINCOLO. La usano tutte le strade — il portale (GiacenzaDettaglio →
// conferma_svincolo), l'svincolo massivo, l'API v1 — così la regola che decide CHI PAGA COSA e che
// PARLA COL CORRIERE sta in un posto solo, non copiata in ogni rotta (era il rischio: una porta
// aggiornata e le altre no). Estratta 1:1 dal flusso del portale che già funziona.
//
// Invia lo svincolo al corriere (SpediamoPro / DVA / Spedisci), addebita a cascata SOLO il servizio
// (l'apertura è già stata addebitata all'ENTRATA in giacenza dal cron), chiude la richiesta e marca
// la spedizione 'svincolata'. Se il corriere RIFIUTA lancia un Error col messaggio pulito: chi
// chiama lo trasforma in 400 e NON marca svincolata (niente 'svincolata' senza svincolo reale).
//
// Ritorna { addebito, distintaReso, avviso }. `avviso` è una segnalazione non bloccante (es. il
// corriere aveva registrato "rifiutato") da mostrare a chi opera.
export async function eseguiSvincolo(
  admin: any,
  sped: any,
  rich: any,
  nomeUtente: string,
): Promise<{ addebito: number; distintaReso: number | null; avviso: string | null }> {
  const id = sped.id

  const { data: costiManuali } = await admin.from('giacenza_costi').select('importo').eq('spedizione_id', id)
  const extra = (costiManuali || []).reduce((s: number, c: any) => s + (Number(c.importo) || 0), 0)
  const totale = +((Number(rich.costo_totale) || 0) + extra).toFixed(2)

  const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }
  const istr = `${opLabel[rich.operazione] || rich.operazione}${rich.data_operazione ? ' - data ' + rich.data_operazione : ''}${rich.note ? ' - ' + rich.note : ''}`

  // PACCO CONDIVISO (piu' gambe, la prima un ponte): chi svincola puo' essere il cliente in fondo alla fila
  // o un master qualsiasi della fila, ma l'istruzione va al corriere VERO, una volta sola, con le credenziali
  // di chi detiene il contratto (la gamba che non compra da nessuno). Prima la gamba-ponte cadeva nel ramo
  // "svincolo automatico non disponibile": su SDA EXPRESS L, dal 9/10, 54 richieste e nessuna arrivata.
  const trk = sped.tracking_number ? String(sped.tracking_number) : ''
  const gambe = trk ? ((await gambePerTracking(admin, [trk])).get(trk) || []) : []
  const condiviso = gambe.length > 1 && gambe[0].tipo === 'moovexpress'
  const idsGambe = condiviso ? gambe.map(g => g.spedizioneId) : [id]
  let spedCorriere = sped
  let pianoServizio: any = undefined
  if (condiviso) {
    // GIA' SVINCOLATA DA UN'ALTRA GAMBA (un altro livello della fila): l'istruzione e' gia' partita. Senza
    // questo controllo ogni gamba poteva rimandarla al corriere, e da ognuna si vede il bottone "Svincola".
    const { data: statiGambe, error: eSt } = await admin.from('spedizioni').select('id,giacenza_stato').in('id', idsGambe)
    if (eSt) throw new Error('Gambe del pacco non leggibili: lo svincolo non è stato inviato. Riprova.')
    if ((statiGambe || []).some((g: any) => g.giacenza_stato === 'svincolata')) {
      throw new Error('Questa giacenza risulta già svincolata da un altro livello della rete: al corriere non è stato inviato niente.')
    }
    const detentore = gambe.find(g => !g.venditoreSpedizioneId && g.tipo !== 'moovexpress')
    if (!detentore) throw new Error('Non si trova chi detiene il contratto di questa spedizione: lo svincolo non è stato inviato. Contatta l\'assistenza.')
    const { data: o, error: eO } = await admin.from('spedizioni')
      .select('*, corrieri(tipo,credenziali,nome_contratto,settings,master_id)').eq('id', detentore.spedizioneId).maybeSingle()
    if (eO || !o) throw new Error('Gamba del detentore non leggibile: lo svincolo non è stato inviato. Riprova.')
    // Il numero delle gambe-ponte porta un suffisso (es. 282224J030238-216b3342): al corriere va la LDV vera.
    spedCorriere = { ...o, numero: o.tracking_number || o.numero }
    // Prima di parlare col corriere: il servizio si deve poter addebitare lungo la fila (il reso lo fa il
    // database). Se la fila non si legge si lancia qui, e al corriere non e' partito niente.
    // Il piano si TIENE e si passa all'addebito: dopo il corriere non si rilegge niente.
    if (rich.operazione !== 'reso') {
      pianoServizio = await pianoServizioGiacenzaCondivisione(admin, gambe, rich.operazione, { richiestaSpedizioneId: id, importoServizioCliente: Number(rich.costo_servizio) || 0 })
    }
  }

  // Invio dello svincolo al corriere (per un pacco condiviso, quello della gamba del detentore).
  let avviso: string | null = null
  const inviaAlCorriere = async (sped: any) => {
    const cred = (sped.corrieri?.credenziali || {}) as Record<string, any>
    if (cred?.authcode) {
      // SpediamoPro: rilascio dello STOCK (giacenza). riconsegna=1, nuovo indirizzo=2, reso=3.
      const raw: any = sped.raw_response || {}
      const spid = raw.id || raw?.raw?.data?.id
      const code = raw.code || raw?.raw?.data?.code || sped.tracking_number
      const releaseAction = rich.operazione === 'reso' ? 3 : rich.operazione === 'riconsegna_nuovo' ? 2 : 1
      const extraSp: any = {}
      if (rich.note) extraSp.instructions = String(rich.note)
      if (releaseAction === 2) {
        const nd = rich.nuovo_destinatario || {}
        extraSp.alternativeAddress = {
          name: nd.nome || sped.dest_nome || '', address: nd.indirizzo || '', postalCode: nd.cap || '',
          city: nd.citta || '', province: nd.provincia || '', country: 'IT',
          ...(nd.telefono ? { phone: String(nd.telefono) } : {}),
        }
      }
      try {
        const stocks = await spediamoproSearchStocks(cred.authcode, String(code))
        const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && (!spid || Number(st.shipmentId) === Number(spid)))
        if (!attivo?.id) throw new Error('Giacenza non più attiva sul corriere (già svincolata o scaduta).')
        const motivo = String(attivo.reason || '')
        if (motivo) { try { await admin.from('spedizioni').update({ giacenza_motivo: motivo.slice(0, 200) }).eq('id', id) } catch {} }
        // NIENTE BLOCCHI sulla causale: i corrieri a volte registrano un motivo sbagliato. Si avvisa.
        if (/rifiut|refus|respint/i.test(motivo) && releaseAction !== 3) {
          avviso = `Il corriere aveva registrato "${motivo}": su un pacco rifiutato la riconsegna viene spesso respinta. Se non va a buon fine, resta il "Reso al mittente".`
        }
        if (/indirizzo\s*(errato|inesistente|incompleto)|sconosciut|manca civico|incompl/i.test(motivo) && releaseAction === 1) {
          avviso = `Il corriere aveva segnalato "${motivo}": la riconsegna allo stesso indirizzo potrebbe fallire di nuovo. Se non va a buon fine, usa "Riconsegna a nuovo indirizzo" o "Reso al mittente".`
        }
        await spediamoproReleaseStock(cred.authcode, Number(attivo.id), releaseAction, extraSp)
      } catch (e: any) {
        throw new Error(erroreSvincoloPulito(e))
      }
    } else if (sped.corrieri?.tipo === 'easyparcel' && cred?.apikey) {
      // DVA: lo svincolo si chiede con la LDV. riconsegna=D, reso=M, nuovo indirizzo=N.
      const { easyparcelSvincolo } = await import('@/lib/easyparcel')
      const azioneV = rich.operazione === 'reso' ? 'M' : rich.operazione === 'riconsegna_nuovo' ? 'N' : 'D'
      const nd = rich.nuovo_destinatario || {}
      try {
        const esito = await easyparcelSvincolo(cred.apikey, String(sped.numero || sped.tracking_number), azioneV as any, {
          note: istr,
          telefonoDestinatario: nd.telefono || sped.dest_telefono || '',
          nuovoIndirizzo: azioneV === 'N' ? {
            cognome: nd.nome || sped.dest_nome || '', indirizzo: nd.indirizzo || '',
            cap: nd.cap || '', localita: nd.citta || '', provincia: nd.provincia || '', telefono: nd.telefono || '',
          } : undefined,
        })
        try {
          await admin.from('giacenza_richieste')
            .update({ note: [rich.note, `[corriere: ${esito.azione} - € ${esito.importo.toFixed(2)}${esito.idGiacenza ? ' - rif ' + esito.idGiacenza : ''}]`].filter(Boolean).join(' ') })
            .eq('id', rich.id)
        } catch {}
      } catch (e: any) {
        throw new Error(erroreSvincoloPulito(e))
      }
    } else if (cred?.master_domain && cred?.password && (sped.tracking_number || sped.numero)) {
      // Spedisci.online: rilascio via POST /api/v2/stock/update (endpoint corretto). riconsegna=RETRY,
      // nuovo indirizzo=NEWADDRESS, reso=RETURN. Blocca sull'errore come gli altri.
      const ldvV = String(sped.tracking_number || sped.numero)
      const actionV = rich.operazione === 'reso' ? 'RETURN' : rich.operazione === 'riconsegna_nuovo' ? 'NEWADDRESS' : 'RETRY'
      let gg = rich.data_operazione ? new Date(rich.data_operazione) : new Date()
      if (isNaN(gg.getTime())) gg = new Date()
      const scheduledV = `${String(gg.getDate()).padStart(2, '0')}/${String(gg.getMonth() + 1).padStart(2, '0')}/${gg.getFullYear()}`
      const ndV = rich.nuovo_destinatario || {}
      const bodyV: any = { ldv: ldvV, action: actionV, scheduled_at: scheduledV, note: (rich.note || istr || '').slice(0, 200) }
      if (actionV === 'NEWADDRESS') {
        const telV = Number(String(ndV.telefono || sped.dest_telefono || '').replace(/\D/g, '')) || undefined
        bodyV.newaddress = {
          name: ndV.nome || sped.dest_nome || '', street1: ndV.indirizzo || '', city: ndV.citta || '',
          state: ndV.provincia || '', postalCode: ndV.cap || '', country: 'IT',
          ...(telV ? { phone: telV } : {}),
          email: ndV.email || sped.dest_email || 'noreply@moovexpress.com',
          notes: (rich.note || istr || '').slice(0, 200),
        }
      }
      try {
        const rv = await fetch(`https://${cred.master_domain}/api/v2/stock/update`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyV),
        })
        if (!rv.ok) {
          const t = await rv.text().catch(() => '')
          throw new Error(`Spedisci HTTP ${rv.status}${t ? ' - ' + t.slice(0, 140) : ''}`)
        }
      } catch (e: any) {
        throw new Error(erroreSvincoloPulito(e))
      }
    } else if (sped.corrieri?.tipo === 'poste' && (cred?.clientId || cred?.ambiente === 'demo')) {
      // Poste Delivery Business (KSync): svincolo via /deposits/release. `releaseAction` è un codice PDB per
      // operazione: la riconsegna è AZ0001 (dall'esempio), gli altri li dà ParcelPilot e stanno nei settings
      // del contratto. Se manca il codice per l'operazione richiesta NON si indovina (rischio azione
      // sbagliata su un pacco vero): ci si ferma con un avviso chiaro.
      // Le settings del contratto le legge questa funzione: i chiamanti non le portano (nella pagina del
      // dettaglio finirebbero nel browser), e senza l'interruttore qui non si accendeva mai.
      let settingsPo: any = (sped.corrieri as any)?.settings
      if (settingsPo === undefined) {
        const { data: cs } = await admin.from('corrieri').select('settings').eq('id', sped.corriere_id).maybeSingle()
        settingsPo = (cs as any)?.settings
      }
      settingsPo = settingsPo || {}
      // INTERRUTTORE: in produzione KSync non lavora ancora gli svincoli (al 16/10 attivi solo sul demo,
      // swagger "non supportata"). Se accettasse la richiesta senza eseguirla, qui si addebiterebbe un
      // servizio che nessuno fa. Si accende dal contratto (settings.svincolo_api = true) quando il
      // fornitore conferma la produzione, insieme ai codici azione di reso e nuovo indirizzo.
      if (settingsPo.svincolo_api !== true) {
        throw new Error('Lo svincolo automatico non è ancora attivo su questo contratto: per ora contatta il corriere, poi chiudi la giacenza a mano.')
      }
      const codiciPo: Record<string, string> = {
        riconsegna: String(settingsPo.release_action_riconsegna || 'AZ0001'),
        riconsegna_nuovo: String(settingsPo.release_action_nuovo || ''),
        reso: String(settingsPo.release_action_reso || ''),
      }
      const releaseAction = codiciPo[rich.operazione] || ''
      if (!releaseAction) throw new Error(`Svincolo "${opLabel[rich.operazione] || rich.operazione}" non ancora configurato per questo contratto: manca il codice azione (da impostare nel contratto).`)
      const { svincolaKsync } = await import('@/lib/ksync')
      const credPo = { clientId: cred.clientId, secretId: cred.secretId, costCenterCode: cred.costCenterCode, ambiente: (cred.ambiente === 'demo' ? 'demo' : 'prod') as 'prod' | 'demo', baseUrl: cred.baseUrl, scope: cred.scope }
      const ndP = rich.nuovo_destinatario || {}
      try {
        const esito = await svincolaKsync(credPo, {
          shipmentId: String(sped.tracking_number || sped.numero),
          releaseAction,
          nuovoIndirizzo: rich.operazione === 'riconsegna_nuovo'
            ? { ragioneSociale: ndP.nome || sped.dest_nome || '', indirizzo: ndP.indirizzo || '', cap: ndP.cap || '', citta: ndP.citta || '', provincia: ndP.provincia || '', paese: 'IT', telefono: ndP.telefono || sped.dest_telefono || '', email: ndP.email || sped.dest_email || '' }
            : undefined,
        })
        if (!esito.ok) throw new Error(esito.descrizione || 'Svincolo non riuscito')
      } catch (e: any) {
        throw new Error(erroreSvincoloPulito(e))
      }
    } else {
      // NESSUN CORRIERE CONTATTATO: ci si ferma QUI, prima di addebitare.
      //
      // I rami sopra coprono i contratti che sanno ricevere uno svincolo (SpediamoPro, DVA, Spedisci,
      // Poste diretto). Su tutti gli altri — GLS diretto, BRT diretto, FedEx, Dielle, circuito interno —
      // non esiste una chiamata di svincolo, e senza questo blocco la funzione tirava dritto: addebitava
      // il servizio, segnava la richiesta "confermata" e la spedizione "svincolata" SENZA che nessuna
      // istruzione fosse partita. Il cliente avrebbe pagato una riconsegna che nessuno ha chiesto, e il
      // pacco sarebbe rimasto fermo con a video scritto che era stato svincolato.
      //
      // Non e' ancora successo (al 25/09/2026: GLS diretto ha 3 giacenze e zero richieste, gli altri
      // zero), ma il giorno che un master apre una giacenza su un contratto diretto succede in silenzio.
      // Meglio un errore chiaro: la giacenza si lavora col corriere, e a video non compare un falso fatto.
      const nomeContratto = String(sped.corrieri?.nome_contratto || 'questo contratto')
      throw new Error(
        `Lo svincolo automatico non è disponibile su ${nomeContratto}: questo corriere non riceve le istruzioni dal gestionale. `
        + `Contatta il corriere per la ${(opLabel[rich.operazione] || rich.operazione).toLowerCase()}, poi chiudi la giacenza a mano.`,
      )
    }
  }
  await inviaAlCorriere(spedCorriere)

  // ADDEBITO: solo il servizio scelto (l'apertura è già stata addebitata all'ENTRATA in giacenza).
  // Il RESO non guarda giacenza_addebito_effettuato (un pacco può finire in giacenza due volte).
  let resoAddebitato = false
  let addebitoRiportato = totale
  const spedGiac = { id, numero: sped.numero, cliente_id: sped.cliente_id, master_id: sped.master_id, corriere_id: sped.corriere_id, tracking_number: sped.tracking_number }
  if (!condiviso) {
    if (rich.operazione === 'reso') {
      const esito = await addebitaServizioGiacenza(spedGiac, 'reso', 0, { gambe })
      resoAddebitato = esito.addebitato
    }
    if (!sped.giacenza_addebito_effettuato) {
      if (rich.operazione !== 'reso') {
        await addebitaServizioGiacenza(spedGiac, rich.operazione, Number(rich.costo_servizio) || 0, { gambe })
      }
      if (extra > 0) {
        await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
          descrizione: `Costi giacenza ${sped.numero}`, riferimento: sped.numero, importo: -Math.abs(extra), spedizioneId: id })
      }
    }
  } else {
    // PACCO CONDIVISO. Il corriere ha gia' accettato: da qui in poi niente deve far risultare fallito lo
    // svincolo, perche' chi riprova rimanderebbe l'istruzione. Un addebito che non riesce si scrive nei log
    // e le gambe restano svincolate con giacenza_addebito_effettuato a false: e' cosi' che si ritrovano.
    try {
      let segnoMio = false
      if (rich.operazione === 'reso') {
        const esito = await addebitaServizioGiacenza(spedGiac, 'reso', 0, { gambe })
        resoAddebitato = esito.addebitato
        // Il reso lo addebita il database: il segno qui serve ai costi manuali, una volta per pacco.
        const { data: presi, error: eSegno } = await admin.from('spedizioni').update({ giacenza_addebito_effettuato: true })
          .in('id', idsGambe).or('giacenza_addebito_effettuato.is.null,giacenza_addebito_effettuato.eq.false').select('id')
        if (eSegno) throw new Error('segno non scritto: ' + eSegno.message)
        segnoMio = (presi || []).length === idsGambe.length
      } else {
        const esito = await addebitaServizioGiacenza(spedGiac, rich.operazione, Number(rich.costo_servizio) || 0, { gambe, piano: pianoServizio })
        segnoMio = esito.addebitato
      }
      if (segnoMio) {
        // COSTI MANUALI DI TUTTE LE GAMBE: ognuno li mette sulla gamba che vede (il master di Blood sulla
        // gamba del cliente, LOGIXIA sulla sua). Leggendo la sola gamba premuta, quelli delle altre si
        // perdevano. Ogni importo va al cliente della SUA gamba, come prima per la gamba singola.
        const { data: costiPacco } = await admin.from('giacenza_costi').select('spedizione_id,importo').in('spedizione_id', idsGambe)
        const perGamba = new Map<string, number>()
        for (const c of (costiPacco || [])) perGamba.set(c.spedizione_id, (perGamba.get(c.spedizione_id) || 0) + (Number(c.importo) || 0))
        const conCosti = [...perGamba].filter(([, v]) => v > 0).map(([k]) => k)
        if (conCosti.length) {
          const { data: righe } = await admin.from('spedizioni').select('id,numero,master_id,cliente_id').in('id', conCosti)
          for (const g of (righe || [])) {
            if (!g.cliente_id) continue
            await registraMovimento(admin, { masterId: g.master_id, clienteId: g.cliente_id, tipo: 'giacenza',
              descrizione: `Costi giacenza ${g.numero}`, riferimento: g.numero, importo: -Math.abs(perGamba.get(g.id) || 0), spedizioneId: g.id })
          }
        }
      } else {
        // Il servizio del pacco l'ha gia' preso un altro svincolo: a chi ha premuto non si mostra un costo mai scritto.
        addebitoRiportato = 0
      }
    } catch (e: any) {
      console.error('[SVINCOLO][ADDEBITO NON RIUSCITO] il corriere ha accettato, l\'addebito no:', sped.numero, e?.message)
      addebitoRiportato = 0
    }
  }

  await admin.from('giacenza_richieste').update({ stato: 'confermata', confermata_da: nomeUtente, confermata_at: new Date().toISOString() }).eq('id', rich.id)
  // Pacco condiviso: una richiesta ancora aperta su un'altra gamba (es. il master che aveva chiesto la
  // stessa cosa) e' superata. Lasciarla "da confermare" vorrebbe dire poter rimandare l'istruzione al
  // corriere una seconda volta.
  if (condiviso) {
    await admin.from('giacenza_richieste').update({ stato: 'annullata' })
      .in('spedizione_id', idsGambe).neq('id', rich.id).eq('stato', 'da_confermare')
  }

  // RESO → distinta resi (già addebitata a cascata), così l'Elenco mostra "Distinta N" e la scansione
  // resi non riaddebita.
  let numeroDistintaReso: number | null = null
  if (rich.operazione === 'reso' && sped.cliente_id) {
    // Si cerca solo questo pacco, non si leggono tutte le distinte del master: oltre le 1.000 la lettura
    // intera si fermava a meta' senza dirlo (vedi lib/distinte-resi).
    const { data: gia, error: errGia } = await admin.from('distinte_resi').select('id')
      .eq('master_id', sped.master_id).contains('voci', JSON.stringify([{ id }])).limit(1)
    // Qui il corriere e l'addebito sono gia' fatti: se il numero non si legge si salta solo il documento,
    // non si fa fallire lo svincolo (l'operatore riproverebbe tutto).
    numeroDistintaReso = !errGia && !gia?.length ? await prossimoNumeroDistintaResi(admin, sped.master_id).catch(() => null) : null
    if (numeroDistintaReso) {
      // Il totale dai movimenti, come tutte le distinte di reso: se il reso era gia' stato addebitato
      // (dalla coda del tracking), l'esito dello svincolo non ha importo e la distinta usciva a 0.
      await admin.from('distinte_resi').insert({
        master_id: sped.master_id, cliente_id: sped.cliente_id, numero: numeroDistintaReso,
        totale_ldv: 1, totale: await totaleResoAddebitato(admin, [id], { clienteId: sped.cliente_id }),
        voci: [{ id, numero: sped.numero }], stato: 'chiusa',
      })
    }
  }

  const svincolata = {
    giacenza_stato: 'svincolata', giacenza_istruzioni: istr, giacenza_addebito_effettuato: true,
    // Svincolo appena fatto: azzero l'esito del Controllo Giacenze (altrimenti un vecchio "ferma" resta
    // appiccicato e la grace <12h salta la riverifica -> falso "ferma" su una gia' svincolata).
    giacenza_verifica_esito: null, giacenza_verifica_at: null,
    ...(rich.operazione === 'reso' ? { stato: 'reso_mittente', ...(resoAddebitato ? { giacenza_reso_addebitato: true } : {}) } : {}),
  }
  // Pacco condiviso: tutte le gambe, perche' ogni master della fila e il cliente devono vederla svincolata
  // (prima si segnava la sola riga di chi aveva premuto, e sulle altre la giacenza restava aperta).
  // Sul condiviso giacenza_addebito_effettuato lo scrive l'addebito (il segno): forzarlo qui a true
  // nasconderebbe un addebito non riuscito.
  if (condiviso) {
    const { giacenza_addebito_effettuato: _segno, ...soloStato } = svincolata
    await admin.from('spedizioni').update(soloStato).in('id', idsGambe)
  } else await admin.from('spedizioni').update(svincolata).eq('id', id)

  return { addebito: condiviso ? addebitoRiportato : totale, distintaReso: numeroDistintaReso, avviso }
}
