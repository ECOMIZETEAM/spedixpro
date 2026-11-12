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
  // KSYNC DIRETTO (web service SOAP di KSync, senza il ponte di CT Solution). Se il contratto ha utente e
  // password KSync, la lettera di vettura si crea da qui. Vedi creaKsyncDiretto.
  wsUtente?: string
  wsPassword?: string
  wsHost?: string              // default https://ksync.guttadauro.it/KIPOINT_20 (produzione, dal manuale)
}

// Il contratto parla direttamente con KSync? Basta che abbia utente e password del web service.
export const ksyncDiretto = (c: KsyncCred) => !!(String(c.wsUtente || '').trim() && String(c.wsPassword || ''))

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
// CARATTERI TIPOGRAFICI: stesso rifiuto, ma POSTE non li elenca. Il 15/10/2026 un cliente non riusciva a
// spedire perche' il nome mittente era "PROFUMO DEL LEGNO – HOLZDUFT" (trattino lungo); il giorno prima,
// senza trattino, era partito. Sui dati di 30 giorni: su 55.415 LDV POSTE nessuna ha l'apostrofo curvo ’
// o il trattino lungo –, mentre sugli altri corrieri il ’ c'e' nel 2,7% delle spedizioni (sarebbero
// ~1.500). Li converto negli equivalenti semplici, che POSTE accetta ("'" in 4.801 LDV, "-" in 1.874);
// le virgolette curve fanno la fine della " dritta. Accentate e umlaut invece passano: non si toccano.
const pulisciPoste = (v?: string) => String(v ?? '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, ' ')
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

// ── KSYNC DIRETTO (web service SOAP) ──────────────────────────────────────────
// PERCHE': l'11/11/2026 dalle 17:30 il ponte di CT Solution (ksyncwrapper.parcelpilot.it) ha cominciato a
// rifiutare ogni creazione con «Lettera di vettura: Ordinante : campo obbligatorio.», e dalla mattina del
// 12/11 non si avviava piu' («HTTP Error 500.30 - ASP.NET Core app failed to start»): SDA EXPRESS L ferma
// per tutti i clienti. Il ponte non fa che girare le richieste a KSync, che invece funzionava (le lettere
// fatte a mano dal portale uscivano). KSync ha un suo web service ufficiale ("Manuale Operativo WS KSync"
// v2.0, agosto 2026, nella Knowledge base del portale): provato il 12/11 con l'utente del portale, prima
// in sola lettura (tracking) e poi con una lettera vera di prova, 282343J074953, uscita al primo colpo.
//
// Come funziona (manuale §5-7): POST SOAP a gt_btc_ldv_soap con utente, password, company "001" e il
// tracciato XML della lettera, escapato dentro <XMLData>. Torna, sempre escapato dentro <return>,
// BackEndStatus (OK/KO: KO = KSync non l'ha nemmeno presa in carico), Status (true/false: false = SDA
// l'ha rifiutata, i motivi in <message>), la LDV e l'etichetta in base64. «Ordinante» non e' un campo del
// tracciato: KSync lo ricava dall'utente con cui si entra.
//
// L'etichetta arriva come A4 con tre copie uguali (e una pagina in piu' col contrassegno, la "copia
// amministrativa"): la si salva cosi' com'e', ed e' lib/etichetta-sda.ts a ricavarne la resa.
const HOST_WS = 'https://ksync.guttadauro.it/KIPOINT_20'
const escXml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const unescXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const tagXml = (t: string, v: unknown) => { const s = String(v ?? ''); return s === '' ? `<${t}/>` : `<${t}>${escXml(s)}</${t}>` }
const primoTag = (xml: string, t: string) => { const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1] : null }
const tuttiTag = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map(m => m[1])
// Il tracciato KSync ha campi di 50 caratteri (C*50, manuale §6): oltre, si taglia qui invece di farsi
// rifiutare la lettera. L'email no: tagliata sarebbe sbagliata, quindi se e' troppo lunga si omette.
const c50 = (v?: string) => pulisciPoste(v).slice(0, 50)
// Data di spedizione: gg/mm/aaaa, ora italiana (il server gira in UTC: dopo mezzanotte sarebbe ieri, e
// KSync rifiuta una data passata).
const dataKsync = (iso?: string) => new Date(iso || Date.now()).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
// Misure e peso: KSync li vuole tutti valorizzati (N*10,2). Come col ponte, una misura mancante vale 1.
const numKsync = (v: unknown) => { const n = Number(v) || 0; return (n > 0 ? n : 1).toFixed(2) }

