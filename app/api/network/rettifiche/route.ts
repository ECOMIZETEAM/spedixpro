import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase, createAdminSupabaseConMemoria } from '@/lib/supabase-admin'
import { controllaListiniClienti, daSistemareDaMotivo, type DaSistemare } from '@/lib/network-da-fare'
import type { ContoSotto } from '@/lib/rettifiche-perche'
import { CAMPI_CARICA, primaDelMotore, ingressoMotore, decidiCarica, contoDelLivello } from '@/lib/network-carica'

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
  // A BLOCCHI DI 500: anche chiedendo per id, il database ne torna al massimo mille per volta. Con
  // 2.215 righe selezionate (successo il 29/09/2026) se ne sarebbero girate mille e le altre
  // sarebbero rimaste ferme, senza un errore da nessuna parte.
  const tutteMie: any[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await adminDb.from('rettifiche')
      .select(CAMPI_CARICA)
      .in('id', ids.slice(i, i + 500)).eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true)
    if (error) { console.error('[NETWORK] lettura rettifiche selezionate:', error.message); break }
    tutteMie.push(...(data || []))
  }

  // IN ATTESA SOPRA: rettifiche che HAI selezionato, tue (target=mio), ma che il livello di SOPRA non
  // ha ancora CONFERMATO. Non sono girabili (non ti è stato scalato niente) — ma NON sono perse: prima
  // sparivano in silenzio dal conteggio, ed è ESATTAMENTE la sensazione "non me le porta tutte". Ora si
  // contano e si dicono, così sai che aspettano solo una conferma sopra e le ritenti dopo.
  const attesaSopra: any[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await adminDb.from('rettifiche')
      .select('numero_spedizione').in('id', ids.slice(i, i + 500)).eq('target_master_id', mio).neq('master_id', mio).eq('confermata', false)
    attesaSopra.push(...(data || []))
  }
  const attesaLdv = attesaSopra.map((r: any) => r.numero_spedizione)

  if (!tutteMie.length) {
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
    if (decisione === 'assorbita') await scriviPercheAssorbita(adminDb, righe.map((r: any) => r.id), 'assorbita_a_mano')
    // Decisa: il promemoria di «Cosa devi fare» non serve piu'.
    await scriviDaSistemare(adminDb, mio, [], new Map(), righe.map((r: any) => r.id))
    return NextResponse.json({ ok: true, assorbite: righe.length, inAttesaSopra: attesaLdv.length })
  }

  const { calcolaRipesature, volumiDelLivello } = await import('@/lib/ripesature-calcolo')
  let create = 0, aZero = 0
  const saltate: { ldv: string; perche: string }[] = []
  // SCARTO PULITO ≠ problema. Quando il collo ripesato cade nello STESSO scaglione/blocco del
  // listino del cliente dell'addebito originale, riprezzato dà lo stesso identico prezzo (o meno):
  // non c'è un euro in più da chiedergli — il suo listino dice così. Non è una fascia mancante da
  // aggiungere né una perdita da segnalare: si scarta in silenzio (assorbita), fuori dagli avvisi ⚠️.
  const scartate: { ldv: string; perche: string }[] = []
  const idFatte: string[] = []      // figlia creata (o già esistente) → 'propagata'
  const idAzzerate: string[] = []   // differenza a zero → 'assorbita'. Tutte le ALTRE saltate NON
                                    // vengono più marcate: restano propagazione=null e ritentabili.
  const contiUguali = new Map<string, ContoSotto>()   // i numeri con cui si e' visto che sotto si paga uguale
  // IL MOTIVO RESTA SCRITTO SULLA RIGA (rettifiche.da_sistemare), non solo nel messaggio di risposta. Il 12/11/2026
  // Ecomize Solution ha caricato 849 righe a blocchi in un'ora: il motivo di 3UW1UHA334029 (listino della cliente fermo
  // a 5 kg, pacco ripesato 19,85) e' comparso in un messaggio che il «Carica» dopo ha sostituito. Ora la pagina lo
  // rilegge da qui (riquadro «Cosa devi fare», lib/network-da-fare) finche' la riga non passa.
  const motivi = new Map<string, DaSistemare>()
  const salta = (r: any, perche: string, extra: Parameters<typeof daSistemareDaMotivo>[1] = {}) => {
    saltate.push({ ldv: r.numero_spedizione, perche })
    motivi.set(r.id, daSistemareDaMotivo(perche, extra))
  }

  // ── TUTTE LE RIGHE IN UN COLPO SOLO ──
  //
  // Il motore sa gia' fare otto riprezzi insieme (ogni riga e' un conto a se' e fa solo letture):
  // chiamandolo una riga per volta si aspettava un viaggio al database dopo l'altro, ~6 secondi a
  // riga invece di ~0,9. Su un pomeriggio da 2.228 rettifiche accettare voleva dire ore, ed e'
  // esattamente la differenza che si sentiva con i contrassegni, dove accettare e' solo un flag.
  // Il motore torna gli esiti NELLO STESSO ORDINE in cui gli sono arrivate le righe.
  // Senza misure o senza spedizione non si riprezza: il motivo lo dice primaDelMotore (lib/network-carica).
  const lavorabili = (righe as any[]).filter((r: any) => {
    const no = primaDelMotore(r)
    if (no) { salta(r, no); return false }
    return true
  })
  // Si riusa lo STESSO motore del caricamento del file: ricostruisce la catena, legge dai
  // movimenti quello che ogni livello ha gia' pagato — rettifiche comprese, cosi' la stessa
  // differenza non si chiede due volte — e riprezza il collo vero a ogni livello col suo listino.
  // Client CON MEMORIA (nuovo a ogni richiesta): listini e zone una volta per blocco, non una per riga.
  const esiti = await calcolaRipesature(createAdminSupabaseConMemoria(), lavorabili.map(ingressoMotore))

  const daScrivere: any[] = []
  for (let iRiga = 0; iRiga < lavorabili.length; iRiga++) {
    const r = lavorabili[iRiga]
    const colli = r.colli_ripesati as any[]
    const esito = esiti[iRiga]
    // La decisione e' una regola sola, con il conto fatto all'arrivo (lib/network-carica, decidiCarica).
    const d = decidiCarica(r, esito, mio)
    if (d.tipo === 'salta') { salta(r, d.perche, d.extra); continue }
    if (d.tipo === 'uguale') {
      scartate.push({ ldv: r.numero_spedizione, perche: 'il cliente pagherebbe uguale col suo listino (stesso scaglione di peso): niente da recuperare' }); idAzzerate.push(r.id)
      contiUguali.set(r.id, contoDelLivello(d.liv)); continue
    }
    const { liv, figlio, diffFiglia, fs, soloPassaggio, penale, tardivo } = d

    daScrivere.push({
      master_id: mio, spedizione_id: esito.spedizioneId, numero_spedizione: esito.ldv,
      cliente_id: figlio ? null : liv.clienteId,
      target_master_id: figlio,
      // dichiarato e ripesato: reale + volumetrico, il volume col divisore del figlio (e' lui che paga),
      // cosi' si vede perche' il costo sale
      peso_iniziale: esito.pesoRealePrima, peso_reale: esito.pesoDopo, ...volumiDelLivello(esito, liv),
      // Il supplemento arrivato dopo tiene lo stesso peso prima e dopo, come la riga di sopra: con i chili del motore
      // trg_rettifica_no_doppia_ripesatura lo prenderebbe per una seconda ripesatura e qui sotto passerebbe per
      // "gia' propagata", senza figlia.
      ...(tardivo ? { peso_iniziale: (r as any).peso_reale, peso_reale: (r as any).peso_reale, peso_volume_iniziale: volumiDelLivello(esito, liv).peso_volume_reale } : {}),
      // dovuto null (collo oltre fascia, solo fuori sagoma) → pari a pagato, differenza 0. A zero per
      // passaggio: resta quello pagato, un dovuto piu' basso sembrerebbe un rimborso che non c'e'.
      costo_iniziale: liv.pagato, costo_finale: (soloPassaggio || penale || tardivo) ? liv.pagato : (liv.dovuto ?? liv.pagato),
      differenza: -diffFiglia,            // la colonna e' "quanto restituisco": un addebito e' negativo (0 se solo fuori sagoma)
      fuori_sagoma: fs,                   // il supplemento fisso scende INVARIATO, NON si riprezza
      supplementi_nomi: (r as any).supplementi_nomi || null,   // e col nome, altrimenti sotto si legge "fuori sagoma" per tutto
      stato: 'da_rettificare', confermata: false,
      colli_ripesati: colli,              // le misure continuano a scendere, per il livello dopo
      origine_rettifica_id: r.id,         // l'anti-doppione: si propaga una volta sola
    })
    daScrivere[daScrivere.length - 1]._riga = r    // serve solo qui sotto, per dire chi e' andata
    daScrivere[daScrivere.length - 1]._aZero = soloPassaggio
  }

  // OTTO SCRITTURE ALLA VOLTA. Righe diverse, spedizioni diverse: non si pestano i piedi, e il
  // doppione lo ferma comunque l'indice unico su origine_rettifica_id, che e' la garanzia vera.
  {
    let i = 0
    await Promise.all(Array.from({ length: Math.min(8, daScrivere.length) }, async () => {
      while (i < daScrivere.length) {
        const riga = daScrivere[i++]
        const r = riga._riga
        const { _riga, _aZero, ...daInserire } = riga
        const { error } = await adminDb.from('rettifiche').insert(daInserire)
        // 23505 = l'indice unico ha respinto una seconda propagazione della stessa riga. Voluto.
        if (!error) { create++; if (riga._aZero) aZero++; idFatte.push(r.id) }
        else if (error.code === '23505') { saltate.push({ ldv: r.numero_spedizione, perche: 'gia\' propagata' }); idFatte.push(r.id) }
        else { console.error('[RETTIFICHE][PROPAGA]', r.numero_spedizione, error.message); salta(r, 'non riuscita') }
      }
    }))
  }

  // Si segna lo stato SOLO su chi è stato davvero deciso: 'propagata' chi ha (o già aveva) una figlia,
  // 'assorbita' chi non aveva nulla da addebitare. Tutte le altre saltate RESTANO propagazione=null e
  // rimangono nell'elenco "da decidere": si ritentano dopo aver sistemato la causa (listino del livello
  // sotto mancante, misure non salvate, catena incompleta), invece di sparire assorbite in silenzio —
  // era il motivo per cui la rettifica arrivava a un sotto-master (es. Ecomize LL) ma lui non poteva
  // né vederla né addebitarla, e non era più recuperabile.
  // A BLOCCHI: con migliaia di id un solo .in() diventa una richiesta enorme e il database la rifiuta.
  for (let i = 0; i < idFatte.length; i += 500) await adminDb.from('rettifiche').update({ propagazione: 'propagata' }).in('id', idFatte.slice(i, i + 500))
  for (let i = 0; i < idAzzerate.length; i += 500) await adminDb.from('rettifiche').update({ propagazione: 'assorbita' }).in('id', idAzzerate.slice(i, i + 500))
  await scriviPercheAssorbita(adminDb, idAzzerate, 'paga_uguale', contiUguali)
  await scriviDaSistemare(adminDb, mio, lavorabili, motivi, [...idFatte, ...idAzzerate])

  const ritentabili = righe.length - idFatte.length - idAzzerate.length
  return NextResponse.json({
    ok: true, create, aZero, nonPropagate: saltate.length, ritentabili,
    // NON troncato più a 20: chi deve sistemare le saltate (misure mancanti, listino sotto, catena)
    // deve poterle vedere TUTTE, altrimenti oltre la ventesima "spariscono" e sembrano perse.
    dettaglio: saltate,
    // Scarti puliti (cliente paga uguale): si contano e si dicono con calma, NON tra gli avvisi.
    scartate,
    inAttesaSopra: attesaLdv.length, dettaglioAttesaSopra: attesaLdv.slice(0, 100),
  })
}

