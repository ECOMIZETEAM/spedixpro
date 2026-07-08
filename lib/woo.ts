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

export async function wooGet(url: string, ck: string, cs: string, path: string): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { headers: wooHeaders(ck, cs), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw new Error(`WooCommerce ${r.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return null }
}

export async function wooPost(url: string, ck: string, cs: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { method: 'POST', headers: wooHeaders(ck, cs), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw new Error(`WooCommerce ${r.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return null }
}

export async function wooPut(url: string, ck: string, cs: string, path: string, body: any): Promise<any> {
  const r = await fetch(`${wooBase(url)}${path}`, { method: 'PUT', headers: wooHeaders(ck, cs), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) throw new Error(`WooCommerce ${r.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch { return null }
}
