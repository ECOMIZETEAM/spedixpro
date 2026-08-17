// ─────────────────────────────────────────────────────────────────────────────
// GLS Italy — web service DIRETTO (contratto proprio del master)
//
// Endpoint: labelservice.gls-italy.com/ilswebservice.asmx (SOAP 1.1).
// STRUTTURA VERIFICATA il 17/08/2026 contro l'API vera (contratto GLS di Quick): creata una
// spedizione di prova (n° 860091374), scaricata l'etichetta PDF reale e annullata. Le tre
// operazioni che servono:
//
//  • AddParcel(XMLInfoParcel: string)  — crea la spedizione, torna NumeroSpedizione.
//      XMLInfoParcel = <Info> con le credenziali (SedeGls/CodiceClienteGls/PasswordClienteGls)
//      come figli, poi <Parcel> con CodiceContrattoGls + i campi. NB: la password si chiama
//      PasswordClienteGls (non "Password"), e le credenziali stanno su <Info>, NON dentro <Parcel>
//      (metterle dentro dava il .NET "Object reference not set" — errore generico di struttura).
//      L'etichetta NON torna qui (PdfLabel vuoto): va richiesta con GetPdfBySped.
//  • GetPdfBySped(...)  — argomenti SEPARATI (non un XML): SedeGls, CodiceCliente, Password,
//      CodiceContratto, NumeroSpedizione, Bda, NumeroCollo, TipoPorto. Torna il PDF in base64
//      dentro <GetPdfBySpedResult>. ATTENZIONE ai nomi: qui è CodiceCliente/Password/CodiceContratto
//      (senza il suffisso "Gls").
//  • DeleteSped(SedeGls, CodiceClienteGls, PasswordClienteGls, NumSpedizione) — annulla.
//
// Regola fissa: le credenziali di produzione stanno nella colonna corrieri.credenziali (dal
// pannello), MAI in chat. Qui arrivano già lette da chi chiama.
// ─────────────────────────────────────────────────────────────────────────────

const GLS_ENDPOINT = 'https://labelservice.gls-italy.com/ilswebservice.asmx'
const GLS_NS = 'https://labelservice.gls-italy.com/'

export type CredenzialiGls = {
  sigla_sede?: string        // SedeGls
  user_webservice?: string   // CodiceClienteGls / CodiceCliente
  password_webservice?: string // PasswordClienteGls / Password
  codice_contratto?: string  // CodiceContrattoGls / CodiceContratto
}

export type ParcelGls = {
  ragioneSociale: string
  indirizzo: string
  localita: string
  cap: string
  provincia: string
  colli: number
  pesoReale: number          // kg
  bda?: string               // riferimento ordine/documento (max 20)
  importoContrassegno?: number   // EUR, 0 = niente COD
  modalitaIncasso?: string       // codice metodo incasso (dipende dal contratto)
  assicurazione?: number         // EUR
  note?: string                  // Notespedizione
}

export type RisultatoGls = {
  // NUDO (es. 860091374): è quello che vogliono GetPdfBySped e DeleteSped.
  numeroSpedizione: string | null
  // TRACKING per il cliente = SiglaMittente + numero (es. NL860091374). La sigla è la sede del
  // CONTRATTO (SedeGls), costante: Quick "GLS NL LIGHT" → NL; Ecomize "GLS TR" → TR. È definitivo
  // anche in "GLS Check". NB: NON è la sigla di DESTINO (M2/DUOMO…), che varia e manca in GLS Check.
  tracking: string | null
  siglaMittente: string | null
  siglaSedeDestino: string | null
  // true = indirizzo non instradato: numero valido ma la sede lo rilavora a mano. Da mostrare.
  glsCheck: boolean
  pdfBase64: string | null
  errore: string | null
  raw: string
}

// Escape per contenuto XML.
function escXml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// GLS vuole il peso col separatore DECIMALE VIRGOLA (formato IT).
function pesoIt(kg: number): string {
  const n = Number.isFinite(kg) && kg > 0 ? kg : 1
  return n.toFixed(2).replace('.', ',')
}
function euroIt(v: number): string {
  return (Number.isFinite(v) ? v : 0).toFixed(2).replace('.', ',')
}

