// Helper PrestaShop Webservice API (Basic auth con API key, output JSON).
export function psHeaders(key: string): Record<string, string> {
  return { 'Authorization': 'Basic ' + Buffer.from(key + ':').toString('base64') }
}

function psUrl(url: string, pathAndQuery: string): string {
  const base = url.replace(/\/+$/, '')
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  return `${base}/api/${pathAndQuery}${sep}output_format=JSON`
}

export async function psGet(url: string, key: string, pathAndQuery: string): Promise<any> {
  const r = await fetch(psUrl(url, pathAndQuery), { headers: psHeaders(key), signal: AbortSignal.timeout(20000) })
  const text = await r.text()
  if (!r.ok) {
    if (r.status === 404) return null
    throw new Error(`PrestaShop ${r.status}: ${text.slice(0, 160)}`)
  }
  try { return JSON.parse(text) } catch { return null }
}

export async function psPut(url: string, key: string, resource: string, id: number | string, body: any): Promise<any> {
  const base = url.replace(/\/+$/, '')
  const r = await fetch(`${base}/api/${resource}/${id}?output_format=JSON`, {
    method: 'PUT',
    headers: { ...psHeaders(key), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`PrestaShop PUT ${r.status}: ${text.slice(0, 160)}`)
  try { return JSON.parse(text) } catch { return null }
}
