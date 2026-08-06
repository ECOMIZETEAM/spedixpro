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
  const { data: righe } = await adminDb.from('rettifiche')
    .select('id,spedizione_id,numero_spedizione,peso_iniziale,peso_reale,colli_ripesati,rif_fornitore,propagazione')
    .in('id', ids).eq('target_master_id', mio).eq('confermata', true)
  if (!righe?.length) {
    return NextResponse.json({ error: 'Nessuna rettifica tua fra quelle indicate (o non ancora confermata da chi te l\'ha girata).' }, { status: 404 })
  }

  if (decisione !== 'propagata') {
    await adminDb.from('rettifiche').update({ propagazione: decisione }).in('id', righe.map((r: any) => r.id))
    return NextResponse.json({ ok: true, assorbite: righe.length })
  }

  const { calcolaRipesature } = await import('@/lib/ripesature-calcolo')
  let create = 0
  const saltate: { ldv: string; perche: string }[] = []

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
    if (!liv || liv.differenza == null) { saltate.push({ ldv: r.numero_spedizione, perche: 'nessun prezzo a listino per il livello sotto' }); continue }
    if (Math.abs(liv.differenza) < 0.01) { saltate.push({ ldv: r.numero_spedizione, perche: 'differenza a zero' }); continue }

    const { error } = await adminDb.from('rettifiche').insert({
      master_id: mio, spedizione_id: esito.spedizioneId, numero_spedizione: esito.ldv,
      cliente_id: figlio ? null : liv.clienteId,
      target_master_id: figlio,
      peso_iniziale: esito.pesoPrima, peso_volume_iniziale: 0,
      peso_reale: esito.pesoDopo, peso_volume_reale: 0,
      costo_iniziale: liv.pagato, costo_finale: liv.dovuto,
      differenza: -liv.differenza,        // la colonna e' "quanto restituisco": un addebito e' negativo
      stato: 'da_rettificare', confermata: false,
      colli_ripesati: colli,              // le misure continuano a scendere, per il livello dopo
      origine_rettifica_id: r.id,         // l'anti-doppione: si propaga una volta sola
    })
    // 23505 = l'indice unico ha respinto una seconda propagazione della stessa riga. Voluto.
    if (!error) create++
    else if (error.code === '23505') saltate.push({ ldv: r.numero_spedizione, perche: 'gia\' propagata' })
    else { console.error('[RETTIFICHE][PROPAGA]', r.numero_spedizione, error.message); saltate.push({ ldv: r.numero_spedizione, perche: 'non riuscita' }) }
  }

  await adminDb.from('rettifiche').update({ propagazione: 'propagata' }).in('id', righe.map((r: any) => r.id))

  return NextResponse.json({
    ok: true, create, nonPropagate: saltate.length, dettaglio: saltate.slice(0, 20),
  })
}
