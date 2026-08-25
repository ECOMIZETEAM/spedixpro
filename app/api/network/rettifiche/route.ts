import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Riprezzare una spedizione vuol dire ricostruire tutta la sua catena: su un blocco intero sono
// centinaia di viaggi al database.
export const maxDuration = 300

// COSA FA UN MASTER CON UNA RETTIFICA CHE HA RICEVUTO.
//
// Due strade sole, e sono quelle dei contrassegni:
//   ASSORBITA  -> me la tengo. Il credito me l'hanno gia' scalato quando il livello di sopra ha
//                 confermato: qui non si muove piu' niente, si prende atto.
//   PROPAGATA  -> la giro al livello sotto. NON si passa la cifra in euro — quella e' il costo di
//                 chi sta sopra: si RIPREZZA il collo vero col listino di chi la riceve, che ha le
//                 sue fasce. Nasce una rettifica MIA, indirizzata al mio figlio diretto (sotto-master
//                 o cliente), che finisce nella MIA "Rettifica Costi" ancora in attesa.
//
// E li' si ferma. I soldi al livello sotto si muovono quando SCELGO di caricargliela e premo
// Conferma, non adesso: propagare prepara, non addebita. E' la stessa forma dei contrassegni —
// accetto, poi decido a chi e quali, e solo allora scende.
//
// Prima questo tasto scriveva soltanto un'etichetta sulla riga del padre: non creava niente, non
// muoveva niente, e la rettifica moriva li'.

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  // Il ruolo, non l'elenco di quelli da tenere fuori: escludendo il solo 'cliente' passava
  // l'AUTISTA, che un master_id ce l'ha (3 in produzione) — e qui sotto si legge e si scrive con la
  // chiave di servizio, che scavalca le regole per riga.
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const body = await req.json().catch(() => ({}))
  const decisione = body?.decisione
  // Un blocco alla volta, non una riga alla volta: chi riceve cinquantasette rettifiche dallo
  // stesso file le accetta in un gesto. La forma singola resta per non rompere chi la usa.
  const ids: string[] = Array.isArray(body?.rettifica_ids)
    ? body.rettifica_ids.filter(Boolean)
    : (body?.rettifica_id ? [body.rettifica_id] : [])
  if (!ids.length || !['propagata', 'assorbita', null].includes(decisione)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const adminDb = createAdminSupabase()

  // SOLO LE MIE, E SOLO QUELLE GIA' ADDEBITATE.
  // Una rettifica che il livello di sopra non ha ancora confermato non e' mia: non mi e' stato
  // tolto un euro, e girarla al livello sotto vorrebbe dire incassare qualcosa che non ho pagato.
  const { data: tutteMie } = await adminDb.from('rettifiche')
    .select('id,spedizione_id,numero_spedizione,peso_iniziale,peso_reale,colli_ripesati,rif_fornitore,propagazione,fuori_sagoma')
    .in('id', ids).eq('target_master_id', mio).eq('confermata', true)

  // IN ATTESA SOPRA: rettifiche che HAI selezionato, tue (target=mio), ma che il livello di SOPRA non
  // ha ancora CONFERMATO. Non sono girabili (non ti è stato scalato niente) — ma NON sono perse: prima
  // sparivano in silenzio dal conteggio, ed è ESATTAMENTE la sensazione "non me le porta tutte". Ora si
  // contano e si dicono, così sai che aspettano solo una conferma sopra e le ritenti dopo.
  const { data: attesaSopra } = await adminDb.from('rettifiche')
    .select('numero_spedizione').in('id', ids).eq('target_master_id', mio).eq('confermata', false)
  const attesaLdv = (attesaSopra || []).map((r: any) => r.numero_spedizione)

  if (!tutteMie?.length) {
    return NextResponse.json({
      error: attesaLdv.length
        ? `Nessuna girabile adesso: ${attesaLdv.length} ${attesaLdv.length === 1 ? 'è in attesa' : 'sono in attesa'} che il livello sopra le confermi. NON sono perse — riprova quando saranno confermate.`
        : 'Nessuna rettifica tua fra quelle indicate (o non ancora confermata da chi te l\'ha girata).',
      inAttesaSopra: attesaLdv.length, dettaglioAttesaSopra: attesaLdv.slice(0, 100),
    }, { status: 404 })
  }
  // Si agisce SOLO su quelle ANCORA DA DECIDERE. Se il browser e' rimasto aperto da prima (pagina
  // "stale") e rimanda righe gia' decise, non si rifa' il lavoro: ne' la propagazione lenta a vuoto
  // (le figlie ci sono gia', l'indice le respinge tutte, e intanto la pagina sembra piantata), ne' un
  // "assorbi" che sovrascriverebbe una propagazione gia' fatta. Si risponde chiaro, non "non fa nulla".
  const righe = (tutteMie as any[]).filter(r => !r.propagazione)
  if (!righe.length) {
    return NextResponse.json({ ok: true, assorbite: 0, create: 0, giaDecise: tutteMie.length, inAttesaSopra: attesaLdv.length,
      messaggio: `Queste ${tutteMie.length} rettifiche erano già state decise: non c'è altro da fare.${attesaLdv.length ? ` (Altre ${attesaLdv.length} sono in attesa che il livello sopra le confermi.)` : ''} Aggiorna la pagina.` })
  }

  if (decisione !== 'propagata') {
    await adminDb.from('rettifiche').update({ propagazione: decisione }).in('id', righe.map((r: any) => r.id))
    return NextResponse.json({ ok: true, assorbite: righe.length, inAttesaSopra: attesaLdv.length })
  }

  const { calcolaRipesature } = await import('@/lib/ripesature-calcolo')
  let create = 0
  const saltate: { ldv: string; perche: string }[] = []
  const idFatte: string[] = []      // figlia creata (o già esistente) → 'propagata'
  const idAzzerate: string[] = []   // differenza a zero → 'assorbita'. Tutte le ALTRE saltate NON
                                    // vengono più marcate: restano propagazione=null e ritentabili.

  for (const r of righe as any[]) {
    const colli = Array.isArray(r.colli_ripesati) ? r.colli_ripesati : []
    if (!colli.length) {
      // Senza le misure si potrebbe riprezzare col solo peso, ma il supplemento lo fa il VOLUME:
      // meta' delle righe uscirebbe negativa, cioe' un rimborso al posto di un addebito. Meglio
      // dirlo che tirare a indovinare su dei soldi.
      saltate.push({ ldv: r.numero_spedizione, perche: 'senza le misure ripesate: caricata prima che venissero conservate' })
      continue
    }
    if (!r.spedizione_id) { saltate.push({ ldv: r.numero_spedizione, perche: 'spedizione non collegata' }); continue }

    // Si riusa lo STESSO motore del caricamento del file: ricostruisce la catena, legge dai
    // movimenti quello che ogni livello ha gia' pagato — rettifiche comprese, cosi' la stessa
    // differenza non si chiede due volte — e riprezza il collo vero a ogni livello col suo listino.
    const [esito] = await calcolaRipesature(adminDb, [{
      idOrdine: r.rif_fornitore || r.id, idVerifiche: [], ldv: r.numero_spedizione,
      addebitoFornitore: 0,
      colli: colli.map((c: any) => ({
        peso: Number(c.weight) || 0, lunghezza: Number(c.length) || 0,
        larghezza: Number(c.width) || 0, altezza: Number(c.height) || 0,
      })),
      dataChiusura: '', mittente: '', destinatario: '',
    }])
    if (!esito?.trovata) { saltate.push({ ldv: r.numero_spedizione, perche: esito?.motivo || 'spedizione non trovata' }); continue }
    if (esito.catenaCompleta === false) { saltate.push({ ldv: r.numero_spedizione, perche: 'catena dei listini incompleta' }); continue }

    // A CHI: il mio figlio DIRETTO, quello subito prima di me nella catena. Se sotto di me non c'e'
    // nessun master, il destinatario e' il cliente. "Non sono nella catena" (indice -1) non e' "sono
    // l'ultimo": in quel caso non si scrive niente, altrimenti la rettifica cadrebbe addosso al
    // cliente finale di un ramo che non e' mio.
    const cat = esito.catenaDalBasso || []
    const idx = cat.indexOf(mio)
    if (idx < 0) { saltate.push({ ldv: r.numero_spedizione, perche: 'non sei nella catena di questa spedizione' }); continue }
    const figlio = idx > 0 ? cat[idx - 1] : null
    const liv = figlio
      ? esito.livelli.find(l => l.masterId === figlio)
      : esito.livelli.find(l => l.clienteId)
    const fs = Number(r.fuori_sagoma) || 0
    // Senza il livello del figlio non c'e' nulla su cui costruire la figlia (ne' costo ne' il cliente
    // destinatario): resta da decidere, ritentabile.
    if (!liv) { saltate.push({ ldv: r.numero_spedizione, perche: 'catena/listino del livello sotto non ricostruito: riprova quando sara\' disponibile' }); continue }
    // SOLO RECUPERI, MAI RIMBORSI: la RIPESATURA si gira solo se il listino del figlio prezza il collo
    // (dovuto non null) e c'e' qualcosa da recuperare (differenza >= 0.01). Il FUORI SAGOMA invece e'
    // un importo FISSO che per regola scende INVARIATO a prescindere dal listino: se c'e', la figlia
    // si crea COMUNQUE — anche quando il collo ripesato e' oltre la fascia massima del figlio — con la
    // sola parte ripesatura a zero, altrimenti il supplemento si fermerebbe a questo livello.
    const reweighGirabile = liv.differenza != null && liv.differenza >= 0.01
    if (!reweighGirabile && fs === 0) {
      // Niente supplemento e niente ripesatura da girare: se il listino non copre proprio il collo
      // (differenza null) e' ritentabile; se lo copre ma esce <= 0 e' una scelta presa (assorbita).
      if (liv.differenza == null) { saltate.push({ ldv: r.numero_spedizione, perche: 'il listino di chi sta sotto non copre questa spedizione (peso ripesato oltre la fascia massima, o destinazione/zona non prevista): non è girabile, va tenuta a tuo carico ("Le assorbo io")' }); continue }
      saltate.push({ ldv: r.numero_spedizione, perche: 'niente da recuperare al livello sotto (rimborso o zero): tenuta a tuo carico' }); idAzzerate.push(r.id); continue
    }
    const diffFiglia = reweighGirabile ? liv.differenza : 0

    const { error } = await adminDb.from('rettifiche').insert({
      master_id: mio, spedizione_id: esito.spedizioneId, numero_spedizione: esito.ldv,
      cliente_id: figlio ? null : liv.clienteId,
      target_master_id: figlio,
      peso_iniziale: esito.pesoRealePrima, peso_volume_iniziale: esito.pesoVolumePrima,   // dichiarato: reale + volumetrico
      peso_reale: esito.pesoDopo, peso_volume_reale: esito.pesoVolumeDopo,   // il volume, cosi' si vede perche' il costo sale
      costo_iniziale: liv.pagato, costo_finale: liv.dovuto ?? liv.pagato,   // dovuto null (collo oltre fascia, solo fuori sagoma) → pari a pagato, differenza 0
      differenza: -diffFiglia,            // la colonna e' "quanto restituisco": un addebito e' negativo (0 se solo fuori sagoma)
      fuori_sagoma: fs,                   // il supplemento fisso scende INVARIATO, NON si riprezza
      stato: 'da_rettificare', confermata: false,
      colli_ripesati: colli,              // le misure continuano a scendere, per il livello dopo
      origine_rettifica_id: r.id,         // l'anti-doppione: si propaga una volta sola
    })
    // 23505 = l'indice unico ha respinto una seconda propagazione della stessa riga. Voluto.
    if (!error) { create++; idFatte.push(r.id) }
    else if (error.code === '23505') { saltate.push({ ldv: r.numero_spedizione, perche: 'gia\' propagata' }); idFatte.push(r.id) }
    else { console.error('[RETTIFICHE][PROPAGA]', r.numero_spedizione, error.message); saltate.push({ ldv: r.numero_spedizione, perche: 'non riuscita' }) }
  }

  // Si segna lo stato SOLO su chi è stato davvero deciso: 'propagata' chi ha (o già aveva) una figlia,
  // 'assorbita' chi non aveva nulla da addebitare. Tutte le altre saltate RESTANO propagazione=null e
  // rimangono nell'elenco "da decidere": si ritentano dopo aver sistemato la causa (listino del livello
  // sotto mancante, misure non salvate, catena incompleta), invece di sparire assorbite in silenzio —
  // era il motivo per cui la rettifica arrivava a un sotto-master (es. Ecomize LL) ma lui non poteva
  // né vederla né addebitarla, e non era più recuperabile.
  if (idFatte.length) await adminDb.from('rettifiche').update({ propagazione: 'propagata' }).in('id', idFatte)
  if (idAzzerate.length) await adminDb.from('rettifiche').update({ propagazione: 'assorbita' }).in('id', idAzzerate)

  const ritentabili = righe.length - idFatte.length - idAzzerate.length
  return NextResponse.json({
    ok: true, create, nonPropagate: saltate.length, ritentabili,
    // NON troncato più a 20: chi deve sistemare le saltate (misure mancanti, listino sotto, catena)
    // deve poterle vedere TUTTE, altrimenti oltre la ventesima "spariscono" e sembrano perse.
    dettaglio: saltate,
    inAttesaSopra: attesaLdv.length, dettaglioAttesaSopra: attesaLdv.slice(0, 100),
  })
}
