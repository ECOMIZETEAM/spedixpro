// Helper PrestaShop Webservice API (output JSON). DOPPIA autenticazione: header Basic + parametro
// ws_key nell'URL. Molti hosting (Apache/PHP-CGI) STRIPPANO l'header Authorization prima che
// arrivi a PrestaShop -> 401 anche con chiave giusta; il ws_key in query e' il supporto nativo
// che funziona ovunque. Insieme non confliggono.
export function psHeaders(key: string): Record<string, string> {
  return { 'Authorization': 'Basic ' + Buffer.from(key + ':').toString('base64') }
}

function psUrl(url: string, key: string, pathAndQuery: string): string {
  const base = url.replace(/\/+$/, '')
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  return `${base}/api/${pathAndQuery}${sep}output_format=JSON&ws_key=${encodeURIComponent(key)}`
}

// Una pagina web al posto dei dati: e' il firewall del sito (o la protezione anti-bot) che ferma la
// chiamata prima che arrivi a PrestaShop. Il testo grezzo era un pezzo di HTML ("<!DOCTYPE html>…Just
// a moment…") che finiva tale e quale accanto all'ordine: si dice cos'e', cosi' il negoziante sa a
// chi rivolgersi (chi gli gestisce il sito), invece di cercare un guasto nella chiave.
function psErrore(status: number, text: string, metodo = ''): string {
  const prefisso = `PrestaShop ${metodo ? metodo + ' ' : ''}${status}`
  if (/<!doctype|<html[\s>]/i.test(text)) return `${prefisso}: il sito ha risposto con una pagina web invece dei dati (firewall o protezione anti-bot del sito che blocca la chiamata)`
  return `${prefisso}: ${text.slice(0, 160)}`
}

