import { assorbitiDi, assorbitiNelPacco } from '@/lib/ordini-uniti'

// CHI SI EVADE SUL NEGOZIO, IN UN POSTO SOLO.
//
// Le spinte del tracking verso i negozi partono da piu' punti e passano tutte da lib/fulfillMarketplace.
// I fulfiller di Shopify, WooCommerce, PrestaShop, eBay, TikTok e Temu si sceglievano ognuno da se' le
// righe da evadere, con la stessa select copiata sei volte: una regola nuova (gli ordini uniti) andava
// ricordata in sei file. Ora la scelta sta qui. Amazon no: il suo collegamento diretto (lib/amazonFulfill,
// 19/10/2026) e' nato in parallelo a questa regola, e le righe e i suoi uniti se li sceglie ancora da se'
// (vedi l'interruttore qui sotto).
//
// Le costanti stanno qui e non in lib/shopify perche' le leggono anche fulfillMarketplace e il recupero:
// messe in lib/shopify farebbero un giro d'import con fulfillMarketplace.

// Gli stati in cui una spedizione e' annullata o sta per esserlo. Evaderla vorrebbe dire mandare al
// compratore l'email di spedizione con un tracking morto, e mentre si aspetta l'annullo il recupero non
// deve bruciare tentativi. 'storno_richiesto' e' la spedizione DVA che aspetta la conferma dello storno:
// mancava, e il recupero poteva evadere una spedizione che si stava annullando.
export const STATI_SPEDIZIONE_IN_ANNULLO = ['annullata', 'annullamento_pending', 'annullamento_manuale', 'storno_richiesto']

// Oltre questi giri falliti (uno ogni 20 minuti, circa 2h40) il recupero si arrende su un ordine: e' un
// errore permanente (negozio giu' da giorni, chiave in sola lettura). Lo usano il recupero delle evasioni
// e l'annullo delle evasioni su Shopify.
export const MAX_TENTATIVI_NEGOZIO = 8

// Gli esiti d'evasione che lasciano la TRACCIA di un'evasione nostra. Su una riga Shopify senza
// spedizione (staccata dal trigger trg_ordine_torna_da_spedire quando la spedizione si annulla) dicono che
// sul negozio c'e', o c'era, un'evasione col tracking di una nostra spedizione. La stessa lista decide chi
// e' candidato all'annullo dell'evasione (lib/shopify), chi segna-spedito marca «evasione precedente da
// annullare» quando l'ordine si rispedisce e chi ha una storia nostra per la sync (lib/shopifySync): se
// una delle tre ne avesse una diversa, la traccia di un'evasione morta si perderebbe per strada.
export const ESITI_EVASIONE = ['ok', 'attesa', 'errore']

// Gli esiti per cui un ASSORBITO si rimanda col pacco anche quando il capofila e' gia' evaso: l'evasione
// fallita ('errore') o trattenuta sul negozio ('attesa'). La stessa lista decide chi righeDaEvadere
// rimanda e chi il recupero (fulfill-retry) ripesca fra gli uniti: con due liste diverse il recupero
// sceglierebbe assorbiti che l'evasione poi salta, bruciando i loro tentativi senza tentare niente,
// oppure l'evasione li vorrebbe e il recupero non li ripescherebbe mai.
export const ESITI_DA_RIPETERE = ['errore', 'attesa']

