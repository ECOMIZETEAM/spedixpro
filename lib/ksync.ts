import { testoIndicaReso, prioritaStato } from '@/lib/spedisci'

/* Provider KSYNC / ParcelPilot — wrapper "ShippingGateway – API compatibile Poste Delivery Business".
 *
 * È un PDB DIRETTO: Poste Delivery Business raggiunto tramite il wrapper di ParcelPilot. Fino a ora in
 * MoovExpress il PDB passava SOLO dagli aggregatori (SpediamoPro "Poste Delivery Business S", DVA per i
 * PuntoPoste): questo è il primo contratto Poste diretto. Si modella come gli altri provider: un ACCOUNT
 * (clientId/secretId/costCenterCode) = una `corrieri.credenziali`, e OGNI contratto reale è una riga
 * `corrieri` `tipo='poste'` col suo `product` in settings (es. APT000901). Il nome tecnico "ParcelPilot/
 * KSync" NON si mostra mai (regola #8): a valle si vede il brand "Poste" — che è LECITO mostrare.
 *
 * Auth: OAuth2 client_credentials su /token → access_token (valido ~3599s); poi gli header `POSTE_clientID`
 * (il clientId) e `Authorization: Bearer <token>` sulle altre chiamate. NB: i NOMI header veri sono questi,
 * non i nomi degli schema swagger (PosteClientId/AccessToken). Sul DEMO l'auth è disabilitata: senza
 * clientId/secretId non si chiama /token e si va lisci. VALIDATO sul demo il 24/9 (create+etichetta+tracking).
 * PROD: https://ksyncwrapper.parcelpilot.it (confermato risponde). L'etichetta GET /labels/{token} è PUBBLICA
 * (nessun auth). Con provider=KSync molte operazioni non ci sono (501): deposits/giacenze, digipod/POD,
 * pickup/report, transittimes, international; pickup/booking solo operation=I. Create/etichetta/tracking sì.
 *
 * ATTENZIONE (differenze dal resto): il PESO è in GRAMMI ("1000"=1kg), la nazione Italia è "ITA1"
 * (dall'esempio ufficiale, accettato dal server), il contrassegno sta in `services` (codice APT… +
 * amount + paymentMode). Nessun ANNULLO in questa API (come per gli altri Poste: si gestisce a parte).
 */

const BASE = {
  // Il PROD lo dà ParcelPilot al go-live (il demo è su .demo.parcelpilot.it). Best-guess finché non arriva;
  // si può sovrascrivere per contratto con `credenziali.baseUrl`. Il demo ha l'auth DISABILITATA.
  prod: 'https://ksyncwrapper.parcelpilot.it',
  demo: 'https://ksyncwrapper.demo.parcelpilot.it',
}

export type KsyncCred = {
  clientId?: string
  secretId?: string
  costCenterCode?: string
  ambiente?: 'prod' | 'demo'   // default 'prod'
  baseUrl?: string             // override esplicito dell'host (se ParcelPilot ne dà uno diverso)
  scope?: string               // scope OAuth, se richiesto
}

