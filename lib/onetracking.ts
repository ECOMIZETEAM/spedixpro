// OneTracking filiali: il portale interno di Poste dove c'e' la RIMISURA del collo (pesoDim con le
// righe RILEVATO). Non ha API ne' login automatizzabile (SSO Oracle): il cookie lo rinnova a mano il
// master radice quando scade. Qui si tiene solo la MECCANICA — parse del cURL incollato, fetch che
// riconosce la sessione morta, scelta della rimisura piu' alta. La regola dei prezzi vive altrove.

export type SessioneOT = { url_template: string | null; headers: Record<string, string> | null }

const num = (s: any): number | null => {
  if (s === null || s === undefined || s === '' || s === '-') return null
  const n = parseFloat(String(s).replace(',', '.'))
  return isFinite(n) ? n : null
}

// Header che romperebbero una fetch server-side se rigiocati (pseudo-header HTTP/2, hop-by-hop, o
// calcolati da soli): si scartano. Il cookie e gli accept restano.
const HEADER_VIETATI = new Set([
  'host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding',
])

// Estrae url_template (con __LDV__ al posto della LDV) e gli header da un cURL "Copy as cURL" (bash).
export function parseCurl(curl: string): SessioneOT | null {
  if (!curl || typeof curl !== 'string') return null
  const testo = curl.replace(/\\\r?\n/g, ' ')   // unisce le righe spezzate con backslash

  // URL: primo argomento fra apici/virgolette dopo `curl`, o il primo http(s) trovato.
  let url: string | null = null
  const mUrl = testo.match(/curl\s+(?:-[A-Za-z]+\s+)*['"]([^'"]+)['"]/) || testo.match(/(https?:\/\/[^\s'"]+)/)
  if (mUrl) url = mUrl[1]
  if (!url) return null

  const headers: Record<string, string> = {}
  // -H 'name: value'  /  --header "name: value"
  const reH = /(?:-H|--header)\s+(['"])(.*?)\1/g
  let m: RegExpExecArray | null
  while ((m = reH.exec(testo)) !== null) {
    const idx = m[2].indexOf(':')
    if (idx <= 0) continue
    const k = m[2].slice(0, idx).trim()
    const v = m[2].slice(idx + 1).trim()
    if (!k || k.startsWith(':') || HEADER_VIETATI.has(k.toLowerCase())) continue
    headers[k] = v
  }
  // -b / --cookie 'cookie...'  (a volte il cookie sta qui invece che in -H)
  const reB = /(?:-b|--cookie)\s+(['"])(.*?)\1/g
  while ((m = reB.exec(testo)) !== null) {
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'cookie')) headers['cookie'] = m[2].trim()
  }

  // LDV -> __LDV__ nel percorso /dettaglio-spedizione/{LDV}/...
  const urlTpl = url.replace(/(\/dettaglio-spedizione\/)[^/?]+/, '$1__LDV__')
  if (!urlTpl.includes('__LDV__')) return null   // cURL della pagina sbagliata
  return { url_template: urlTpl, headers }
}

export type EsitoFetch = { scaduta: boolean; json: any | null; motivo?: string }

// Interroga il dettaglio di UNA LDV. Riconosce la sessione morta (redirect a login / 401-403 / HTML).
export async function fetchDettaglioOT(sess: SessioneOT, ldv: string): Promise<EsitoFetch> {
  if (!sess.url_template) return { scaduta: true, json: null, motivo: 'nessuna sessione' }
  const url = sess.url_template.replace('__LDV__', encodeURIComponent(ldv))
  let res: Response
  try {
    res = await fetch(url, { headers: sess.headers || {}, redirect: 'manual' })
  } catch (e: any) {
    return { scaduta: false, json: null, motivo: 'rete: ' + String(e?.message || e).slice(0, 80) }
  }
  // Redirect (a login) o non autorizzato = sessione scaduta.
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 401 || res.status === 403) {
    return { scaduta: true, json: null, motivo: 'http ' + res.status }
  }
  const text = await res.text()
  const t = text.trimStart().slice(0, 400).toLowerCase()
  if (t.startsWith('<') || t.includes('<html') || t.includes('login') || t.includes('oam')) {
    return { scaduta: true, json: null, motivo: 'pagina login' }
  }
  try {
    return { scaduta: false, json: JSON.parse(text) }
  } catch {
    return { scaduta: false, json: null, motivo: 'risposta non JSON' }
  }
}

export type Rilevato = { peso: number | null; lunghezza: number | null; larghezza: number | null; altezza: number | null }

// La rimisura PIU' ALTA fra le righe RILEVATO (il "valore piu' alto" che vuole Lorenzo): confronto
// per valore effettivo max(peso, volume/4000) — solo per SCEGLIERE; il motore ricalcola col fattore vero.
export function miglioreRilevato(json: any): Rilevato | null {
  const righe = Array.isArray(json?.pesoDim) ? json.pesoDim : []
  let best: Rilevato | null = null
  let bestEff = -1
  for (const r of righe) {
    if (r?.tipo !== 'RILEVATO') continue
    const peso = num(r?.peso)
    const L = num(r?.altezza), W = num(r?.larghezza), H = num(r?.profondita)
    const vol = (L && W && H) ? (L * W * H) / 4000 : 0
    const eff = Math.max(peso || 0, vol)
    if (eff <= 0) continue
    if (eff > bestEff) { bestEff = eff; best = { peso, lunghezza: L, larghezza: W, altezza: H } }
  }
  return best
}
