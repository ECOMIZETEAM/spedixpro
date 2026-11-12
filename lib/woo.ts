// Helper WooCommerce REST API v3 (auth Basic con consumer key/secret).
export function wooHeaders(ck: string, cs: string): Record<string, string> {
  return {
    'Authorization': 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}

export function wooBase(url: string): string {
  return url.replace(/\/+$/, '') + '/wp-json/wc/v3'
}

// L'ERRORE DEL NEGOZIO, LEGGIBILE. Finisce sull'integrazione e sotto il tasto Sincronizza: il testo
// grezzo della risposta, quando il negozio risponde con una pagina web, era codice HTML che nessuno
// capiva.
//
// Caso tipico: la protezione anti-bot di Cloudflare davanti al negozio sfida le richieste che arrivano
// dai server (cf-mitigated: challenge, pagina «Just a moment...»). hard2Buff, 12/11/2026: ordini fermi da
// un giorno, e da un server Vercel di prova la sfida colpiva tutto il sito, con qualunque nome ci si
// presenti. Non si aggira: lo sblocca il negoziante in Cloudflare. Un IP da autorizzare non c'e', le
// funzioni Vercel non ne hanno uno fisso.
function erroreWoo(r: Response, text: string): Error {
  const titolo = (text.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim()
  if (r.headers.get('cf-mitigated') === 'challenge' || /^just a moment/i.test(titolo)) {
    return new Error('Il sito del negozio e\' protetto da Cloudflare, che blocca il nostro server con la verifica anti-bot («Just a moment...»): gli ordini non si possono leggere. Va sbloccato in Cloudflare: Security → Bots → disattiva «Bot Fight Mode», oppure in Security → WAF aggiungi una regola «Skip» per URI Path che inizia con /wp-json/wc/. L\'accesso agli ordini resta protetto dalla chiave API.')
  }
  if (/^\s*<(!doctype|html)/i.test(text)) {
    return new Error(`WooCommerce ${r.status}: il sito ha risposto con una pagina web invece che con i dati${titolo ? ` («${titolo.slice(0, 80)}»)` : ''}. Controlla l'indirizzo del negozio e che le API REST di WooCommerce siano raggiungibili.`)
  }
  return new Error(`WooCommerce ${r.status}: ${text.slice(0, 200)}`)
}

export async function wooGet(url: string, ck: string, cs: string, path: string, attesaMs = 20000): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { headers: wooHeaders(ck, cs), signal: AbortSignal.timeout(attesaMs) })
  const text = await r.text()
  if (!r.ok) throw erroreWoo(r, text)
  try { return JSON.parse(text) } catch { return null }
}

export async function wooPost(url: string, ck: string, cs: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { method: 'POST', headers: wooHeaders(ck, cs), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw erroreWoo(r, text)
  try { return JSON.parse(text) } catch { return null }
}

export async function wooPut(url: string, ck: string, cs: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { method: 'PUT', headers: wooHeaders(ck, cs), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw erroreWoo(r, text)
  try { return JSON.parse(text) } catch { return null }
}