// PERCHE' E' STATA ASSORBITA, scritto sulla riga (rettifiche.perche): col bottone «Assorbi» del master, o scartata dal
// portale perche' col listino di chi sta sotto il peso nuovo costa uguale. Lo legge Rettifica Costi → «non girate sotto»
// (app/api/rettifiche/eliminate): fino al 13/11/2026 le due cose finivano nella stessa frase, «non girata sotto (o sotto
// non c'era niente da recuperare)», e il master non sapeva se l'aveva scelto lui o il portale. Non muove soldi: se la
// scrittura non riesce si perde solo la frase.
// Con i numeri (paga_uguale) ogni riga ha i suoi e si scrive da sola, otto alla volta; senza, a blocchi.
async function scriviPercheAssorbita(adminDb: any, ids: string[], tipo: 'assorbita_a_mano' | 'paga_uguale', conti?: Map<string, ContoSotto>) {
  try {
    const il = new Date().toISOString()
    if (!conti?.size) {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await adminDb.from('rettifiche').update({ perche: { tipo, il } }).in('id', ids.slice(i, i + 500))
        if (error) { console.error('[NETWORK] perche assorbita:', error.message); return }
      }
      return
    }
    let k = 0
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (k < ids.length) {
        const id = ids[k++]
        const { error } = await adminDb.from('rettifiche').update({ perche: { tipo, il, ...(conti.get(id) || {}) } }).eq('id', id)
        if (error) console.error('[NETWORK] perche assorbita:', error.message)
      }
    }))
  } catch (e: any) { console.error('[NETWORK] perche assorbita:', e?.message || e) }
}

