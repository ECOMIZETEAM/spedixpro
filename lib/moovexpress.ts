/* Integrazione "moovexpress": un master RIVENDE il contratto di un altro master (vedi
 * CONDIVISIONE-CONTRATTI.md). Quando il COMPRATORE spedisce su un corriere tipo='moovexpress', questo
 * client chiama l'`/api/v1` del VENDITORE con la api_key ricevuta all'Accetta (dentro corrieri.credenziali):
 * il venditore crea la spedizione VERA sul suo contratto (smistando al fornitore reale — spedisci/brt/…)
 * e torna numero + etichetta + prezzo. Il `prezzo` è ciò che il venditore addebita al compratore-ledger
 * = il COSTO per il compratore (W). È lo stesso schema degli altri provider (lib/spedisci, lib/brt…), ma
 * il "fornitore" è un altro portale MoovExpress raggiunto via HTTP — così il confine è già un'API il
 * giorno che i portali diventeranno domìni separati.
 *
 * NON tocca la contabilità: qui si parla solo con l'API. Il costo/ricavo lo registra il flusso di
 * creazione del compratore (addebitaCatena col prezzo tornato qui), come per ogni altro provider.
 */

export type MoovexpressCred = {
  api_key: string
  base_url?: string           // API del venditore; oggi lo stesso portale, domani un dominio suo
  fornitore_master_id?: string
  corriere_origine_id?: string
}

// Base dell'API del venditore. Oggi loopback sullo stesso portale; si può fissare per-contratto
// (cred.base_url) o via env, con default al dominio di produzione.
function baseUrl(cred: MoovexpressCred): string {
  const b = cred.base_url || process.env.MOOVEXPRESS_API_BASE || process.env.APP_URL || 'https://moovexpress.com'
  return b.replace(/\/+$/, '')
}

export type MoovexpressPacco = { weight: number; length?: number; width?: number; height?: number }
export type MoovexpressCreaInput = {
  packages: MoovexpressPacco[]
  shipFrom: Record<string, any>
  shipTo: Record<string, any>
  codValue?: number
  insuranceValue?: number
  notes?: string
  contenuto?: string
  pickup?: { requested: boolean; date?: string; time?: string }
}
export type MoovexpressCreaResult = {
  id: string           // id della spedizione DAL LATO VENDITORE (per scaricare l'etichetta)
  tracking: string
  prezzo: number       // W: quanto il venditore addebita al compratore (= costo per il compratore)
  label_url: string    // relativo: /api/v1/shipments/<id>/label
  ritiro?: any
}

export type MoovexpressQuotaInput = {
  packages: MoovexpressPacco[]
  shipTo: Record<string, any>
  codValue?: number
  insuranceValue?: number
}
export type MoovexpressQuota = {
  contratto: string | null
  zona: any
  peso_fatturato: number
  nolo: number
  prezzo: number       // W: il costo per il compratore
  valuta: string
  [k: string]: any
}

// PREVENTIVO (a costo zero, nessuna spedizione creata): chiede al venditore la tariffa del contratto
// per una destinazione. Serve a verificare il ponte (la key funziona, torna W) senza spendere
// un'etichetta, e più avanti a quotare/costruire il prezzo di vendita del compratore.
export async function quotaMoovexpress(cred: MoovexpressCred, dati: MoovexpressQuotaInput): Promise<MoovexpressQuota> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/rates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.api_key}` },
      body: JSON.stringify(dati),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  return j as MoovexpressQuota
}

// Crea la spedizione sul contratto del venditore. Lancia un Error col messaggio del fornitore su fallita.
export async function creaSpedizioneMoovexpress(cred: MoovexpressCred, dati: MoovexpressCreaInput): Promise<MoovexpressCreaResult> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.api_key}` },
      body: JSON.stringify(dati),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  if (!j?.tracking) throw new Error('Il fornitore non ha restituito un numero di spedizione.')
  return { id: String(j.id || ''), tracking: String(j.tracking), prezzo: Number(j.prezzo) || 0, label_url: String(j.label_url || ''), ritiro: j.ritiro }
}

// Scarica l'etichetta (PDF) dal venditore. `labelUrl` è quello tornato dalla create (relativo o assoluto).
export async function etichettaMoovexpress(cred: MoovexpressCred, labelUrl: string): Promise<Buffer> {
  if (!labelUrl) throw new Error('Nessuna etichetta da scaricare.')
  const url = /^https?:\/\//i.test(labelUrl) ? labelUrl : `${baseUrl(cred)}${labelUrl}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${cred.api_key}` } })
  if (!r.ok) throw new Error(`Etichetta non disponibile dal fornitore (${r.status})`)
  return Buffer.from(await r.arrayBuffer())
}
