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

export async function psGet(url: string, key: string, pathAndQuery: string): Promise<any> {
  const r = await fetch(psUrl(url, key, pathAndQuery), { headers: psHeaders(key), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) {
    if (r.status === 404) return null
    throw new Error(`PrestaShop ${r.status}: ${text.slice(0, 160)}`)
  }
  try { return JSON.parse(text) } catch { return null }
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
  if (!r.ok) { if (r.status === 404) return null; throw new Error(`PrestaShop ${r.status}: ${text.slice(0, 160)}`) }
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
  if (!r.ok) throw new Error(`PrestaShop PUT ${r.status}: ${text.slice(0, 160)}`)
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
  if (!r.ok) throw new Error(`PrestaShop POST ${r.status}: ${text.slice(0, 160)}`)
}

// Costruisce il body XML per un POST (risorsa nuova) da campi piatti. Le scritture PrestaShop vanno
// racchiuse in <prestashop><risorsa>…campi…</risorsa></prestashop>, valori in CDATA.
export function psXml(resource: string, campi: Record<string, string | number>): string {
  const inner = Object.entries(campi).map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">\n<${resource}>${inner}</${resource}>\n</prestashop>`
}