function personaKsync(r: KsyncRecapito) {
  const email = emailPoste(r.email)
  return tagXml('cap', String(r.cap || '').trim().slice(0, 5)) + tagXml('codNazione', 'ITA') + tagXml('email', email.length <= 50 ? email : '')
    + tagXml('indirizzo', c50([r.indirizzo, r.civico].filter(Boolean).join(' '))) + tagXml('intestatario', c50(r.ragioneSociale))
    + tagXml('localita', c50(r.citta)) + tagXml('provincia', String(r.provincia || '').toUpperCase().trim().slice(0, 5))
    + tagXml('referente', c50(r.referente)) + tagXml('telefono', telPdb(r.telefono || r.cellulare)) + tagXml('tipoAnagrafica', 'S')
}

// Il tracciato della lettera (manuale §6), negli stessi tag e nello stesso ordine degli esempi.
function tracciatoKsync(dati: KsyncInput, conEmail: boolean): string {
  const senzaEmail = (r: KsyncRecapito) => (conEmail ? r : { ...r, email: '' })
  let accessori = ''
  if (Number(dati.contrassegno) > 0) {
    // CON contanti, ABM assegno bancario, ACM assegno circolare: gli stessi codici di lib/contrassegno-modalita.
    accessori += `<contrassegno>${tagXml('codTipoPagamento', dati.modalitaPagamentoCod || 'CON')}${tagXml('contrassegnoValore', (Number(dati.contrassegno) || 0).toFixed(2))}</contrassegno>`
  }
  // Assicurazione: solo se il contratto la prevede (codiceAssicurazione), come col ponte. KSync la vuole
  // a fasce (AS01-AS04) o "in percentuale" sul valore dichiarato: il ponte mandava il solo importo,
  // quindi l'equivalente e' la percentuale sul valore.
  if (Number(dati.assicurata) > 0 && dati.codiceAssicurazione) {
    accessori += `<assicurataPercentuale>${tagXml('assicurataValore', (Number(dati.assicurata) || 0).toFixed(2))}</assicurataPercentuale>`
  }
  const colli = dati.colli.map(p => `<element>${tagXml('altezza', numKsync(p.altezza))}${tagXml('larghezza', numKsync(p.larghezza))}${tagXml('peso', numKsync(p.peso))}${tagXml('profondita', numKsync(p.profondita))}</element>`).join('')
  return '<?xml version="1.0" encoding="UTF-8"?><root>'
    // Formati di KSync: A4, A3, ZPL. Il "1011" del ponte qui non esiste: si chiede l'A4.
    + tagXml('formatoStampa', dati.printFormat === 'ZPL' ? 'ZPL' : 'A4')
    + '<ldv><datiSpedizione>' + (accessori ? `<accessori>${accessori}</accessori>` : '<accessori/>')
    // S09 = EXTRA LARGE, l'unico prodotto del manuale (il product del ponte, APT000901, qui non vale).
    + tagXml('codiceServizio', /^S\d{2}$/.test(String(dati.product || '')) ? dati.product : 'S09')
    + '<datiGenerali>' + tagXml('contenuto', c50(dati.contenuto)) + tagXml('dataSpedizione', dataKsync(dati.shipmentDate))
    + tagXml('note', pulisciPoste(dati.note).slice(0, 255)) + tagXml('numRifInterno', c50(dati.clientReferenceId)) + '</datiGenerali>'
    + `<sezioneColli><colli>${colli}</colli></sezioneColli></datiSpedizione>`
    + `<destinatario>${personaKsync(senzaEmail(dati.destinatario))}</destinatario><mittente>${personaKsync(senzaEmail(dati.mittente))}</mittente>`
    + '</ldv></root>'
}