// L'INTERRUTTORE DEGLI ORDINI UNITI. Un ordine assorbito parte nel pacco del capofila, quindi sul negozio
// va evaso anche lui, col tracking del capofila: un'evasione per ordine. Acceso solo per Shopify. Sulle
// altre piattaforme vorrebbe dire una nota o un'email in piu' al compratore per ogni ordine, la sync eBay
// riscrive 'unito' con 'spedito' (lib/ebaySync), Woo ricompone il pacco dallo stato del negozio al momento
// dell'evasione e nessuno annulla l'evasione se il pacco si annulla. Accenderle e' una scelta di Lorenzo
// (domanda 7 del piano del 20/10/2026), e si fa aggiungendo il nome qui.
// AMAZON NON VA AGGIUNTO QUI. Conferma i suoi uniti da se' (lib/amazonFulfill), con una regola sua: ogni
// unito non ancora confermato, anche col capofila gia' confermato, subito dopo il capofila; il recupero
// li riprende con unitiAmazonDaConfermare e segna-spedito li azzera quando il pacco cambia. Aggiungerlo
// qui senza togliere quella selezione darebbe due regole per gli stessi ordini. Portare Amazon su questa
// regola, o tenerlo a parte, e' una scelta di Lorenzo: la domanda 7 riguardava gli altri cinque negozi.
export const PIATTAFORME_UNITI_EVASI = new Set(['shopify'])

// GLI ASSORBITI CHE SI EVADONO COL PACCO: quelli del pacco (assorbitiNelPacco) ancora 'unito'. Una riga
// con unito_in pieno ma non piu' 'unito' e' partita con una spedizione sua: se quella si annulla, il
// trigger trg_ordine_torna_da_spedire la stacca ('da_spedire', senza spedizione) ma lascia unito_in, e il
// pacco del capofila puo' essere gia' partito senza la sua merce. Evaderla col tracking del capofila
// manderebbe al compratore l'email di un pacco che non contiene i suoi articoli; e se poi la si
// rispedisse, l'evasione sbagliata risulterebbe viva e il tracking nuovo non arriverebbe mai. Su Shopify
// 'unito' non lo riscrive piu' nessuno (ne' la sync ne' la riconciliazione), quindi lo stato dice il
// vero. La riga staccata la tratta la riconciliazione delle evasioni (lib/shopify), come ogni riga staccata.
// La usano l'evasione (righeDaEvadere) e l'azzeramento quando il capofila si rispedisce (segna-spedito);
// il recupero (fulfill-retry) fa la stessa scelta nella sua lettura degli uniti.
export function assorbitiDaEvadere<T = any>(assorbiti: T[]): T[] {
  return assorbitiNelPacco(assorbiti, { daSpedire: true }).filter((r: any) => r.stato === 'unito')
}

// `nelPacco`: la riga viaggia in un pacco con altri ordini (e' un assorbito, o un capofila con assorbiti
// validi nel pacco). Serve a dire la cosa giusta su un ordine annullato sul negozio: la spedizione porta
// anche merce d'altri (lib/shopify, testoAnnullatoStore). Lo calcola solo una piattaforma accesa.
export type RigaDaEvadere = { ordine: any; spedizioneId: string; nelPacco?: boolean }