export async function psGet(url: string, key: string, pathAndQuery: string): Promise<any> {
  const r = await fetch(psUrl(url, key, pathAndQuery), { headers: psHeaders(key), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) {
    if (r.status === 404) return null
    throw new Error(psErrore(r.status, text))
  }
  try { return JSON.parse(text) } catch { return null }
}

// ELENCO, non risorsa singola. psGet tratta allo stesso modo "non c'e'" e "non ho capito la risposta"
// (torna null): per una risorsa singola va bene, per un elenco no — una pagina di manutenzione servita
// con 200 diventava "nessun ordine", la sync diceva ok e cancellava pure l'errore precedente. Un
// elenco vuoto PrestaShop lo dice con `[]` (verificato sui 16 negozi collegati, 13/10/2026): tutto
// cio' che non e' JSON, qui, e' un errore e va detto.
export async function psElenco(url: string, key: string, pathAndQuery: string, nodo: string): Promise<any[]> {
  const r = await fetch(psUrl(url, key, pathAndQuery), { headers: psHeaders(key), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw new Error(psErrore(r.status, text))
  let j: any
  try { j = JSON.parse(text) } catch { throw new Error(psErrore(r.status, /<!doctype|<html[\s>]/i.test(text) ? text : 'risposta non leggibile')) }
  return Array.isArray(j?.[nodo]) ? j[nodo] : []
}

// STATI DI SERIE. Gli stati 1-8 hanno lo stesso numero su ogni PrestaShop (li crea l'installazione).
// Servono quando la chiave non puo' leggere `order_states`: senza un ripiego nessun ordine risultava
// mai spedito e lo stato compariva come numero nudo ("4"). Su due negozi collegati 449 ordini gia'
// spediti o consegnati stavano tra i "Da spedire" (13/10/2026). Gli stati personalizzati (numeri alti)
// restano sconosciuti finche' il negoziante non da' il permesso.
export const PS_STATI_DI_SERIE: Record<string, { nome: string; spedito: boolean }> = {
  '1': { nome: 'In attesa di pagamento con assegno', spedito: false },
  '2': { nome: 'Pagamento accettato', spedito: false },
  '3': { nome: 'Preparazione in corso', spedito: false },
  '4': { nome: 'Spedito', spedito: true },
  '5': { nome: 'Consegnato', spedito: true },
  '6': { nome: 'Annullato', spedito: false },
  '7': { nome: 'Rimborsato', spedito: false },
  '8': { nome: 'Errore di pagamento', spedito: false },
}

// COSA PUO' FARE LA CHIAVE. La radice /api elenca le risorse concesse con i loro permessi
// (get/put/post). Per ogni cosa che ci serve dice se c'e'; `null` se la risposta non e' leggibile.
// `bloccanti` = senza, gli ordini non si importano o arrivano con dati sbagliati (provincia vuota,
// paese sempre Italia). `avvisi` = l'import funziona, ma manca il ritorno del tracking o il
// riconoscimento degli ordini gia' spediti.
const PS_PERMESSI: { risorsa: string; azione: 'get' | 'put' | 'post'; bloccante: boolean }[] = [
  { risorsa: 'orders', azione: 'get', bloccante: true },
  { risorsa: 'addresses', azione: 'get', bloccante: true },
  { risorsa: 'customers', azione: 'get', bloccante: true },
  { risorsa: 'states', azione: 'get', bloccante: true },
  { risorsa: 'countries', azione: 'get', bloccante: true },
  { risorsa: 'order_states', azione: 'get', bloccante: false },
  { risorsa: 'order_carriers', azione: 'get', bloccante: false },
  { risorsa: 'order_carriers', azione: 'put', bloccante: false },
  { risorsa: 'order_histories', azione: 'post', bloccante: false },
]
const PS_AZIONE: Record<string, string> = { get: 'Visualizza (GET)', put: 'Modifica (PUT)', post: 'Aggiungi (POST)' }

export function psPermessiMancanti(xmlRadice: string): { bloccanti: string[]; avvisi: string[] } | null {
  if (!/<api\b/i.test(xmlRadice)) return null
  const bloccanti: string[] = [], avvisi: string[] = []
  for (const p of PS_PERMESSI) {
    const m = xmlRadice.match(new RegExp(`<${p.risorsa}\\b([^>]*)>`))
    const concesso = !!m && new RegExp(`\\b${p.azione}="true"`).test(m[1])
    if (!concesso) (p.bloccante ? bloccanti : avvisi).push(`${p.risorsa} → ${PS_AZIONE[p.azione]}`)
  }
  return { bloccanti, avvisi }
}

// SCRITTURE IN XML. Il Webservice PrestaShop accetta SOLO body XML per POST/PUT: `output_format=JSON`
// vale solo per la RISPOSTA, non per il corpo della richiesta. Mandare JSON dava sempre
// "String could not be parsed as XML" e nessun tracking tornava indietro (bug fino al 12/08/2026).

// GET grezzo in XML (senza output_format=JSON): serve per leggere una risorsa, modificarla e
// rimandarla indietro tale e quale (round-trip), evitando mismatch di campi tra versioni PrestaShop.
export async function psGetXml(url: string, key: string, pathAndQuery: string): Promise<string | null> {
  const base = url.replace(/\/+$/, '')
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  const r = await fetch(`${base}/api/${pathAndQuery}${sep}ws_key=${encodeURIComponent(key)}`, {
    headers: psHeaders(key), signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  if (!r.ok) { if (r.status === 404) return null; throw new Error(psErrore(r.status, text)) }
  return text
}

export async function psPutXml(url: string, key: string, resource: string, id: number | string, xml: string): Promise<void> {
  const base = url.replace(/\/+$/, '')
  const r = await fetch(`${base}/api/${resource}/${id}?ws_key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { ...psHeaders(key), 'Content-Type': 'application/xml' },
    body: xml,
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(psErrore(r.status, text, 'PUT'))
}

export async function psPostXml(url: string, key: string, resource: string, xml: string): Promise<void> {
  const base = url.replace(/\/+$/, '')
  const r = await fetch(`${base}/api/${resource}?ws_key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { ...psHeaders(key), 'Content-Type': 'application/xml' },
    body: xml,
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(psErrore(r.status, text, 'POST'))
}

// Costruisce il body XML per un POST (risorsa nuova) da campi piatti. Le scritture PrestaShop vanno
// racchiuse in <prestashop><risorsa>…campi…</risorsa></prestashop>, valori in CDATA.
export function psXml(resource: string, campi: Record<string, string | number>): string {
  const inner = Object.entries(campi).map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">\n<${resource}>${inner}</${resource}>\n</prestashop>`
}
