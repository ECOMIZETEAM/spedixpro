import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { createAdminSupabase } from '@/lib/supabase-admin'


// Risale la catena dei master: [masterId, padre, nonno, ...]
async function risaliCatena(adminDb: any, masterId: string): Promise<string[]> {
  const path: string[] = []
  let cur: string | null = masterId
  for (let i = 0; i < 20 && cur; i++) {
    path.push(cur)
    const { data: m } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = m?.parent_master_id || null
  }
  return path
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  const myMaster = utente?.master_id
  if (!myMaster) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  // IL RUOLO, NON SOLO L'APPARTENENZA. `master_id` ce l'hanno anche i clienti (769 in produzione)
  // e gli autisti: da solo dice a quale rete uno appartiene, non che comandi qualcosa. Qui sotto si
  // scrive con la chiave di servizio, che scavalca le regole per riga — quindi il permesso va
  // controllato a mano, come fa gia' la rotta gemella /api/network/rettifiche.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const { nomeFile, righe } = body

  // ── E' IL FILE DELLE RIPESATURE DEL FORNITORE? ──
  //
  // Una schermata sola, due file possibili: quello dei PESI (storico) e quello delle RIPESATURE che
  // manda il corriere. Chi carica non deve sapere in quale voce di menu va quale export — lo
  // riconosce il sistema dalle COLONNE.
  //
  // E' successo davvero: il file delle ripesature caricato qui dentro ha risposto "0 da rettificare"
  // senza spiegare perche'. Il motivo e' che questa rotta cerca una colonna "peso reale", mentre
  // quel file la chiama `peso_riscontrato` — e soprattutto qui le MISURE vengono buttate via
  // ("senza misure: nessun volumetrico"), mentre su quel file e' proprio il volume a fare il
  // supplemento: su 45 spedizioni su 106 il pacco pesa MENO del dichiarato e paga lo stesso.
  {
    const { sembraRipesature, leggiRipesature } = await import('@/lib/ripesature')
    if (sembraRipesature(righe || [])) {
      const { calcolaRipesature } = await import('@/lib/ripesature-calcolo')
      const lette = leggiRipesature(righe || [])
      if (!lette.righe.length) return NextResponse.json({ error: 'Il file non contiene ripesature leggibili' }, { status: 400 })

      const adminRip = createAdminSupabase()

      // A FETTE, cosi' la schermata puo' dire a che punto sta.
      // Riprezzare una spedizione vuol dire ricostruire tutta la sua catena di master, e ognuno e'
      // qualche lettura: su centosei spedizioni sono centinaia di viaggi al database, e in un colpo
      // solo la richiesta ci mette troppo e la pagina resta muta. Il browser ne chiede un pezzo per
      // volta e misura quanto ci mette davvero: il tempo che manca e' calcolato sul ritmo vero.
      //
      // L'INDICE CONTA SUL FILE, NON SU "QUELLE CHE RESTANO DA FARE". E' il guasto che ha fatto
      // sparire quarantasei spedizioni su centosei, due volte di fila: la fetta veniva presa
      // dall'elenco delle NON ancora caricate, che pero' si accorcia di quindici a ogni giro perche'
      // nel frattempo le stiamo scrivendo noi. L'indice avanzava di quindici, la lista ne perdeva
      // quindici, e ogni giro ne saltava un blocco intero; dopo quattro giri la fetta cadeva oltre
      // la fine e il lavoro si dichiarava finito a sessanta su centosei. Ogni caricamento ne
      // prendeva un pezzo diverso — ecco perche' i totali dei destinatari cambiavano ogni volta.
      // Il file e' la sola cosa che non cambia sotto i piedi: si numera quello.
      const totaleFile = lette.righe.length
      const da = Math.max(0, Number(body?.da) || 0)
      const quante = Math.max(1, Math.min(200, Number(body?.quante) || totaleFile))
      const fetta = body?.da !== undefined ? lette.righe.slice(da, da + quante) : lette.righe

      // Gia' caricate: si saltano SENZA spostare l'indice, cosi' rileggere lo stesso export (che il
      // fornitore manda cumulativo) non rifa' i conti su quelle di ieri. La garanzia vera resta
      // l'indice unico sul database: questo evita solo lavoro inutile.
      const viste = new Set<string>()
      for (let i = 0; i < fetta.length; i += 200) {
        const { data: gia } = await adminRip.from('rettifiche')
          .select('rif_fornitore').eq('master_id', myMaster)
          .in('rif_fornitore', fetta.slice(i, i + 200).map(r => r.idOrdine))
        for (const g of (gia || [])) viste.add((g as any).rif_fornitore)
      }
      const nuove = fetta.filter(r => !viste.has(r.idOrdine))
      // IL COSTO DEL FORNITORE E' QUELLO DI TUTTO IL FILE, non della fetta che sto elaborando ora.
      // Spezzando il lavoro a pacchetti da quindici avevo lasciato il totale sul pacchetto: a
      // schermo usciva 33,54 invece di 356,35 — cioe' la somma degli ultimi quindici.
      const costoFornitoreTotale = Math.round(lette.righe.reduce((s, r) => s + r.addebitoFornitore, 0) * 100) / 100
      const esiti = await calcolaRipesature(adminRip, nuove)

      // ── CARICAMENTO VERO ──
      // Si scrive SOLO se chi carica lo chiede esplicitamente. Il primo giro e' sempre
      // un'anteprima: chi paga guarda i numeri, poi conferma.
      {
        // UNA RIGA SOLA NELL'ELENCO FILE, non una per pacchetto.
        // Il lavoro si fa a fette per poter mostrare la barra; ma il FILE e' uno, e creare una riga
        // a ogni fetta riempirebbe l'elenco di sette righe uguali per un solo caricamento.
        // La prima fetta la crea, le altre si portano dietro il suo identificativo.
        let creaturaFile: string | null = body?.fileId || null
        if (!creaturaFile) {
          const { data: fileRip } = await supabase.from('rettifiche_files').insert({
            master_id: myMaster, nome_file: nomeFile, n_tot_spedizioni: (righe || []).length,
          }).select().single()
          creaturaFile = fileRip?.id || null
        }
        const daScrivere: any[] = []
        let fuoriCatena = 0
        for (const e of esiti) {
          if (!e.trovata || !e.spedizioneId) continue
          // A CHI VA INDIRIZZATA: al FIGLIO DIRETTO di chi carica, non al fondo della catena.
          // La catena arriva dal basso verso il detentore; il figlio diretto e' quello che sta
          // subito PRIMA di me. Se non ci sono master sotto, il destinatario e' il cliente.
          const cat = e.catenaDalBasso || []
          const mio = cat.indexOf(myMaster)
          // "NON SONO NELLA CATENA" NON E' "SONO L'ULTIMO".
          // Con indexOf che torna -1 il conto `mio > 0 ? ... : null` cadeva sullo stesso ramo del
          // caso legittimo `mio === 0`, e la rettifica veniva intestata al CLIENTE FINALE di una
          // spedizione che non e' mia: saltando tutti i master in mezzo, riprezzata sul listino
          // sbagliato, e addebitata alla conferma con la chiave di servizio — che non ricontrolla
          // di chi sia quel cliente. Ci si finisce in tre modi: caricando un file con lettere di
          // vettura altrui, stando sopra il detentore del contratto (la catena si ferma li'), o
          // con una catena rotta a meta'. Il ramo del file dei pesi, in fondo a questo stesso file,
          // la guardia ce l'ha da sempre: "idx === -1 -> scartata".
          if (mio < 0 || e.catenaCompleta === false) { fuoriCatena++; continue }
          const figlio = mio > 0 ? cat[mio - 1] : null
          const liv = figlio
            ? e.livelli.find(l => l.masterId === figlio)
            : e.livelli.find(l => l.clienteId)
          if (!liv || liv.differenza == null) continue
          // Le differenze nulle non diventano una riga: una rettifica da zero euro e' solo rumore
          // nell'elenco di chi la deve guardare.
          if (Math.abs(liv.differenza) < 0.01) continue
          daScrivere.push({
            master_id: myMaster, file_id: creaturaFile,
            spedizione_id: e.spedizioneId, numero_spedizione: e.ldv,
            cliente_id: figlio ? null : liv.clienteId,
            target_master_id: figlio,
            peso_iniziale: e.pesoPrima, peso_volume_iniziale: 0,
            peso_reale: e.pesoDopo, peso_volume_reale: 0,
            costo_iniziale: liv.pagato, costo_finale: liv.dovuto,
            differenza: -liv.differenza,   // la colonna e' "quanto restituisco": un addebito e' negativo
            stato: 'da_rettificare',
            rif_fornitore: e.idOrdine,     // l'anti-doppione: indice unico sul database
            // Le misure viaggiano con la riga: servono a chi la ricevera' per riprezzare col
            // PROPRIO listino quando la gira al livello sotto. La cifra in euro non scende lungo
            // la catena — quella e' il costo di chi sta sopra.
            colli_ripesati: e.colli_ripesati || null,
          })
        }
        let scritte = 0, doppioni = 0
        for (const riga of daScrivere) {
          const { error } = await adminRip.from('rettifiche').insert(riga)
          // 23505 = l'indice unico ha respinto un doppione. E' il comportamento voluto, non un guasto.
          if (!error) scritte++
          else if (error.code === '23505') doppioni++
          else console.error('[RIPESATURE] riga non scritta', riga.numero_spedizione, error.message)
        }

        // ── IL CONTO DEL FORNITORE LO PAGA CHI CARICA, E LO PAGA ADESSO ──
        //
        // Quando questo file arriva, il fornitore ha GIA' mandato la fattura a chi lo sta caricando:
        // quei soldi sono usciti davvero. Poi lui li recupera girando le rettifiche ai livelli sotto
        // — ma il recupero e' una cosa diversa dalla spesa, e finora la spesa non veniva registrata
        // da nessuna parte. Risultato: nei margini chi carica sembrava guadagnare tutta la
        // differenza che addebitava ai sotto-master, mentre una parte non fa che coprire il conto
        // del fornitore. Con 356 euro su un file solo, il margine era gonfiato di altrettanto.
        //
        // Si scala a ogni spedizione TROVATA, non solo a quelle che generano una rettifica verso il
        // basso: il fornitore le ha fatturate tutte, anche quelle che al livello sotto non fanno
        // differenza. Il doppione lo impedisce l'indice unico sul database (l'export del fornitore
        // e' cumulativo: lo stesso ordine ritorna nel file del giorno dopo).
        let fornitoreScalato = 0
        const { registraMovimentoMaster } = await import('@/lib/movimenti')
        for (const e of esiti) {
          if (!e.trovata || !e.spedizioneId || !(e.addebitoFornitore > 0)) continue
          try {
            await registraMovimentoMaster(adminRip, {
              masterOwnerId: myMaster, masterTargetId: myMaster, tipo: 'rettifica',
              descrizione: `Ripesatura ${e.ldv} - costo addebitato dal fornitore`,
              riferimento: `RIPFORN-${e.idOrdine}`,
              importo: -Math.abs(e.addebitoFornitore),
              spedizioneId: e.spedizioneId, createdBy: user.id,
            })
            fornitoreScalato += e.addebitoFornitore
          } catch (err: any) {
            // 23505 = gia' scalato da un caricamento precedente. E' il comportamento voluto.
            if (!String(err?.message || '').includes('23505') && !String(err?.code || '') .includes('23505')) {
              console.error('[RIPESATURE] costo fornitore non scalato', e.ldv, err?.message)
            }
          }
        }
        // I conteggi si SOMMANO a quelli gia' scritti dalle fette precedenti.
        if (creaturaFile) {
          const { data: pre } = await supabase.from('rettifiche_files')
            .select('n_processate,n_trovate,n_scartati,n_da_rettificare').eq('id', creaturaFile).maybeSingle()
          await supabase.from('rettifiche_files').update({
            n_processate: (pre?.n_processate || 0) + fetta.length,
            n_trovate: (pre?.n_trovate || 0) + esiti.filter(e => e.trovata).length,
            n_scartati: (pre?.n_scartati || 0) + esiti.filter(e => !e.trovata).length,
            n_da_rettificare: (pre?.n_da_rettificare || 0) + scritte,
          }).eq('id', creaturaFile)
        }

        return NextResponse.json({
          success: true, tipo: 'ripesature',
          fileId: creaturaFile,
          // Dove siamo arrivati NEL FILE: serve alla barra e a sapere se c'e' un altro pezzo da
          // chiedere. Si conta sul file, non sul lavoro rimasto, che si accorcia mentre lo si fa.
          da, quante: fetta.length, totaleDaFare: totaleFile,
          finito: da + fetta.length >= totaleFile,
          creato: scritte, doppioniRespinti: doppioni, giaCaricate: fetta.length - nuove.length,
          fuoriCatena, costoFornitoreScalato: Math.round(fornitoreScalato * 100) / 100,
          totali: {
            nelFile: (righe || []).length, spedizioni: totaleFile,
            nonTrovate: esiti.filter(e => !e.trovata).length,
            addebitoFornitore: costoFornitoreTotale,
          },
        })
      }
    }
  }

  // RLS: match LDV su tutta la catena (discendenti) -> admin; l'autorizzazione e' il check catena stesso
  const adminDb = createAdminSupabase()

  // ── Dedup del file per LDV: doppioni identici → uno; pesi diversi → anomalia ──
  const perLdv = new Map<string, number[]>()
  for (const rigaRaw of (righe || [])) {
    const riga: any = {}
    for (const k in rigaRaw) { riga[String(k).trim().toLowerCase()] = (rigaRaw as any)[k] }
    const ldv = String(riga['ldv'] || riga['n. spedizione'] || riga['numero'] || '').trim()
    // Con raw:false le celle arrivano come testo: un peso scritto "8,5" va letto 8,5 e non 8.
    const pesoReale = parseFloat(String(riga['peso reale'] || riga['peso_reale'] || riga['pesoreale'] || riga['peso'] || riga['peso volume'] || riga['pesovolume'] || 0).replace(',', '.'))
    if (!ldv) continue
    if (!perLdv.has(ldv)) perLdv.set(ldv, [])
    perLdv.get(ldv)!.push(pesoReale)
  }
  const anomalie: string[] = []
  const daProcessare: { ldv: string, pesoReale: number }[] = []
  for (const [ldv, pesi] of perLdv) {
    const distinti = Array.from(new Set(pesi.map(p => isFinite(p) ? p.toFixed(3) : 'x')))
    if (distinti.length > 1) { anomalie.push(ldv); continue }
    daProcessare.push({ ldv, pesoReale: pesi[0] })
  }

  let nProcessate = 0, nTrovate = 0, nScartati = 0, nDaRettificare = 0
  const { data: fileRec } = await supabase.from('rettifiche_files').insert({
    master_id: myMaster, nome_file: nomeFile, n_tot_spedizioni: (righe || []).length,
  }).select().single()

  const rettificheToInsert: any[] = []
  for (const { ldv, pesoReale } of daProcessare) {
    nProcessate++
    // Ricerca SENZA filtro master: decide la catena (solo discesa)
    const { data: spedizione } = await adminDb.from('spedizioni')
      .select('id,cliente_id,master_id,peso_reale,peso_fatturato,peso_volume,costo_totale,costo_spedizione,numero,dest_provincia,dest_cap,dest_paese,dest_citta,corriere_id,stato,contrassegno,assicurazione,valore_merce,servizi_accessori')
      .or(`numero.ilike.%${ldv}%,tracking_number.ilike.%${ldv}%`)
      .limit(1).single()
    if (!spedizione) { nScartati++; continue }
    // Niente rettifiche su spedizioni ANNULLATE: sono già stornate, aggiungere una rettifica
    // lascerebbe un residuo non rimborsato a ogni livello della catena.
    if ((spedizione as any).stato === 'annullata') { nScartati++; continue }

    // Chi carica deve essere il master della spedizione o un suo ANTENATO
    const catena = await risaliCatena(adminDb, spedizione.master_id)
    const idx = catena.indexOf(myMaster)
    if (idx === -1) { nScartati++; continue }

    // Anti-duplicato: salta se esiste già una rettifica CONFERMATA o IN ATTESA per la spedizione
    // (prima bloccava solo le confermate → si potevano creare doppioni "da_rettificare")
    const { data: giaEsiste } = await supabase.from('rettifiche').select('id').eq('spedizione_id', spedizione.id).or('confermata.eq.true,stato.eq.da_rettificare').limit(1)
    if (giaEsiste && giaEsiste.length > 0) { nScartati++; continue }
    nTrovate++

    const pesoIniziale = Number(spedizione.peso_fatturato || spedizione.peso_reale || 0)

    if (idx === 0) {
      // ── CLIENTE DIRETTO: flusso attuale invariato ──
      const costoIniziale = Number(spedizione.costo_totale || 0)
      let costoFinale = costoIniziale
      const { data: cli } = await supabase.from('clienti').select('listino_cliente_id').eq('id', spedizione.cliente_id).single()
      if (cli?.listino_cliente_id && pesoReale > 0 && spedizione.corriere_id) {
        // LA ZONA SI RICALCOLA COME SI CALCOLA, cioe' col CAP e col comune.
        // Qui si guardava la sola PROVINCIA: le zone agganciate al CAP — isole minori, zone
        // disagiate, Livigno — non hanno un nome che venga fuori dalla provincia, quindi non si
        // trovava nessuna fascia e si ripiegava su "Italia". Una spedizione venduta 14,95 sulla
        // fascia isola sarebbe stata riportata a 5,34, e la differenza rimborsata al cliente:
        // il file dei pesi del corriere avrebbe REGALATO il supplemento dell'isola.
        // La stessa funzione la usa gia' il ramo della catena, qui sotto: una regola sola.
        const ris = await calcolaPrezzoListino(supabase, {
          listinoId: cli.listino_cliente_id, corriereId: spedizione.corriere_id,
          provincia: spedizione.dest_provincia || '', cap: spedizione.dest_cap || '',
          paese: spedizione.dest_paese || 'IT', citta: spedizione.dest_citta || '',
          packages: [{ weight: pesoReale }],   // il peso vero del corriere, senza misure: nessun volumetrico
        })
        // Nessun prezzo = quel contratto non copre quella destinazione (zona esclusiva non
        // prezzata al cliente). Non si inventa una tariffa: si lascia il costo com'e'.
        //
        // LE DUE CIFRE VANNO FATTE CON LA STESSA RICETTA.
        // `costoIniziale` e' costo_totale, cioe' quello che il cliente ha PAGATO: nolo + fee
        // contrassegno + fee assicurazione + servizi accessori scelti. Riprezzando il solo nolo,
        // tutto il resto finiva dentro la differenza col segno POSITIVO. Finche' la conferma
        // prendeva il valore assoluto usciva un addebito sbagliato; col segno rispettato — che e'
        // giusto, un accredito non deve diventare un prelievo — quella stessa differenza diventa
        // una NOTA DI CREDITO vera: su una spedizione con contrassegno da 3 euro di fee, un collo
        // diventato piu' pesante avrebbe REGALATO al cliente la commissione gia' incassata.
        // Le fee si RICALCOLANO sul nolo nuovo, come fa la creazione, perche' certi scaglioni sono
        // in percentuale sul nolo; gli accessori invece si riportano come sono stati addebitati.
        if (ris) {
          const sup = await calcolaSupplementiCliente(supabase, {
            listinoId: cli.listino_cliente_id, corriereId: spedizione.corriere_id,
            contrassegno: Number((spedizione as any).contrassegno || 0),
            assicurazione: Number((spedizione as any).assicurazione || 0),
            valoreMerce: Number((spedizione as any).valore_merce || 0), nolo: ris.prezzo,
          })
          // `disponibile: false` non vuol dire "fee zero", vuol dire "questo listino non prezza
          // contrassegno o assicurazione per questo contratto" — e le due fee tornano 0 senza
          // errore. Sommare quello zero toglierebbe dal dovuto una commissione che il cliente ha
          // gia' pagato, e la rettifica uscirebbe a suo favore. Come quando manca la tariffa: non
          // si inventa niente, si lascia il costo com'e' e non nasce nessuna rettifica.
          if (sup.disponibile) {
            const acc = Array.isArray((spedizione as any).servizi_accessori)
              ? (spedizione as any).servizi_accessori.reduce((a: number, x: any) => a + (Number(x?.importo) || 0), 0)
              : 0
            costoFinale = Math.round((ris.prezzo + sup.contrassegno + sup.assicurazione + acc) * 100) / 100
          }
        }
      }
      const differenza = costoIniziale - costoFinale
      if (Math.abs(differenza) <= 0.01) { continue }
      nDaRettificare++
      rettificheToInsert.push({
        master_id: myMaster, file_id: fileRec?.id, spedizione_id: spedizione.id,
        numero_spedizione: spedizione.numero, cliente_id: spedizione.cliente_id, target_master_id: null,
        peso_iniziale: pesoIniziale, peso_volume_iniziale: Number(spedizione.peso_volume||0),
        peso_reale: pesoReale || pesoIniziale, peso_volume_reale: 0,
        costo_iniziale: costoIniziale, costo_finale: costoFinale, differenza,
        stato: 'da_rettificare',
      })
    } else {
      // ── CATENA: la rettifica si ferma al primo master sotto di me ──
      const targetMasterId = catena[idx - 1]
      const { data: tm } = await adminDb.from('masters').select('parent_listino_id').eq('id', targetMasterId).maybeSingle()
      if (!tm?.parent_listino_id) { nScartati++; continue }
      const pesoRicalcolo = pesoReale || pesoIniziale
      const prezzoIni = await calcolaPrezzoListino(adminDb, {
        listinoId: tm.parent_listino_id, provincia: spedizione.dest_provincia || '',
        cap: spedizione.dest_cap || '', paese: spedizione.dest_paese || 'IT', citta: spedizione.dest_citta || '',
        packages: [{ weight: pesoIniziale || 1 }], corriereId: spedizione.corriere_id,
      })
      const prezzoFin = await calcolaPrezzoListino(adminDb, {
        listinoId: tm.parent_listino_id, provincia: spedizione.dest_provincia || '',
        cap: spedizione.dest_cap || '', paese: spedizione.dest_paese || 'IT', citta: spedizione.dest_citta || '',
        packages: [{ weight: pesoRicalcolo }], corriereId: spedizione.corriere_id,
      })
      if (!prezzoIni || !prezzoFin) { nScartati++; continue }
      const costoIniziale = prezzoIni.prezzo
      const costoFinale = prezzoFin.prezzo
      const differenza = costoIniziale - costoFinale
      if (Math.abs(differenza) <= 0.01) { continue }
      nDaRettificare++
      rettificheToInsert.push({
        master_id: myMaster, file_id: fileRec?.id, spedizione_id: spedizione.id,
        numero_spedizione: spedizione.numero, cliente_id: null, target_master_id: targetMasterId,
        peso_iniziale: pesoIniziale, peso_volume_iniziale: Number(spedizione.peso_volume||0),
        peso_reale: pesoRicalcolo, peso_volume_reale: 0,
        costo_iniziale: costoIniziale, costo_finale: costoFinale, differenza,
        stato: 'da_rettificare',
      })
    }
  }

  if (rettificheToInsert.length > 0) await supabase.from('rettifiche').insert(rettificheToInsert)
  await supabase.from('rettifiche_files').update({
    n_processate: nProcessate, n_trovate: nTrovate, n_scartati: nScartati, n_da_rettificare: nDaRettificare,
  }).eq('id', fileRec?.id)
  return NextResponse.json({ success: true, fileId: fileRec?.id, nProcessate, nTrovate, nScartati, nDaRettificare, anomalie })
}