function base(c: KsyncCred): string {
  if (c.baseUrl) return c.baseUrl.replace(/\/+$/, '')
  return BASE[c.ambiente === 'demo' ? 'demo' : 'prod']
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
// Token in cache in-process fino a poco prima della scadenza (expires_in): una chiamata /token per
// account, non una per spedizione. Sul demo (senza clientId/secretId) si torna null e si salta l'auth.
type TokCache = { token: string; scade: number }
const _tokenCache = new Map<string, TokCache>()
async function accessToken(c: KsyncCred): Promise<string | null> {
  if (!c.clientId || !c.secretId) return null   // demo: auth disabilitata
  const key = `${base(c)}|${c.clientId}`
  const now = Date.now()
  const cached = _tokenCache.get(key)
  if (cached && cached.scade > now + 30_000) return cached.token
  let r: Response
  try {
    r = await fetch(`${base(c)}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: c.clientId, secretId: c.secretId, scope: c.scope || '', grantType: 'client_credentials' }),
    })
  } catch (e: any) { throw new Error('KSync non raggiungibile: ' + (e?.message || 'rete')) }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j?.access_token) throw new Error(j?.error_description || j?.error || `KSync: token non emesso (${r.status})`)
  _tokenCache.set(key, { token: String(j.access_token), scade: now + (Number(j.expires_in) || 3600) * 1000 })
  return String(j.access_token)
}

async function chiama(c: KsyncCred, path: string, body: unknown): Promise<{ ok: boolean; status: number; j: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const tok = await accessToken(c)
  if (tok) { headers['Authorization'] = 'Bearer ' + tok; if (c.clientId) headers['POSTE_clientID'] = c.clientId }
  let r: Response
  try {
    r = await fetch(`${base(c)}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e: any) { throw new Error('KSync non raggiungibile: ' + (e?.message || 'rete')) }
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

// ── HELPER ────────────────────────────────────────────────────────────────────
// Peso: PDB lo vuole in GRAMMI, intero, come stringa. Le misure in cm.
const grammi = (kg: unknown) => String(Math.max(1, Math.round((Number(kg) || 0) * 1000)))
// PDB esige height/length/width valorizzati (vuoto → "Dati obbligatori mancanti: declared[].height"):
// se la misura manca si mette 1 cm (placeholder innocuo — il prezzo PDB va a peso), mai stringa vuota.
const cm = (v: unknown) => { const n = Math.round(Number(v) || 0); return String(n > 0 ? n : 1) }
// Nazione: Italia = "ITA1" (dall'esempio ufficiale, accettato dal server). Se già valorizzata a modo, passa.
const ISO_PDB: Record<string, string> = { IT: 'ITA1', ITA: 'ITA1', ITALIA: 'ITA1', '': 'ITA1' }
const nazione = (v: string | undefined) => ISO_PDB[String(v || '').toUpperCase().trim()] || String(v || 'ITA1').toUpperCase()

// Telefono per Poste/ParcelPilot: SOLO CIFRE. Un numero "normale" scritto con +39, spazi, / o - veniva
// inoltrato grezzo e il corriere lo RIFIUTAVA ("phone invalid"), mostrando all'utente "Telefono del
// mittente non valido" (anche quando a essere sbagliato era quello del DESTINATARIO: il messaggio è
// generico). Come GLS: tengo solo le cifre e le ULTIME 10, così +39/0039 e i separatori spariscono e
// resta il numero nazionale. Numeri più corti (es. fissi a 9) restano invariati.
const telPdb = (v?: string) => { const d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d }

// Testo per Poste/ParcelPilot (indirizzo, nome, citta…): la LDV RIFIUTA i caratteri escape e alcuni
// simboli — "Campo obbligatorio! Non sono ammessi i caratteri escape e simboli speciali, come \ " { } ~".
// Come telPdb per il telefono, li tolgo qui nel punto unico, cosi' un carattere vietato (es. una " o una
// graffa finita in un indirizzo) non blocca la spedizione. VERIFICATO sui dati veri (SDA EXPRESS L, 6.370
// LDV emesse dal 4/10): nessuna delle riuscite ha \ " { } ~ (toglierli non cambia nulla di cio' che oggi
// passa), MENTRE la "/" e' AMMESSA (741 indirizzi con "/" sono passati) → la "/" NON si tocca. Tolgo anche
// i caratteri di controllo; lo spazio sostituisce (non incolla le parole) e si normalizza. Se dopo resta
// vuoto e' un dato mancante vero (sede operativa non compilata): la LDV fallira' lecitamente, non e' un bug.
const pulisciPoste = (v?: string) => String(v ?? '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/["\\{}~]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Email per Poste/ParcelPilot: la LDV rifiuta un'email MALFORMATA ("Attenzione l'email mittente/
// destinatario non e' valida"), ma ACCETTA l'email vuota (verificato: LDV emesse senza email). Quindi se
// l'email non e' valida la OMETTO (stringa vuota) invece di far fallire tutta la spedizione: la notifica
// Poste e' un di piu', la consegna no. Prima trimmo gli spazi (POSTE tollera " x@y.it " ma il nostro dato
// a volte li porta); poi un controllo ASCII rigido ma non piu' stretto di POSTE (che accetta .gov.it,
// molti punti, maiuscole, fino a 64 char: tutti verificati tra le riuscite).
const RE_EMAIL_POSTE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const emailPoste = (v?: string) => { const e = String(v ?? '').trim(); return RE_EMAIL_POSTE.test(e) ? e : '' }

export type KsyncRecapito = {
  ragioneSociale: string
  referente?: string
  indirizzo: string
  civico?: string
  cap: string
  citta: string
  provincia?: string
  paese?: string
  email?: string
  telefono?: string
  cellulare?: string
}
export type KsyncCollo = { peso: number | string; altezza?: number | string; larghezza?: number | string; profondita?: number | string }

function party(r: KsyncRecapito) {
  return {
    zipCode: String(r.cap || ''), addressId: '', streetNumber: pulisciPoste(r.civico), city: pulisciPoste(r.citta),
    address: pulisciPoste(r.indirizzo), country: nazione(r.paese), countryName: 'Italia',
    nameSurname: pulisciPoste(r.ragioneSociale), contactName: pulisciPoste(r.referente || r.ragioneSociale),
    province: (r.provincia || '').toUpperCase(), email: emailPoste(r.email),
    phone: telPdb(r.telefono), cellphone: telPdb(r.cellulare), note1: '', note2: '',
  }
}

export type KsyncInput = {
  product: string                 // codice prodotto PDB del contratto (settings.product)
  costCenterCode?: string
  clientReferenceId?: string
  printFormat?: 'A4' | 'ZPL' | '1011'
  paperless?: boolean
  contenuto?: string
  note?: string
  shipmentDate?: string           // ISO; default adesso
  mittente: KsyncRecapito
  destinatario: KsyncRecapito
  colli: KsyncCollo[]
  contrassegno?: number
  codiceContrassegno?: string      // servizio COD (settings.codice_contrassegno, default APT000918)
  modalitaPagamentoCod?: string    // CON (contanti) / ABM / ACM …
  assicurata?: number
  codiceAssicurazione?: string     // servizio assicurazione (settings.codice_assicurazione), se presente
}

// Crea la LDV (/waybill/create). Torna l'LDV (waybills[0].code) e il downloadURL dell'etichetta.
export async function creaKsync(c: KsyncCred, dati: KsyncInput): Promise<{ ldv: string; downloadUrl: string; raw: any }> {
  const declared = dati.colli.map(p => ({ weight: grammi(p.peso), height: cm(p.altezza), length: cm(p.profondita), width: cm(p.larghezza) }))
  // Servizi accessori: SOLO se valorizzati (PDB rifiuta i campi COD vuoti — stessa trappola di Dielle).
  const services: Record<string, any> = {}
  if (dati.contrassegno) services[dati.codiceContrassegno || 'APT000918'] = { amount: (Number(dati.contrassegno) || 0).toFixed(2), paymentMode: dati.modalitaPagamentoCod || 'CON' }
  if (dati.assicurata && dati.codiceAssicurazione) services[dati.codiceAssicurazione] = { amount: (Number(dati.assicurata) || 0).toFixed(2) }

  const sender0 = party(dati.mittente)
  const receiver0 = party(dati.destinatario)
  // Body della LDV con un dato mittente/destinatario: funzione, così si può RITENTARE variandoli.
  const costruisciBody = (sender: any, receiver: any, pf: string = (dati.printFormat || '1011')) => ({
    costCenterCode: dati.costCenterCode || c.costCenterCode || '',
    paperless: dati.paperless ? 'true' : 'false',
    shipmentDate: dati.shipmentDate || new Date().toISOString(),
    waybills: [{
      // Il nostro riferimento interno (es. rif. ordine) → ksync lo mappa su numRifInterno, MAX 50 char
      // (confermato da ParcelPilot 1/10): tronco qui, nel punto unico, così crea e API v1 sono protette.
      clientReferenceId: String(dati.clientReferenceId || '').slice(0, 50),
      // FORMATO ETICHETTA: default '1011' (10x11) invece di 'A4'. VERIFICATO 8/10/2026 su APT000901:
      // POSTE/ParcelPilot restituisce un PDF 10,2x11,1 cm (prima dava ZPL/errore 112 — sistemato dal
      // fornitore). Chi chiama puo' forzarlo (dati.printFormat); se un prodotto non lo accetta, piu'
      // sotto c'e' il fallback ad 'A4' cosi' non fa fallire la spedizione.
      printFormat: pf,
      product: dati.product,
      data: {
        // Anche contenuto/note vanno a POSTE: stessa pulizia dei caratteri vietati.
        declared, content: pulisciPoste(dati.contenuto), note: pulisciPoste(dati.note),
        // `services` è OBBLIGATORIO anche senza accessori: omesso del tutto, "Dati obbligatori
        // mancanti: waybills[].data.services" (verificato 24/9). Va sempre presente, anche {}.
        services,
        sender, receiver,
      },
    }],
  })
  // Estrae l'errore POSTE da una risposta (null = andata bene). PDB lo mette in piu' punti.
  const erroreDi = (r: { ok: boolean; status: number; j: any }): string | null => {
    if (!r.ok) return r.j?.result?.errorDescription || `KSync: errore ${r.status}`
    if (r.j?.result && Number(r.j.result.errorCode) !== 0) return r.j.result.errorDescription || 'KSync: creazione non riuscita'
    const w = (Array.isArray(r.j?.waybills) ? r.j.waybills : [])[0]
    if (!w || Number(w.errorCode) !== 0 || !w.code) return w?.errorDescription || 'KSync: LDV non emessa'
    return null
  }

  let formatoCorrente = dati.printFormat || '1011'
  let r = await chiama(c, 'waybill/create', costruisciBody(sender0, receiver0, formatoCorrente))
  let err = erroreDi(r)
  // FALLBACK FORMATO: '1011' (10x11) e' il default; se un prodotto POSTE non lo accetta (es. errore sul
  // formato), ritento in 'A4' invece di far fallire la spedizione. Il 1° tentativo e' FALLITO (nessuna
  // LDV emessa) → niente doppione. '1011' resta quello voluto, A4 solo se il formato viene rifiutato.
  if (err && formatoCorrente !== 'A4' && /format/i.test(err)) {
    formatoCorrente = 'A4'
    r = await chiama(c, 'waybill/create', costruisciBody(sender0, receiver0, formatoCorrente))
    err = erroreDi(r)
  }
  // POSTE rifiuta l'email con una SUA regola (piu' severa di un check di formato): a volte boccia email
  // che paiono valide (es. arrivate dall'import). L'email e' OPZIONALE (le LDV senza email passano), la
  // consegna no. Quindi se POSTE si lamenta SOLO dell'email, ritento UNA volta SENZA email mittente/
  // destinatario (mantenendo il formato corrente). Il 1° tentativo e' FALLITO (nessuna LDV) → nessun
  // doppione. Copre qualunque email che POSTE non digerisce senza doverne indovinare la regola.
  if (err && /mail/i.test(err) && (sender0.email || receiver0.email)) {
    r = await chiama(c, 'waybill/create', costruisciBody({ ...sender0, email: '' }, { ...receiver0, email: '' }, formatoCorrente))
    err = erroreDi(r)
  }
  if (err) throw new Error(err)
  const j = r.j
  const w = (Array.isArray(j?.waybills) ? j.waybills : [])[0]
  const durl = String(w.downloadURL || '')
  return { ldv: String(w.code), downloadUrl: durl.startsWith('http') ? durl : (durl ? `${base(c)}${durl.startsWith('/') ? '' : '/'}${durl}` : ''), raw: j }
}

// Etichetta: si scarica dal downloadURL della create (target /labels/{token}). Torna i byte del PDF (o
// la stringa ZPL). Il token dell'URL può scadere: la si scarica e si salva alla creazione, come gli altri.
export async function etichettaKsync(c: KsyncCred, downloadUrlOrToken: string, formato: 'pdf' | 'zpl' = 'pdf'): Promise<{ contentType: string; bytes?: Buffer; zpl?: string }> {
  let url = downloadUrlOrToken || ''
  if (!/^https?:\/\//.test(url)) url = `${base(c)}/labels/${url.replace(/^\/?(labels\/)?/, '')}`
  const headers: Record<string, string> = {}
  const tok = await accessToken(c)
  if (tok) { headers['Authorization'] = 'Bearer ' + tok; if (c.clientId) headers['POSTE_clientID'] = c.clientId }
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`KSync: etichetta non disponibile (${r.status})`)
  if (formato === 'zpl') return { contentType: 'text/plain', zpl: await r.text() }
  return { contentType: 'application/pdf', bytes: Buffer.from(await r.arrayBuffer()) }
}

// Mappa la DESCRIZIONE dello stato Poste sui nostri stati (dizionario Poste PDB: "LA SPEDIZIONE E' STATA
// CONSEGNATA", "IN GIACENZA", …). Come mapStatoSpedisci/Dielle: RESO per primo, poi consegna, giacenza,
// e i movimenti. Si mappa sul testo, non sul `status` numerico (verboso ma autoesplicativo, e i codici
// Poste cambiano fra i prodotti).
export function mapStatoKsync(testo: string): string | null {
  const s = (testo || '').toLowerCase().trim()
  if (!s) return null
  if (testoIndicaReso(s)) return 'reso_mittente'
  if ((s.includes('consegnat') || s.includes('delivered')) && !s.includes('non consegnat') && !s.includes('non è stata consegnat') && !s.includes('mancata consegn')) {
    if (/ufficio postale|punto di giacenza|fermo deposito|fermoposta|punto di ritiro|locker|punto di consegna|fermopoint|giacenz/.test(s)) return 'in_consegna'
    return 'consegnata'
  }
  if (s.includes('giacenz')) return 'in_giacenza'
  if (/non andata a buon fine|consegna non riuscita|non consegnat|mancata consegn|tentata consegna|tentativo di consegna|destinatario assente|\bassente\b|non è stata consegnat/.test(s)) return 'non_consegnato'
  if (s.includes('in consegna') || s.includes('in distribuzione') || s.includes('distribuzione') || s.includes('out for delivery') || s.includes('in corso di consegna')) return 'in_consegna'
  if (/svincol/.test(s)) return 'in_transito'
  if (s.includes('transit') || s.includes('transito') || s.includes('arrivat') || s.includes('hub') || s.includes('partenz') || s.includes('partit') || s.includes('viaggio') || s.includes('smistament') || s.includes('lavorazione presso') || s.includes('in lavorazione')) return 'in_transito'
  if (s.includes('presa in carico') || s.includes('preso in caric') || s.includes('accettat') || s.includes('spedit') || s.includes('ritirat') || s.includes('affidat') || s.includes('picked')) return 'spedita'
  if (s.includes('rifiut') || s.includes('respint') || s.includes('exception') || s.includes('anomal') || s.includes('problema') || s.includes('indirizzo errato') || s.includes('indirizzo insufficiente') || s.includes('fallit')) return 'non_consegnato'
  return null
}

// Tracking (/tracking, formato Poste PDB). Verificato su demo: risposta
// { return: { outcome, code, shipment: [ { waybillNumber, returnFlag, tracking: [ { data, StatusDescription,
// status, officeDescription, … } ] } ] } }. Torno la forma che si aspetta la cron (come trackingBrt).
export async function trackingKsync(
  c: KsyncCred, ldv: string,
): Promise<{ stati: string[]; consegnata: boolean; eventi: { data: string; descrizione: string; luogo: string }[] }> {
  const body = { arg0: { shipmentsData: [{ waybillNumber: String(ldv), lastTracingState: 'N' }], statusDescription: 'E', customerType: 'DQ' } }
  const { ok, status, j } = await chiama(c, 'tracking', body)
  if (!ok) throw new Error(`KSync: tracking errore ${status}`)
  const ret = j?.return
  const ship = (Array.isArray(ret?.shipment) ? ret.shipment : []).find((s: any) => String(s?.waybillNumber || '') === String(ldv)) || (Array.isArray(ret?.shipment) ? ret.shipment[0] : null)
  const righe: any[] = Array.isArray(ship?.tracking) ? ship.tracking : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  for (const ev of righe) {
    const testo = String(ev?.StatusDescription || ev?.synthesisStatusDescription || ev?.appStatusDescription || '').trim()
    if (testo) stati.push(testo)
    const d = String(ev?.data || '').trim()   // "YYYY-MM-DD HH:mm:ss" (ora italiana, la gestisce istanteDaTesto)
    if (d && testo) eventi.push({ data: d, descrizione: testo, luogo: String(ev?.officeDescription || '').trim() })
  }
  // returnFlag='S' = il pacco è un ritorno al mittente (segnale forte, oltre alle descrizioni).
  if (String(ship?.returnFlag || '').toUpperCase() === 'S') stati.push('reso al mittente')
  const consegnata = stati.some(str => mapStatoKsync(str) === 'consegnata')
  return { stati, consegnata, eventi }
}

// Servizi accessori compatibili col prodotto (/waybill/services): per scoprire i codici (contrassegno,
// assicurazione…) validi per un contratto. Torna la lista dei codici + la mappa dettagliata.
export async function serviziKsync(c: KsyncCred, req: { product: string; mittente: KsyncRecapito; destinatario: KsyncRecapito; colli: KsyncCollo[]; contrassegno?: number; tipoContante?: string }): Promise<{ codici: string[]; serviceMap: any; raw: any }> {
  const body: any = {
    costCenterCode: c.costCenterCode || '', product: req.product,
    sender: party(req.mittente), receiver: party(req.destinatario),
    declared: req.colli.map(p => ({ weight: grammi(p.peso), height: cm(p.altezza), length: cm(p.profondita), width: cm(p.larghezza) })),
    declaredShipmentDate: new Date().toISOString(),
  }
  if (req.contrassegno) { body.cashAmount = (Number(req.contrassegno) || 0).toFixed(2); body.cashType = req.tipoContante || 'CON' }
  const { j } = await chiama(c, 'waybill/services', body)
  return { codici: Array.isArray(j?.services) ? j.services : [], serviceMap: j?.serviceMap || null, raw: j }
}

// ── GIACENZE (deposits) ─────────────────────────────────────────────────────
// Lista delle giacenze aperte (/deposits/list). Serve al controllo giacenze: se una che diamo per
// svincolata è ancora qui, il corriere non l'ha lavorata. `cdc` = centro di costo.
export async function giacenzeListaKsync(c: KsyncCred, filtro?: { dateFrom?: string; dateTo?: string; status?: string }): Promise<{ raw: any }> {
  const body: any = { cdc: c.costCenterCode || '', status: filtro?.status || '' }
  if (filtro?.dateFrom) body.dateFrom = filtro.dateFrom
  if (filtro?.dateTo) body.dateTo = filtro.dateTo
  const { j } = await chiama(c, 'deposits/list', body)
  return { raw: j }
}

// Svincolo di una giacenza (/deposits/release). Forma verificata dallo swagger:
//   { releaseAct: { shipmentId, releaseAction: "AZ0001" }, shipmentId: { item: [{ barcode }] }, address? }
// `releaseAction` è un codice PDB (es. AZ0001 = riconsegna, l'unico noto dall'esempio): i codici di
// reso/nuovo indirizzo li deve dare ParcelPilot, NON si inventano (muovono soldi). Per il nuovo indirizzo
// si passa `address`. Torna l'esito grezzo (la cascata/addebito li fa il chiamante).
export async function svincolaKsync(c: KsyncCred, req: { shipmentId: string; releaseAction: string; nuovoIndirizzo?: KsyncRecapito; officeId?: string }): Promise<{ ok: boolean; descrizione: string; raw: any }> {
  const body: any = {
    releaseAct: { shipmentId: req.shipmentId, releaseAction: req.releaseAction },
    shipmentId: { item: [{ barcode: req.shipmentId }] },
  }
  if (req.officeId) body.officeId = req.officeId
  if (req.nuovoIndirizzo) {
    const r = req.nuovoIndirizzo
    body.address = { item: [{ givenName: pulisciPoste(r.ragioneSociale), surname: '', streetNumber: pulisciPoste(r.civico), streetName: pulisciPoste(r.indirizzo), town: pulisciPoste(r.citta), region: (r.provincia || '').toUpperCase(), postCode: r.cap || '', country: nazione(r.paese), phone: telPdb(r.telefono), email: emailPoste(r.email) }] }
  }
  const { ok, j } = await chiama(c, 'deposits/release', body)
  const esito = String(j?.result?.result || j?.result || '').toUpperCase()
  return { ok: ok && esito !== 'KO', descrizione: String(j?.description || j?.result?.errorDescription || ''), raw: j }
}

// ── POD DIGITALE (digipod) ───────────────────────────────────────────────────
// Richiede la generazione della POD (/digipod/request): la si può chiedere per una o più LDV, con una
// mail dove ricevere l'esito. Poi si scarica con podScaricaKsync.
export async function podRichiediKsync(c: KsyncCred, ldv: string | string[], mail?: string): Promise<{ raw: any }> {
  const ldvs = Array.isArray(ldv) ? ldv : [ldv]
  const body: any = { barcode: { item: ldvs.map(b => ({ barcode: String(b) })) } }
  if (mail) body.mail = mail
  const { j } = await chiama(c, 'digipod/request', body)
  return { raw: j }
}
// Scarica la POD (/digipod/download) per una LDV. Torna i byte del PDF (o il grezzo se non è un PDF).
export async function podScaricaKsync(c: KsyncCred, ldv: string): Promise<{ contentType: string; bytes?: Buffer; raw?: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const tok = await accessToken(c)
  if (tok) { headers['Authorization'] = 'Bearer ' + tok; if (c.clientId) headers['POSTE_clientID'] = c.clientId }
  const r = await fetch(`${base(c)}/digipod/download`, { method: 'POST', headers, body: JSON.stringify({ barcode: String(ldv) }) })
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/pdf')) return { contentType: 'application/pdf', bytes: Buffer.from(await r.arrayBuffer()) }
  // Alcune risposte incapsulano il PDF in base64 dentro un JSON: lo gestiamo al primo caso reale.
  const j = await r.json().catch(() => ({}))
  const b64 = j?.pdf || j?.document || j?.content
  if (b64) return { contentType: 'application/pdf', bytes: Buffer.from(String(b64), 'base64') }
  return { contentType: 'application/json', raw: j }
}

// ── RITIRI (pickup) ──────────────────────────────────────────────────────────
// Prenota un ritiro (/pickup/booking). `bookingType` = tipo ritiro (RIT0001/2/3). `where` = indirizzo di
// ritiro, `content` = i colli. operation 'I' = inserimento. Verificato su demo: risposta { bookingId,
// result: { item: [{ result: 'OK', errorDescription }] } }. Torna { ok, bookingId, errore, raw }.
export async function ritiroPrenotaKsync(c: KsyncCred, req: { bookingType?: string; indirizzo: KsyncRecapito; colli?: KsyncCollo[]; numColli?: number; pesoKg?: number; shipmentId?: string; dataRitiro?: string; timeSlot?: string; note?: string }): Promise<{ ok: boolean; bookingId: string; errore: string; raw: any }> {
  const r = req.indirizzo
  const colli = req.colli && req.colli.length ? req.colli : [{ peso: req.pesoKg || 1 }]
  const content = {
    item: colli.map(p => ({ containerType: 'P', tipocontText: 'pacchi', quantity: req.numColli || colli.length || 1, weight: Number(p.peso) || 1, height: Math.round(Number(p.altezza) || 1) || 1, width: Math.round(Number(p.larghezza) || 1) || 1, length: Math.round(Number(p.profondita) || 1) || 1 })),
  }
  const body: any = {
    pickup: {
      item: [{
        operation: 'I', bookingType: req.bookingType || 'RIT0003', bookingId: '', pickupId: '',
        shipmentId: req.shipmentId || '', customerShipmentId: '',
        where: { item: [{ givenName: pulisciPoste(r.ragioneSociale), surname: pulisciPoste(r.referente), streetNumber: pulisciPoste(r.civico), streetName: pulisciPoste(r.indirizzo), town: pulisciPoste(r.citta), region: (r.provincia || '').toUpperCase(), postCode: r.cap || '', country: nazione(r.paese), phone: telPdb(r.telefono), email: emailPoste(r.email) }] },
        content,
        pickupDate: req.dataRitiro || '', timeSlot: req.timeSlot || 'AM', note1: req.note || '', note2: '', note3: '',
      }],
    },
  }
  const { j } = await chiama(c, 'pickup/booking', body)
  const it = j?.result?.item?.[0]
  const bookingId = String(j?.bookingId || it?.bookingId || j?.pickupId || '')
  const ok = !!bookingId && String(it?.result || '').toUpperCase() !== 'KO'
  return { ok, bookingId, errore: String(it?.errorDescription || j?.errorDescription || (Array.isArray(j?.errors) ? j.errors.join(' ') : '') || ''), raw: j }
}
// Report dei ritiri prenotati in un intervallo (/pickup/report).
export async function ritiroReportKsync(c: KsyncCred, filtro: { bookingType?: string; dateFrom: string; dateTo: string; status?: string }): Promise<{ raw: any }> {
  const body = { pickupFilter: { bookingType: filtro.bookingType || 'RIT0003', dateFrom: filtro.dateFrom, dateTo: filtro.dateTo, status: filtro.status || '' } }
  const { j } = await chiama(c, 'pickup/report', body)
  return { raw: j }
}
