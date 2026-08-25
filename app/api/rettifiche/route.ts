import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'
import { gestisceLaRete, vedeLaRete } from '@/lib/ruoli'
import { fetchAll } from '@/lib/fetch-all'

// Confermare cento rettifiche vuol dire cento chiamate di credito in fila. Col limite di durata
// breve la funzione veniva uccisa a meta' — ed e' proprio meta' lavoro fatto il caso peggiore.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // L'elenco delle rettifiche e' roba di chi le deve girare, non di chi le deve pagare: l'agente le
  // vede filtrate sui suoi clienti (piu' sotto), il cliente non le vede affatto. Serviva anche a
  // procurarsi gli id da passare alla cancellazione.
  if (!vedeLaRete(utente)) return NextResponse.json([])
  const fileId = req.nextUrl.searchParams.get('fileId')
  const filtroAgente = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  // fetchAll: senza, oltre 1000 rettifiche da confermare non comparivano (e non erano confermabili).
  const build = () => {
    let q = supabase.from('rettifiche')
      .select('*, clienti(ragione_sociale), masters:target_master_id(nome)')
      .eq('master_id', utente?.master_id)
      .eq('confermata', false)
      .order('created_at', { ascending: false })
    if (filtroAgente) q = q.in('cliente_id', filtroAgente)
    if (fileId) q = q.eq('file_id', fileId)
    return q
  }
  const data = await fetchAll(build)

  // IL NOME DEL DESTINATARIO NON SI PUO' LEGGERE CON LA SESSIONE DI CHI GUARDA.
  //
  // Le regole per-inquilino su `masters` mostrano a un master SOLO SE STESSO: provato con la
  // sessione vera di MULTIEXPRESS, vede le sue 106 rettifiche ma zero dei quattro sotto-master a
  // cui sono indirizzate, e un solo master in tutto. Quindi la relazione incorporata tornava
  // `null` e la schermata scriveva "(senza destinatario)" su tutti i gruppi.
  //
  // Non e' un buco da aprire allargando le regole: il nome dei propri destinatari e' roba che
  // questo master ha il diritto di vedere, ma solo per le righe CHE SONO SUE. Quindi si risolve
  // qui, con la chiave di servizio, e SOLO sui destinatari che compaiono nelle sue rettifiche —
  // che sono gia' filtrate per master_id poche righe sopra. Nessun altro nome esce da qui.
  const righeGrezze = data || []

  // PERCHE' UNA RIGA NON SI PUO' CONFERMARE, scritto sulla riga stessa.
  // La conferma rifiuta le rettifiche su spedizioni in annullo — giusto, perche' quel pacco sta per
  // essere stornato e addebitargli una ripesatura lascerebbe un residuo su una spedizione che non
  // ha mai viaggiato. Ma finora quelle righe restavano in elenco identiche alle altre: si premeva
  // Conferma, sparivano tutte tranne una, e non c'era modo di sapere se fosse una scelta o un
  // guasto. Ora lo stato della spedizione arriva insieme alla riga.
  const idSped = [...new Set(righeGrezze.map((r: any) => r.spedizione_id).filter(Boolean))]
  const statoSped = new Map<string, string>()
  if (idSped.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adm = createAdminSupabase()
    for (let i = 0; i < idSped.length; i += 300) {
      const { data: ss } = await adm.from('spedizioni').select('id,stato').in('id', idSped.slice(i, i + 300))
      for (const s of (ss || [])) statoSped.set((s as any).id, (s as any).stato)
    }
  }
  const bloccoDi = (r: any) => {
    const st = r.spedizione_id ? statoSped.get(r.spedizione_id) : null
    if (st === 'annullata') return 'Spedizione annullata: non si addebita'
    if (st === 'annullamento_pending' || st === 'annullamento_manuale') return 'Spedizione in annullo: si conferma solo se l\'annullo non va a buon fine'
    return null
  }

  const idMaster = [...new Set(righeGrezze.map((r: any) => r.target_master_id).filter(Boolean))]
  const idClienti = [...new Set(righeGrezze.map((r: any) => r.cliente_id).filter(Boolean))]
  const nomi = new Map<string, string>()
  if (idMaster.length || idClienti.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    if (idMaster.length) {
      const { data: mm } = await admin.from('masters').select('id,nome').in('id', idMaster)
      for (const m of (mm || [])) nomi.set(m.id, m.nome)
    }
    if (idClienti.length) {
      const { data: cc } = await admin.from('clienti').select('id,ragione_sociale').in('id', idClienti)
      for (const c of (cc || [])) nomi.set(c.id, c.ragione_sociale)
    }
  }
  const righe = righeGrezze.map((r: any) => ({
    ...r,
    destinatario_nome: nomi.get(r.target_master_id) || nomi.get(r.cliente_id) || null,
    destinatario_tipo: r.target_master_id ? 'master' : (r.cliente_id ? 'cliente' : null),
    blocco: bloccoDi(r),
  }))
  return NextResponse.json(righe)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // Il ruolo, non la sola appartenenza: `master_id` ce l'hanno anche i clienti, e qui sotto si
  // muove credito con la chiave di servizio, che scavalca le regole per riga.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const { rettificaIds } = body
  if (!rettificaIds?.length) return NextResponse.json({ error: 'Nessuna rettifica selezionata' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminDb = createAdminSupabase()

  // A LOTTI, non in un colpo solo. Con centinaia di rettifiche selezionate — l'harvester delle
  // ripesature ne accumula a migliaia — un unico `.in('id', [...])` costruisce verso PostgREST una
  // URL enorme (694 id ≈ 25 KB) che viene respinta: `data` torna vuoto e la schermata diceva
  // "Nessuna rettifica trovata" pur avendone centinaia in attesa. Si legge a fette da 200.
  const rettifiche: any[] = []
  for (let i = 0; i < rettificaIds.length; i += 200) {
    const { data } = await supabase.from('rettifiche')
      .select('*')
      .in('id', rettificaIds.slice(i, i + 200))
      .eq('master_id', utente?.master_id)
      .eq('confermata', false)
    if (data?.length) rettifiche.push(...data)
  }
  if (!rettifiche.length) return NextResponse.json({ error: 'Nessuna rettifica trovata (o gia\' confermata da un altro invio).' }, { status: 404 })

  // Se qualcosa va storto su una riga, quella riga TORNA APERTA: non deve restare archiviata come
  // fatta senza che i soldi si siano mossi. Prima i due `catch` si limitavano a scrivere nel log e
  // la chiusura passava lo stesso su tutti gli id — un addebito fallito spariva dall'elenco e da
  // ogni traccia, e nessuno poteva accorgersene se non riconciliando i movimenti a mano.
  const saltate: { id: string; perche: string }[] = []
  const riapriRiga = async (r: any, perche: string) => {
    saltate.push({ id: r.id, perche })
    await supabase.from('rettifiche').update({ confermata: false, stato: 'da_rettificare' }).eq('id', r.id)
  }

  // A CHI STO PER SCALARE IL CREDITO E' DAVVERO ROBA MIA?
  // La riga porta con se' destinatario e importo, e fin qui nessuno li aveva mai ricontrollati: si
  // passavano tali e quali alla funzione di credito, invocata con la chiave di servizio, che sotto
  // quel ruolo salta i propri controlli di appartenenza. Chi riesce a scrivere una riga in
  // `rettifiche` (la tabella e' esposta) sceglie destinatario e cifra. Quindi qui si verifica che il
  // master destinatario stia DAVVERO sotto di me — e siccome la mappa non contiene me stesso, una
  // riga intestata a se' stessi non passa — e che il cliente sia DAVVERO un mio cliente.
  const { mappaPrimaLinea } = await import('@/lib/prima-linea')
  const discendenti = await mappaPrimaLinea(adminDb, utente!.master_id)
  const idClienti = [...new Set(rettifiche.map((r: any) => r.cliente_id).filter(Boolean))]
  const mieiClienti = new Set<string>()
  if (idClienti.length) {
    const { data: cc } = await adminDb.from('clienti').select('id').eq('master_id', utente!.master_id).in('id', idClienti)
    for (const c of (cc || [])) mieiClienti.add((c as any).id)
  }

  // Fra il caricamento e la conferma passano giorni, e la finestra di annullo e' di 48 ore: una
  // spedizione annullata nel frattempo e' gia' stata stornata, e lo storno non ripassa. Una
  // rettifica confermata dopo resterebbe addosso a un pacco che non ha mai viaggiato.
  const idSped = [...new Set(rettifiche.map((r: any) => r.spedizione_id).filter(Boolean))]
  const statoSped = new Map<string, string>()
  for (let i = 0; i < idSped.length; i += 300) {
    const { data: ss } = await adminDb.from('spedizioni').select('id,stato').in('id', idSped.slice(i, i + 300))
    for (const s of (ss || [])) statoSped.set((s as any).id, (s as any).stato)
  }
  const annullata = (r: any) => {
    const st = r.spedizione_id ? statoSped.get(r.spedizione_id) : null
    return st === 'annullata' || st === 'annullamento_pending' || st === 'annullamento_manuale'
  }

  // Il peso su cui si rettifica è il MAGGIORE fra reale e volumetrico ripesato. Sulla lista movimenti
  // va scritto QUELLO (spesso il volume: un pacco di 2 kg reali ma 30 kg volumetrici si rettifica sui
  // 30) — altrimenti "peso scansione 2 Kg" con un addebito sembra un errore, mentre la rettifica è sul
  // volume. È lo stesso peso che si usa per aggiornare spedizioni.peso_fatturato qui sotto.
  const pesoFatt = (r: any) => Math.max(Number(r.peso_reale) || 0, Number(r.peso_volume_reale) || 0)
  const dimDi = (r: any) => {
    const c = Array.isArray(r.colli_ripesati) ? r.colli_ripesati[0] : null
    return c && Number(c.length) && Number(c.width) && Number(c.height) ? ` dim ${c.length}x${c.width}x${c.height}cm` : ''
  }
  // La descrizione MOTIVA il movimento: la parte ripesatura (peso inserito → ripesato) e, se c'e', il
  // supplemento fuori sagoma come voce a sé con le sue dimensioni — così un addebito da 16,39 su un
  // pacco lungo si spiega da solo. Se la riga è SOLO fuori sagoma (nessuna ripesatura) si scrive solo
  // quella, senza il fuorviante "peso inserito X - peso ripesato X".
  const descrizione = (r: any) => {
    const extraFS = Number(r.fuori_sagoma) || 0
    const haReweigh = Number(r.differenza || 0) < -0.005
    const parti: string[] = []
    if (haReweigh) {
      const f = pesoFatt(r)
      const vol = (Number(r.peso_volume_reale) || 0) > (Number(r.peso_reale) || 0)
      parti.push(`Rettifica ${r.numero_spedizione} ( Peso inserito: ${r.peso_iniziale} Kg - peso ripesato: ${f} Kg${vol ? ' volumetrico' : ''} )`)
    }
    if (extraFS > 0) parti.push(`Supplemento fuori sagoma ${r.numero_spedizione} €${extraFS.toFixed(2)}${dimDi(r)}`)
    return parti.length ? parti.join(' + ') : `Rettifica ${r.numero_spedizione}`
  }

  const { registraMovimentoMaster } = await import('@/lib/movimenti')
  let mosse = 0
  const spedizioniDaAggiornare: any[] = []

  for (const r of rettifiche as any[]) {
    // PRESA ATOMICA, UNA RIGA ALLA VOLTA.
    // Serve contro il doppio addebito: due schede, o un secondo invio dopo che il primo e' andato
    // in timeout mentre ancora girava, rileggevano le stesse righe ancora aperte e addebitavano una
    // seconda volta. La condizione sta nel WHERE, quindi chi arriva secondo non si prende la riga.
    // MA LA PRESA E' PER RIGA, NON PER TUTTE. Chiudendole tutte in blocco prima di muovere un euro,
    // una funzione uccisa a meta' lasciava le rimanenti marcate "confermate" senza nessun movimento:
    // sparivano dall'elenco (che filtra confermata = false) e i soldi non si incassavano piu', senza
    // un errore da nessuna parte. Un doppio addebito e' sbagliato ma SI VEDE nei movimenti; un
    // incasso perso in silenzio non lo trova nessuno. Cosi' la finestra vale una riga sola.
    const { data: presa } = await supabase.from('rettifiche')
      .update({ confermata: true, stato: 'confermata' })
      .eq('id', r.id).eq('master_id', utente!.master_id).eq('confermata', false)
      .select('id')
    if (!presa?.length) { saltate.push({ id: r.id, perche: 'gia\' confermata da un altro invio' }); continue }

    // SEGNO: differenza = costo_iniziale - costo_finale, quindi negativa = addebito e positiva =
    // accredito. Il ramo dei master lo rispettava, quello dei clienti prendeva il valore assoluto e
    // scriveva sempre un addebito: una nota di credito da 2,15 diventava un prelievo di 2,15, cioe'
    // 4,30 di scarto nella direzione opposta a quella mostrata a chi preme Conferma — e proprio nei
    // casi frequenti, visto che quasi meta' dei colli ripesati misura MENO del dichiarato.
    const diff = Number(r.differenza || 0)
    // FUORI SAGOMA: supplemento FISSO da addebitare IN AGGIUNTA alla differenza. differenza negativa
    // = addebito, quindi si SOTTRAE (più negativo): importo = diff - fuori_sagoma. Un SOLO movimento
    // (stessa chiave RIP-): l'anti-doppio è l'indice unico su quel riferimento, un secondo movimento
    // lo violerebbe e i 16,39 andrebbero persi. Cascata invariata: ogni livello risconta lo stesso 16,39.
    const extraFS = Number(r.fuori_sagoma) || 0
    const importoAddebito = Math.round((diff - extraFS) * 100) / 100
    // SOLO RECUPERI, MAI RIMBORSI, e questa e' la PORTA UNICA dove il credito si muove: qualunque
    // flusso l'abbia creata (file ripesature, file pesi, propagazione di rete), un accredito qui non
    // passa. Il gate guarda l'importo TOTALE (differenza + fuori sagoma): una riga di solo fuori
    // sagoma ha differenza 0 ma importo -16,39, e NON deve essere scartata. Importo zero O positivo:
    // niente da muovere, ma la riga resta CHIUSA (riaprirla la rimetterebbe in elenco per sempre).
    if (importoAddebito >= -0.005) continue
    if (annullata(r)) { await riapriRiga(r, 'spedizione annullata dopo il caricamento'); continue }

    // UN PACCO NON SI RETTIFICA DUE VOLTE ALLO STESSO DESTINATARIO. Questa e' la PORTA UNICA dove il
    // credito si muove: qui converge OGNI pipeline (file ripesature, file pesi, cascata di rete,
    // OneTracking). Chiave deterministica RIP-<spedizione>-<destinatario>: se esiste gia' un movimento
    // rettifica con quel riferimento, la seconda NON si addebita. E' il doppio addebito reale a ILARIA
    // PITTALIS (3UW1WLJ008099): il file MISURE di MULTIEXPRESS in cascata (volumetrico 16 kg) + il file
    // PESI di Velox (reale 5,65) -> due addebiti. La riga resta CHIUSA (gia' presa atomicamente), come
    // per il caso diff>=0: NON si riapre, altrimenti tornerebbe in elenco per sempre. La garanzia vera
    // e' l'indice unico su movimenti(riferimento) per 'RIP-%'; questo pre-controllo evita solo il throw.
    const rifRett = r.spedizione_id ? `RIP-${r.spedizione_id}-${r.target_master_id || r.cliente_id}` : null
    if (rifRett) {
      const { data: giaRett } = await adminDb.from('movimenti').select('id').eq('riferimento', rifRett).limit(1).maybeSingle()
      if (giaRett) { saltate.push({ id: r.id, perche: 'gia\' rettificata per questa spedizione (evitato doppio addebito)' }); continue }
    }

    try {
      if (r.target_master_id) {
        if (!discendenti.has(r.target_master_id)) { await riapriRiga(r, 'destinatario non e\' un master della tua rete'); continue }
        await registraMovimentoMaster(adminDb, {
          masterOwnerId: utente!.master_id, masterTargetId: r.target_master_id,
          tipo: 'rettifica', descrizione: descrizione(r), importo: importoAddebito,
          riferimento: rifRett, spedizioneId: r.spedizione_id || null, createdBy: user.id,
        })
      } else if (r.cliente_id) {
        if (!mieiClienti.has(r.cliente_id)) { await riapriRiga(r, 'il cliente non e\' tuo'); continue }
        await registraMovimento(adminDb, {
          masterId: utente!.master_id, clienteId: r.cliente_id,
          tipo: 'rettifica', descrizione: descrizione(r), importo: importoAddebito,
          riferimento: rifRett, spedizioneId: r.spedizione_id || null, createdBy: user.id,
        })
        // Il costo_totale/peso_fatturato della spedizione si aggiorna SOLO se c'è stata una vera
        // ripesatura (diff<0): un fuori sagoma puro (diff=0) non cambia il nolo, e riscrivere
        // peso_fatturato col peso ripesato lo abbasserebbe sotto il fatturato reale.
        if (r.spedizione_id && diff < -0.005) spedizioniDaAggiornare.push(r)
      } else { await riapriRiga(r, 'nessun destinatario'); continue }
      mosse++
    } catch (e: any) {
      const m = String(e?.message || '')
      // Doppione intercettato dall'indice unico su movimenti(riferimento) 'RIP-%' (race fra due
      // conferme simultanee): il doppio addebito e' gia' stato evitato, e' il comportamento voluto —
      // NON si riapre la riga (e' consumata correttamente).
      if (/23505|duplicate key|unique/i.test(m)) {
        saltate.push({ id: r.id, perche: 'gia\' rettificata per questa spedizione (evitato doppio addebito)' })
      } else {
        console.error('[RETTIFICHE] addebito non riuscito', r.numero_spedizione, e?.message)
        await riapriRiga(r, 'addebito non riuscito')
      }
    }
  }

  // Il costo della spedizione si aggiorna SOLO se l'addebito e' andato a buon fine: prima si
  // riscriveva comunque, e restava a sistema una spedizione riprezzata che nessuno aveva pagato.
  for (const r of spedizioniDaAggiornare) {
    // peso_fatturato = il MAGGIORE fra reale e volumetrico ripesato (non il solo peso reale): è quello
    // che è stato davvero fatturato col ricalcolo. Prima ci scriveva peso_reale e, quando vinceva il
    // volume, la spedizione restava con un peso fatturato più basso del costo che le era stato messo.
    await supabase.from('spedizioni').update({
      costo_totale: r.costo_finale, peso_fatturato: pesoFatt(r),
    }).eq('id', r.spedizione_id)
  }

  return NextResponse.json({ success: true, rettificate: mosse, nonEseguite: saltate.length, dettaglio: saltate })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // CHI DEVE PAGARE NON PUO' CANCELLARE IL PROPRIO ADDEBITO.
  // Il filtro era solo `master_id`, che un utente cliente ce l'ha uguale a quello del suo master, e
  // `bloccaAgente` ferma l'agente ma non il cliente: bastavano due chiamate col suo cookie — una per
  // leggersi l'id della rettifica, una per cancellarla — e la ripesatura non veniva mai addebitata.
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const { rettificaIds } = body
  if (!rettificaIds?.length) return NextResponse.json({ error: 'Nessuna rettifica selezionata' }, { status: 400 })
  // A LOTTI come la conferma: con centinaia di id un solo `.in()` sfora la URL verso PostgREST.
  let eliminate = 0
  for (let i = 0; i < rettificaIds.length; i += 200) {
    const fetta = rettificaIds.slice(i, i + 200)
    const { error } = await supabase.from('rettifiche')
      .delete()
      .in('id', fetta)
      .eq('master_id', utente?.master_id)
      .eq('confermata', false)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    eliminate += fetta.length
  }
  return NextResponse.json({ success: true, eliminate })
}