// Le righe da evadere per le spedizioni date, su una piattaforma, con la spedizione da cui prendere il
// tracking. Ogni fulfiller la chiama da se', subito prima del suo giro: la lettura resta fresca come
// quando ognuno rileggeva le sue righe.
//  - Le righe COLLEGATE alla spedizione, tutte, come prima. Anche quelle annullate sul negozio: e' il
//    fulfiller a registrarne l'esito ('annullato_store' su Shopify), e togliendole qui resterebbero senza.
//  - Con la piattaforma accesa nell'interruttore, gli ASSORBITI di quelle righe che partono col pacco
//    (assorbitiDaEvadere: ancora uniti, niente spediti a parte, niente annullati sul negozio), legati alla
//    spedizione del capofila. Un assorbito entra se il capofila non e' ancora evaso, oppure se ha un esito
//    suo da ripetere (ESITI_DA_RIPETERE): le unioni di prima, col capofila gia' 'ok', non ripartono da sole.
//  - PRIMA gli assorbiti, il capofila per ULTIMO: se il giro si interrompe a meta', il capofila resta non
//    evaso, e il recupero che lo riprende riprende anche gli assorbiti rimasti indietro.
// Un errore di lettura lancia: meglio un giro senza evasioni, che il recupero ritenta, di un capofila
// evaso con gli assorbiti mai tentati.
export async function righeDaEvadere(db: any, spedizioneIds: string[], piattaforma: string): Promise<RigaDaEvadere[]> {
  const ids = Array.from(new Set((spedizioneIds || []).filter(Boolean).map(String)))
  if (!ids.length) return []
  const collegate: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('ordini_ecommerce').select('*')
      .in('spedizione_id', ids.slice(i, i + 200))
      .eq('piattaforma', piattaforma)
    if (error) throw new Error('lettura ordini da evadere: ' + error.message)
    collegate.push(...(data || []))
  }
  const diretti: RigaDaEvadere[] = collegate.map((o: any) => ({ ordine: o, spedizioneId: String(o.spedizione_id) }))
  if (!PIATTAFORME_UNITI_EVASI.has(piattaforma) || !collegate.length) return diretti

  const perCapo = await assorbitiDi(db, collegate.map((o: any) => String(o.id)), '*')
  const assorbiti: RigaDaEvadere[] = []
  const capiConPacco = new Set<string>()
  for (const capo of collegate) {
    const loro = (perCapo.get(String(capo.id)) || []).filter((r: any) => r.piattaforma === piattaforma)
    if (assorbitiNelPacco(loro, { daSpedire: true }).length) capiConPacco.add(String(capo.id))
    for (const r of assorbitiDaEvadere(loro)) {
      if (capo.fulfillment_stato === 'ok' && !ESITI_DA_RIPETERE.includes(String((r as any).fulfillment_stato || ''))) continue
      assorbiti.push({ ordine: r, spedizioneId: String(capo.spedizione_id), nelPacco: true })
    }
  }
  return [...assorbiti, ...diretti.map(d => ({ ...d, nelPacco: capiConPacco.has(String(d.ordine.id)) }))]
}

// La spedizione del PACCO di ogni riga unita: quella del capofila in cima (si risale unito_in fino a
// cinque livelli, come la lettura delle unioni), oppure null se il pacco non e' ancora partito o il
// capofila non si trova. Serve al recupero per legare un assorbito alla spedizione da cui prende il
// tracking. Le righe non unite tornano null.
export async function spedizioneDelPacco(db: any, righe: { id: string; unito_in?: string | null }[]): Promise<Map<string, string | null>> {
  const esito = new Map<string, string | null>()
  let correnti = new Map<string, string>()   // riga -> id del capofila da leggere a questo livello
  for (const r of righe || []) {
    if (r.unito_in) correnti.set(String(r.id), String(r.unito_in))
    else esito.set(String(r.id), null)
  }
  const letti = new Map<string, { unito_in: string | null; spedizione_id: string | null }>()
  for (let livello = 0; livello < 5 && correnti.size; livello++) {
    const daLeggere = Array.from(new Set(correnti.values())).filter(id => !letti.has(id))
    for (let i = 0; i < daLeggere.length; i += 200) {
      const { data, error } = await db.from('ordini_ecommerce').select('id,unito_in,spedizione_id').in('id', daLeggere.slice(i, i + 200))
      if (error) throw new Error('lettura capofila: ' + error.message)
      for (const c of data || []) letti.set(String(c.id), { unito_in: c.unito_in ? String(c.unito_in) : null, spedizione_id: c.spedizione_id ? String(c.spedizione_id) : null })
    }
    const prossimi = new Map<string, string>()
    for (const [riga, capoId] of correnti) {
      const capo = letti.get(capoId)
      if (!capo) esito.set(riga, null)
      else if (capo.unito_in) prossimi.set(riga, capo.unito_in)
      else esito.set(riga, capo.spedizione_id)
    }
    correnti = prossimi
  }
  for (const riga of correnti.keys()) esito.set(riga, null)   // catena piu' lunga di cinque livelli
  return esito
}
