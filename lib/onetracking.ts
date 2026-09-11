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

// Estrae gli header (cookie compreso) e l'URL del dettaglio da un cURL "Copy as cURL".
// ROBUSTO: basta un cURL di QUALSIASI richiesta OneTracking (il cookie vale per tutto il dominio).
// Se l'URL e' gia' quello del dettaglio lo si riusa (preservando il suffisso), altrimenti si
// costruisce l'endpoint noto del dettaglio (quello che restituisce pesoDim/RILEVATO).
const DETTAGLIO_DEFAULT = 'https://one-tracking-filiali.posteitaliane.it/api/dettaglio-spedizione/__LDV__/poste/-'

export function parseCurl(curl: string): SessioneOT | null {
  if (!curl || typeof curl !== 'string') return null
  const testo = curl.replace(/\\\r?\n/g, ' ')   // unisce le righe spezzate con backslash

  const headers: Record<string, string> = {}
  // -H 'name: value'  /  --header "name: value"  ([\s\S] per non dipendere dal flag 's')
  const reH = /(?:-H|--header)\s+(['"])([\s\S]*?)\1/g
  let m: RegExpExecArray | null
  while ((m = reH.exec(testo)) !== null) {
    const idx = m[2].indexOf(':')
    if (idx <= 0) continue
    const k = m[2].slice(0, idx).trim()
    const v = m[2].slice(idx + 1).trim()
    if (!k || k.startsWith(':') || HEADER_VIETATI.has(k.toLowerCase())) continue
    headers[k] = v
  }
  // -b / --cookie 'cookie...'  (Chrome spesso mette il cookie qui)
  const reB = /(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/g
  while ((m = reB.exec(testo)) !== null) {
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'cookie')) headers['cookie'] = m[2].trim()
  }
  // Senza cookie non c'e' sessione.
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'cookie')) return null

  // URL: se c'e' gia' il dettaglio-spedizione lo riuso (LDV -> __LDV__), altrimenti — se e' un cURL
  // di OneTracking/Poste — costruisco l'endpoint del dettaglio io.
  const dett = testo.match(/https?:\/\/[^\s'"]*\/dettaglio-spedizione\/[^\s'"]*/)
  let url_template: string | null = null
  if (dett) url_template = dett[0].replace(/(\/dettaglio-spedizione\/)[^/?]+/, '$1__LDV__')
  else if (/one-tracking-filiali|posteitaliane/i.test(testo)) url_template = DETTAGLIO_DEFAULT

  if (!url_template || !url_template.includes('__LDV__')) return null
  return { url_template, headers }
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

// Una riga di `pesoDim` come la manda Poste, gia' in numeri (li scrive con la virgola: "1,00").
// `quando`/`dove` ci sono solo sulle righe RILEVATO: sono la misura fatta in impianto.
export type MisuraColo = Rilevato & { quando: string | null; dove: string | null; volume: number | null; colli: number | null }

// IL COLLO VIENE MISURATO PIU' VOLTE LUNGO IL GIRO, e le letture non coincidono: sulla stessa LDV
// si vedono 31,5x27,5x10 in un hub e 32,5x29x10,5 in quello dopo. Quella che conta e' la PIU' ALTA:
// e' il valore su cui il fornitore fattura, quindi e' il valore che deve vedere anche il cliente.
// Il confronto si fa sul valore effettivo max(peso, volume/4000): il peso da nastro spesso e' 0,00
// o 0,16 kg (la bilancia non pesa i colli leggeri) e da solo direbbe che la misura non esiste.
// NB: il 4000 serve SOLO a ordinare le righe fra loro — il prezzo lo ricalcola il motore col
// fattore vero del contratto, che cambia per corriere e per master.
export function rimisureDaDettaglio(json: any): { dichiarato: MisuraColo | null; rilevati: MisuraColo[]; migliore: MisuraColo | null } {
  const righe = Array.isArray(json?.pesoDim) ? json.pesoDim : []
  const leggi = (r: any): MisuraColo => {
    // Poste chiama i tre lati altezza/larghezza/profondita: quello che conta e' il prodotto.
    const L = num(r?.altezza), W = num(r?.larghezza), H = num(r?.profondita)
    const quando = (String(r?.data || '').trim().replace(/^-$/, '')) || null
    const dove = (String(r?.filiale || '').trim().replace(/^-$/, '')) || null
    return { peso: num(r?.peso), lunghezza: L, larghezza: W, altezza: H,
      volume: (L && W && H) ? Math.round(L * W * H) : null, quando, dove, colli: num(r?.numColli) }
  }
  const efficace = (m: MisuraColo) => Math.max(m.peso || 0, m.volume ? m.volume / 4000 : 0)
  let dichiarato: MisuraColo | null = null
  const rilevati: MisuraColo[] = []
  for (const r of righe) {
    const tipo = String(r?.tipo || '').trim().toUpperCase()
    if (tipo === 'DICHIARATO') { if (!dichiarato) dichiarato = leggi(r); continue }
    // TUTTO QUELLO CHE COMINCIA PER "RILEVATO" E' UNA MISURA, non solo `RILEVATO`. Esiste anche
    // `RILEVATO MANUALE`: la misura presa a mano in filiale, rara (2 spedizioni su 150) ma proprio
    // quella dei colli fuori sagoma, con il peso vero invece dello 0,00 del nastro. Leggendo solo
    // `RILEVATO` si prendeva la scansione del documento (43x33x1) e si buttava via la misura del
    // pacco (100x77x74): il fornitore fatturava 142 kg e il popup ne avrebbe mostrati 0,35.
    if (!tipo.startsWith('RILEVATO')) continue
    const m = leggi(r)
    if (efficace(m) <= 0) continue      // riga tutta a "-": scansione senza misura, non dice niente
    rilevati.push(m)
  }
  // Piu' alta prima: la prima e' quella che vale. A PARI VALORE (entro il 2%) vince quella che ha un
  // peso vero: lo stesso collo viene registrato due volte, dal nastro con peso 0,00 e a mano con
  // 7,25 kg, e mostrare "40x31x25 · 0 kg" al cliente sembra un dato rotto — fatturare cambia nulla,
  // capirci cambia tutto.
  rilevati.sort((a, b) => {
    const ea = efficace(a), eb = efficace(b)
    if (Math.max(ea, eb) > 0 && Math.abs(ea - eb) / Math.max(ea, eb) <= 0.02) {
      return (b.peso || 0) - (a.peso || 0) || eb - ea
    }
    return eb - ea
  })
  return { dichiarato, rilevati, migliore: rilevati[0] || null }
}

// La rimisura PIU' ALTA fra le righe RILEVATO. Resta come prima per chi la usa (rettifiche), ma la
// regola sta ORA in rimisureDaDettaglio: una sola definizione di "piu' alta" per il ricalcolo e per
// quello che si mostra al cliente, altrimenti il popup e l'addebito raccontano numeri diversi.
export function miglioreRilevato(json: any): Rilevato | null {
  const m = rimisureDaDettaglio(json).migliore
  return m ? { peso: m.peso, lunghezza: m.lunghezza, larghezza: m.larghezza, altezza: m.altezza } : null
}