// Emette un tag solo se il valore c'è.
function tag(nome: string, valore: unknown): string {
  const s = valore === 0 ? '0' : String(valore ?? '').trim()
  if (s === '') return ''
  return `<${nome}>${escXml(s)}</${nome}>`
}

// Estrae il valore del primo tag <nome ...>…</nome> (case-insensitive), ovunque annidato.
function estraiTag(xml: string, nome: string): string | null {
  const m = new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`, 'i').exec(xml)
  return m ? m[1] : null
}
function faultString(xml: string): string | null {
  return estraiTag(xml, 'faultstring')
}

// Costruisce l'XMLInfoParcel per AddParcel (STRUTTURA VERIFICATA).
export function costruisciXmlInfoParcel(cred: CredenzialiGls, p: ParcelGls): string {
  const info =
    tag('SedeGls', cred.sigla_sede) +
    tag('CodiceClienteGls', cred.user_webservice) +
    tag('PasswordClienteGls', cred.password_webservice)
  const parcel = [
    tag('CodiceContrattoGls', cred.codice_contratto),
    tag('RagioneSociale', (p.ragioneSociale || '').substring(0, 70)),
    tag('Indirizzo', (p.indirizzo || '').substring(0, 70)),
    tag('Localita', (p.localita || '').substring(0, 50)),
    tag('Zipcode', p.cap),
    tag('Provincia', (p.provincia || '').substring(0, 2).toUpperCase()),
    tag('Colli', Math.max(1, Math.round(p.colli || 1))),
    tag('PesoReale', pesoIt(p.pesoReale)),
    p.importoContrassegno && p.importoContrassegno > 0 ? tag('Importocontrassegno', euroIt(p.importoContrassegno)) : '',
    p.importoContrassegno && p.importoContrassegno > 0 && p.modalitaIncasso ? tag('ModalitaIncasso', p.modalitaIncasso) : '',
    p.assicurazione && p.assicurazione > 0 ? tag('Assicurazione', euroIt(p.assicurazione)) : '',
    p.note ? tag('Notespedizione', p.note.substring(0, 100)) : '',
    p.bda ? tag('Bda', String(p.bda).substring(0, 20)) : '',
  ].filter(Boolean).join('')
  return `<Info>${info}<Parcel>${parcel}</Parcel></Info>`
}

// Chiamata SOAP 1.1: `innerBody` è già il contenuto interno di <Operazione xmlns=...>…</Operazione>.
async function chiamaGls(operazione: string, innerBody: string, timeoutMs = 20000): Promise<string> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<${operazione} xmlns="${GLS_NS}">${innerBody}</${operazione}>` +
    `</soap:Body></soap:Envelope>`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(GLS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `"${GLS_NS}${operazione}"` },
      body, signal: ctrl.signal,
    })
    const testo = await res.text()
    // GLS restituisce i SOAP Fault con HTTP 500: il testo va comunque letto e interpretato.
    return testo
  } finally {
    clearTimeout(t)
  }
}