async function creaKsyncDiretto(c: KsyncCred, dati: KsyncInput): Promise<{ ldv: string; downloadUrl: string; raw: any; pdf?: Buffer }> {
  const host = String(c.wsHost || HOST_WS).replace(/\/+$/, '')
  const invia = async (conEmail: boolean) => {
    const body = '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
      + '<gt_btc_ldv_soap_Run xmlns="http://gt_btc_ldv_soap.ws.localhost/">'
      + tagXml('m_UserName', String(c.wsUtente || '').trim()) + tagXml('m_Password', c.wsPassword) + tagXml('m_Company', '001')
      + tagXml('XMLData', tracciatoKsync(dati, conEmail)) + '<UUID></UUID>'
      + '</gt_btc_ldv_soap_Run></soap:Body></soap:Envelope>'
    let r: Response
    try {
      r = await fetch(`${host}/servlet/gt_btc_ldv_soap`, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' }, body })
    } catch (e: any) { throw new Error('KSync non raggiungibile: ' + (e?.message || 'rete')) }
    const testo = await r.text()
    const ret = primoTag(testo, 'return')
    const xml = ret != null ? unescXml(ret) : ''
    let errore: string | null = null
    if (!r.ok || ret == null) errore = unescXml(primoTag(testo, 'faultstring') || '') || `KSync: errore ${r.status}`
    else if (String(primoTag(xml, 'BackEndStatus') || '').trim().toUpperCase() !== 'OK') errore = unescXml(primoTag(xml, 'BackEndMessage') || '') || 'KSync: lettera non presa in carico'
    else if (String(primoTag(xml, 'Status') || '').trim().toLowerCase() !== 'true') errore = tuttiTag(xml, 'message').map(m => unescXml(m).trim()).filter(Boolean).join(' - ') || 'KSync: LDV non emessa'
    const ldv = String(primoTag(xml, 'Ldv') || '').trim()
    if (!errore && !ldv) errore = 'KSync: LDV non emessa'
    return { errore, xml, ldv }
  }
  let r = await invia(true)
  // Come col ponte: se Poste boccia SOLO l'email, si riprova una volta senza (la prima non ha emesso
  // nessuna lettera, quindi niente doppione). L'email e' un di piu', la consegna no.
  if (r.errore && /mail/i.test(r.errore) && (emailPoste(dati.mittente.email) || emailPoste(dati.destinatario.email))) r = await invia(false)
  if (r.errore) throw new Error(r.errore)
  const b64 = String(primoTag(r.xml, 'PDFBase64') || '').replace(/\s+/g, '')
  // In raw niente etichetta (e' grande, sta gia' in pdf) e niente credenziali: LDV, colli, UUID della transazione.
  return {
    ldv: r.ldv, downloadUrl: '', pdf: b64 ? Buffer.from(b64, 'base64') : undefined,
    raw: { diretto: true, ldv: r.ldv, uuid: String(primoTag(r.xml, 'UUID') || '').trim() || null, colli: tuttiTag(r.xml, 'sticker').map(s => s.trim()) },
  }
}

// Crea la LDV. Col web service diretto di KSync se il contratto ne ha le credenziali (torna anche il PDF);
// altrimenti col ponte (/waybill/create), che torna l'LDV (waybills[0].code) e il downloadURL dell'etichetta.
export async function creaKsync(c: KsyncCred, dati: KsyncInput): Promise<{ ldv: string; downloadUrl: string; raw: any; pdf?: Buffer }> {
  if (ksyncDiretto(c)) return creaKsyncDiretto(c, dati)
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
  // L'ESITO STA IN result.item[0].result ("OK" / "KO"), e KSync risponde HTTP 200 anche quando rifiuta
  // (provato in produzione il 19/10: "Dati obbligatori mancanti: releaseAct" con HTTP 200 e item KO).
  // Prima si leggeva result.result, che non esiste: un rifiuto passava per riuscito e lo svincolo veniva
  // addebitato e segnato fatto. Ora vale solo un OK esplicito.
  const item = Array.isArray(j?.result?.item) ? j.result.item[0] : null
  const esito = String(item?.result ?? j?.result?.result ?? '').toUpperCase()
  const descrizione = String((esito === 'OK' ? j?.description : item?.errorDescription) || j?.description || j?.result?.errorDescription || '')
  return { ok: ok && esito === 'OK', descrizione, raw: j }
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
