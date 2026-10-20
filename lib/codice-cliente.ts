// IL CODICE CLIENTE (CLI-0001, CLI-0002, ...): UNA REGOLA SOLA PER TUTTE LE PORTE CHE CREANO CLIENTI.
//
// Progressivo per master, calcolato SOLO sui codici della serie e in NUMERICO.
//
// Prima si prendeva il massimo in ordine ALFABETICO su tutti i codici, comunque fossero fatti, e da
// quella stringa si tiravano fuori le cifre. Bastava un codice fuori serie per rompere tutto: Velox
// aveva "LDG-9F9FA70C" (un cliente d'ingrosso), che in alfabeto viene dopo ogni "CLI-…"; le sue
// cifre sono 9,9,7,0 -> 9970, quindi proponeva sempre CLI-9971, che esisteva gia'. Non una corsa:
// un blocco FISSO, a ogni tentativo, e il master non poteva piu' creare clienti. Stessa cosa per
// MoovExpress con "TIKTOKREV" (nessuna cifra -> ripartiva da CLI-0001, gia' preso).
//
// Quindi: si guardano solo i "CLI-<numero>", si confronta il NUMERO e non il testo, e i codici
// personalizzati restano fuori dalla serie — che e' quello che sono.
//
// La correzione del 30/09/2026 (c4771042) era arrivata solo alla creazione dal portale master. Le
// altre tre porte avevano ancora la formula alfabetica: la registrazione dal sito, la riconferma dei
// preventivi e l'installazione dell'app Shopify. Quest'ultima, sotto MoovExpress, falliva SEMPRE
// (CLI-0001 gia' preso): dal 27/07 nessun negozio nuovo e' riuscito a entrare. Misurato il 20/10 su
// 43 master: la formula vecchia collideva anche su GTS ("LDG-23C9056E" -> CLI-239057, gia' preso).
//
// Il client lo sceglie chi chiama (la sessione nel portale master, il client di servizio altrove):
// questa regola decide il numero, non i permessi.

import { eIndirizzoInterno } from '@/lib/indirizzi-interni'

const SERIE = /^CLI-(\d+)$/
// Il vincolo unico (master_id, codice_cliente). Si riprova SOLO su questo: l'email doppia
// (clienti_email_key) o qualunque altro errore non si risolvono cambiando numero. Prima il test era
// "il messaggio contiene 'codice'", che avrebbe fatto ritentare anche un vincolo sul codice fiscale.
const VINCOLO_CODICE = 'clienti_codice_master_unici'
const TENTATIVI = 5

export function codiceCliente(n: number): string {
  return `CLI-${String(n).padStart(4, '0')}`
}

// Vero se l'errore e' il numero gia' preso. Le porte lo usano anche per il messaggio: arrivati qui
// dopo i tentativi, e' un numero che non si libera da solo, non un errore qualsiasi.
export function codiceGiaPreso(error: any): boolean {
  return error?.code === '23505' && String(error?.message || '').includes(VINCOLO_CODICE)
}

// Il prossimo numero libero della serie per un master. Legge a pagine: PostgREST restituisce al massimo
// mille righe per lettura, e un massimo calcolato su una lettura troncata ridarebbe numeri gia' presi.
export async function prossimoNumeroCliente(db: any, masterId: string): Promise<number> {
  let prossimo = 1
  for (let da = 0; ; da += 1000) {
    const { data, error } = await db.from('clienti')
      .select('codice_cliente').eq('master_id', masterId).like('codice_cliente', 'CLI-%')
      .order('id').range(da, da + 999)
    if (error) throw new Error(`lettura codici: ${error.message}`)
    for (const r of data || []) {
      const m = SERIE.exec(String(r?.codice_cliente || '').trim())
      if (m) prossimo = Math.max(prossimo, parseInt(m[1], 10) + 1)
    }
    if (!data || data.length < 1000) break
  }
  return prossimo
}

// UN INDIRIZZO INVENTATO DA NOI NON SI DA' A UN CLIENTE CHE ARRIVA DA FUORI.
//
// L'installazione dell'app Shopify ritrova il conto di un negozio dal suo indirizzo
// <negozio>@shopify.moovexpress.com (lib/indirizzi-interni.ts) e gli aggancia il negozio. Se il
// portale del master, la registrazione dal sito o la riconferma di un preventivo accettassero
// quell'indirizzo, chi conosce il nome di un negozio (e' pubblico) potrebbe preparargli il conto prima
// che installi, e poi vederne ordini e compratori. Le porte che CREANO clienti passano tutte da qui,
// quindi la regola della creazione sta qui: solo l'installazione dichiara di usare un indirizzo
// interno. I conti-ledger nascono altrove (condivisioni/accetta) e da qui non passano.
//
// Copre la creazione, non il cambio: l'indirizzo si scrive ancora su un cliente che esiste gia', dal
// cambio email della scheda (app/api/clienti/[id]/route.ts) o con una PATCH diretta del cliente sulla
// sua riga. Per questo l'installazione riaggancia un conto ritrovato per indirizzo solo se e' nato da
// lei (lib/shopifyProvision.ts); la chiusura per tutte le porte e' un vincolo nel database, rimandato.
const INDIRIZZO_INTERNO = 'indirizzo_interno'

// Vero se la creazione e' stata rifiutata per l'indirizzo interno: le porte lo usano per dire a chi
// scrive che deve usare un'email vera, invece del messaggio generico che inviterebbe a riprovare.
export function indirizzoInternoRifiutato(error: any): boolean {
  return error?.code === INDIRIZZO_INTERNO
}

// Inserisce il cliente col primo codice libero. Il numero si legge prima e si scrive dopo, quindi due
// creazioni simultanee possono sceglierlo uguale: l'indice unico respinge la seconda, che riprova col
// numero dopo invece di rimandare indietro l'errore. Se la lettura dei codici fallisce non si inserisce
// alla cieca: prima si ripartiva da CLI-0001.
export async function inserisciClienteConCodice(
  db: any, campi: Record<string, any> & { master_id: string }, colonne = 'id',
  opzioni: { indirizzoInterno?: boolean } = {},
): Promise<{ data: any; error: any; codice: string }> {
  if (eIndirizzoInterno(campi.email) && !opzioni.indirizzoInterno) {
    console.warn('[CODICE CLIENTE] creazione rifiutata: indirizzo email interno', campi.master_id)
    return { data: null, error: { code: INDIRIZZO_INTERNO, message: 'indirizzo email interno della piattaforma' }, codice: '' }
  }
  let prossimo: number
  try { prossimo = await prossimoNumeroCliente(db, campi.master_id) }
  catch (e: any) { return { data: null, error: { code: 'lettura', message: e?.message || String(e) }, codice: '' } }
  let ultimo: { data: any; error: any; codice: string } = { data: null, error: null, codice: '' }
  for (let t = 0; t < TENTATIVI; t++) {
    const codice = codiceCliente(prossimo + t)
    const { data, error } = await db.from('clienti').insert({ ...campi, codice_cliente: codice }).select(colonne).single()
    ultimo = { data, error, codice }
    if (!error && data) return ultimo
    if (!codiceGiaPreso(error)) return ultimo
    console.warn('[CODICE CLIENTE] numero gia preso da una creazione simultanea', campi.master_id, codice)
  }
  return ultimo
}