// Scrive sulle righe non girate il loro motivo (rettifiche.da_sistemare) e lo toglie da quelle decise. Non muove soldi e
// non cambia lo stato: se la scrittura non riesce si perde solo il promemoria, il «Carica» e' gia' fatto.
async function scriviDaSistemare(adminDb: any, mio: string, lavorabili: any[], motivi: Map<string, DaSistemare>, decise: string[]) {
  try {
    // Per un cliente col listino corto il riquadro dice anche fin dove arriva il listino e in che zona: lo stesso controllo
    // di «Cosa devi fare», cosi' la frase sulla riga e quella del riquadro sono la stessa.
    const daRivedere = lavorabili.filter((r: any) => { const m = motivi.get(r.id); return !!m && !!m.cliente_id && m.codice === 'listino_corto' })
    if (daRivedere.length) {
      const piu = await controllaListiniClienti(createAdminSupabaseConMemoria(), mio, daRivedere)
      for (const [id, m] of piu) motivi.set(id, m)
    }
    const quando = new Date().toISOString()
    const gruppi = new Map<string, string[]>()
    for (const [id, m] of motivi) {
      const k = JSON.stringify({ ...m, quando })
      if (!gruppi.has(k)) gruppi.set(k, [])
      gruppi.get(k)!.push(id)
    }
    for (const [k, ids] of gruppi) {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await adminDb.from('rettifiche').update({ da_sistemare: JSON.parse(k) }).in('id', ids.slice(i, i + 500)).eq('target_master_id', mio)
        if (error) { console.error('[NETWORK] da_sistemare:', error.message); return }
      }
    }
    for (let i = 0; i < decise.length; i += 500) {
      await adminDb.from('rettifiche').update({ da_sistemare: null }).in('id', decise.slice(i, i + 500)).not('da_sistemare', 'is', null)
    }
  } catch (e: any) { console.error('[NETWORK] da_sistemare:', e?.message) }
}