// Crea una spedizione GLS. Torna il NumeroSpedizione (o l'errore GLS).
export async function creaSpedizioneGls(cred: CredenzialiGls, parcel: ParcelGls): Promise<RisultatoGls> {
  const xml = costruisciXmlInfoParcel(cred, parcel)
  let soap: string
  try {
    soap = await chiamaGls('AddParcel', `<XMLInfoParcel>${escXml(xml)}</XMLInfoParcel>`)
  } catch (e) {
    // Rete/timeout PRIMA di una risposta: non c'è (quasi certamente) nessun collo creato.
    return { numeroSpedizione: null, tracking: null, siglaMittente: null, siglaSedeDestino: null, glsCheck: false, pdfBase64: null, errore: 'GLS non raggiungibile: ' + (e instanceof Error ? e.message : String(e)), raw: '' }
  }
  const fault = faultString(soap)
  // il contenuto utile è XML-escapato dentro <AddParcelResult>
  const inner = (estraiTag(soap, 'AddParcelResult') ?? soap)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const numRaw = (estraiTag(inner, 'NumeroSpedizione') || '').trim()
  // 999999999 è il sentinella d'errore di GLS (non un numero vero).
  const numeroSpedizione = numRaw && /\d/.test(numRaw) && numRaw !== '999999999' ? numRaw : null
  const siglaMittente = (estraiTag(inner, 'SiglaMittente') || '').trim() || null
  const siglaSedeDestino = (estraiTag(inner, 'SiglaSedeDestino') || '').trim() || null
  const descrDestino = (estraiTag(inner, 'DescrizioneSedeDestino') || '').trim()
  const glsCheck = /gls\s*check/i.test(descrDestino)
  // Tracking = sigla sede del CONTRATTO (mittente) + numero. Fallback alla SedeGls delle credenziali
  // se la risposta non riportasse la sigla.
  const prefisso = (siglaMittente || (cred.sigla_sede || '')).trim()
  const tracking = numeroSpedizione ? (prefisso + numeroSpedizione) : null
  const errGls = estraiTag(inner, 'DescrizioneErrore') || estraiTag(inner, 'Errore')
  const errore = numeroSpedizione ? null : (fault || errGls || 'GLS non ha restituito un numero spedizione')
  return { numeroSpedizione, tracking, siglaMittente, siglaSedeDestino, glsCheck, pdfBase64: null, errore, raw: (soap || '').substring(0, 2000) }
}

// Scarica l'etichetta PDF (base64) di una spedizione già creata.
export async function etichettaGls(
  cred: CredenzialiGls, numeroSpedizione: string,
  opts?: { bda?: string; numeroCollo?: string; tipoPorto?: string }
): Promise<{ pdfBase64: string | null; errore: string | null }> {
  const inner =
    tag('SedeGls', cred.sigla_sede) +
    tag('CodiceCliente', cred.user_webservice) +
    tag('Password', cred.password_webservice) +
    tag('CodiceContratto', cred.codice_contratto) +
    tag('NumeroSpedizione', numeroSpedizione) +
    `<Bda>${escXml(opts?.bda || '')}</Bda>` +
    `<NumeroCollo>${escXml(opts?.numeroCollo || '')}</NumeroCollo>` +
    `<TipoPorto>${escXml(opts?.tipoPorto || '')}</TipoPorto>`
  const soap = await chiamaGls('GetPdfBySped', inner)
  const b64 = estraiTag(soap, 'GetPdfBySpedResult')
  const pulito = (b64 || '').replace(/\s+/g, '')
  // un PDF vero in base64 è lungo e inizia con "JVBER" (%PDF); sotto una certa soglia è un errore.
  if (pulito.length > 500 && /^JVBER/i.test(pulito)) return { pdfBase64: pulito, errore: null }
  return { pdfBase64: null, errore: faultString(soap) || 'Etichetta non disponibile' }
}

// Annulla una spedizione GLS (DeleteSped). Torna true se l'annullo è confermato.
export async function annullaSpedizioneGls(cred: CredenzialiGls, numeroSpedizione: string): Promise<boolean> {
  try {
    const inner =
      tag('SedeGls', cred.sigla_sede) +
      tag('CodiceClienteGls', cred.user_webservice) +
      tag('PasswordClienteGls', cred.password_webservice) +
      tag('NumSpedizione', numeroSpedizione)
    const soap = await chiamaGls('DeleteSped', inner)
    return /avvenut/i.test(soap) // "Eliminazione della spedizione N avvenuta."
  } catch {
    return false
  }
}

// Comodo per il percorso di creazione: crea + scarica subito l'etichetta.
export async function creaSpedizioneConEtichettaGls(cred: CredenzialiGls, parcel: ParcelGls): Promise<RisultatoGls> {
  const ris = await creaSpedizioneGls(cred, parcel)
  if (!ris.numeroSpedizione) return ris
  // Etichetta best-effort: la spedizione è GIÀ creata, un errore qui non deve propagarsi
  // (altrimenti il chiamante crederebbe fallita una spedizione che invece esiste).
  try {
    const et = await etichettaGls(cred, ris.numeroSpedizione, { bda: parcel.bda })
    return { ...ris, pdfBase64: et.pdfBase64 }
  } catch {
    return ris // l'etichetta la riprende il recupero in background
  }
}
