// ─────────────────────────────────────────────────────────────────────────────
// GLS Italy — web service DIRETTO (contratto proprio del master)
//
// Perché esiste: alcuni master hanno un contratto GLS loro (es. Quick "GLS NL LIGHT",
// Ecomize LL "GLS TR") e vogliono spedirci sopra senza passare da un rivenditore. GLS
// espone un web service SOAP: `labelservice.gls-italy.com/ilswebservice.asmx`.
// Endpoint e operazione CONFERMATI dalla doc ASMX ufficiale (op=AddParcel):
//   POST text/xml, SOAPAction "https://labelservice.gls-italy.com/AddParcel",
//   metodo AddParcel(XMLInfoParcel: string) -> AddParcelResult: xml.
// AddParcel è SINCRONO: nella stessa risposta arrivano il numero spedizione E l'etichetta.
//
// ⚠️ LA NIDIFICAZIONE ESATTA di XMLInfoParcel (root <Info>, figlio <Parcel>, campi come
//    elementi-figli) è ricostruita dall'SDK open-source reale `markosirec/gls-italy-sdk`
//    (mapping setter→tag: RagioneSociale/Indirizzo/Localita/Zipcode/Provincia/PesoReale/
//    Colli/Importocontrassegno/Bda/…; risposta: NumeroSpedizione + PdfLabel). NON è verificata
//    contro l'API vera. Per questo NON si collega al percorso crea finché un'etichetta di prova
//    (endpoint /api/corrieri/gls/test) non torna corretta con credenziali reali. Se la struttura
//    è sbagliata GLS risponde con un XML di errore parlante, che il test mostra grezzo.
//    Regola fissa: mai spedire pacchi veri con codice corriere non testato (REGOLE.md).
// ─────────────────────────────────────────────────────────────────────────────

const GLS_ENDPOINT = 'https://labelservice.gls-italy.com/ilswebservice.asmx'
const GLS_NS = 'https://labelservice.gls-italy.com/'

export type CredenzialiGls = {
  sigla_sede?: string        // SedeGls (es. "MI")
  user_webservice?: string   // CodiceClienteGls (il "codice cliente" = utente del webservice)
  password_webservice?: string
  codice_contratto?: string  // CodiceContrattoGls
}

export type ParcelGls = {
  ragioneSociale: string
  indirizzo: string
  localita: string
  cap: string
  provincia: string
  colli: number
  pesoReale: number          // kg
  bda?: string               // riferimento ordine/documento
  email?: string
  cellulare?: string
  importoContrassegno?: number   // EUR, 0 = niente COD
  modalitaIncasso?: string       // codice metodo incasso (dipende dal contratto)
  assicurazione?: number         // EUR
  note?: string
  tipoCollo?: string             // "Normale" | "Fragile" (dal settings del contratto)
}

export type RisultatoGls = {
  numeroSpedizione: string | null
  pdfBase64: string | null
  zpl: string | null
  errore: string | null
  raw: string
}

// Escape per contenuto XML (i campi vanno dentro l'XMLInfoParcel).
function escXml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// GLS Italia vuole il peso col separatore DECIMALE VIRGOLA (formato IT).
function pesoIt(kg: number): string {
  const n = Number.isFinite(kg) && kg > 0 ? kg : 1
  return n.toFixed(2).replace('.', ',')
}

// Emette un tag solo se il valore c'è (evita campi vuoti che alcune validazioni rifiutano).
function tag(nome: string, valore: unknown): string {
  const s = valore === 0 ? '0' : String(valore ?? '').trim()
  if (s === '') return ''
  return `<${nome}>${escXml(s)}</${nome}>`
}

// Costruisce l'XMLInfoParcel: un <Parcel> (con dentro le credenziali + i dati del collo)
// dentro il root <Info>. Un solo Parcel per chiamata (multicollo: Colli>1 sulla stessa LDV).
export function costruisciXmlInfoParcel(cred: CredenzialiGls, p: ParcelGls): string {
  const campi = [
    // Credenziali (l'SDK reale le fonde dentro ogni Parcel)
    tag('SedeGls', cred.sigla_sede),
    tag('CodiceClienteGls', cred.user_webservice),
    tag('Password', cred.password_webservice),
    tag('CodiceContrattoGls', cred.codice_contratto),
    // Destinatario
    tag('RagioneSociale', p.ragioneSociale?.substring(0, 70)),
    tag('Indirizzo', p.indirizzo?.substring(0, 70)),
    tag('Localita', p.localita?.substring(0, 50)),
    tag('Zipcode', p.cap),
    tag('Provincia', (p.provincia || '').substring(0, 2).toUpperCase()),
    // Spedizione
    tag('Colli', Math.max(1, Math.round(p.colli || 1))),
    tag('PesoReale', pesoIt(p.pesoReale)),
    tag('TipoPorto', 'F'), // Franco: spese a carico del mittente (contratto)
    p.tipoCollo && /fragile/i.test(p.tipoCollo) ? tag('TipoCollo', 'F') : '',
    p.bda ? tag('Bda', String(p.bda).substring(0, 20)) : '',
    p.importoContrassegno && p.importoContrassegno > 0
      ? tag('Importocontrassegno', p.importoContrassegno.toFixed(2).replace('.', ','))
      : '',
    p.importoContrassegno && p.importoContrassegno > 0 && p.modalitaIncasso
      ? tag('ModalitaIncasso', p.modalitaIncasso) : '',
    p.assicurazione && p.assicurazione > 0
      ? tag('Assicurazione', p.assicurazione.toFixed(2).replace('.', ',')) : '',
    p.email ? tag('Email', p.email.substring(0, 70)) : '',
    p.cellulare ? tag('Cellulare1', p.cellulare.replace(/[^0-9+]/g, '').substring(0, 20)) : '',
    p.note ? tag('Notespedizione', p.note.substring(0, 100)) : '',
  ].filter(Boolean).join('')

  return `<Info><Parcel>${campi}</Parcel></Info>`
}

// Chiamata SOAP 1.1 a una operazione del webservice GLS. `xmlInfoParcel` è una STRINGA XML
// che viene passata come parametro (quindi va escapata dentro il body SOAP).
async function chiamaGls(operazione: 'AddParcel' | 'DeleteParcel' | 'CloseWorkDay', xmlInfoParcel: string, timeoutMs = 20000): Promise<string> {
  const paramName = operazione === 'AddParcel' ? 'XMLInfoParcel'
    : operazione === 'DeleteParcel' ? 'XMLCancelParcel' : 'XMLCloseWorkday'
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<${operazione} xmlns="${GLS_NS}"><${paramName}>${escXml(xmlInfoParcel)}</${paramName}></${operazione}>` +
    `</soap:Body></soap:Envelope>`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(GLS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `"${GLS_NS}${operazione}"`,
      },
      body,
      signal: ctrl.signal,
    })
    const testo = await res.text()
    if (!res.ok) throw new Error(`GLS ${operazione} HTTP ${res.status}: ${testo.substring(0, 300)}`)
    return testo
  } finally {
    clearTimeout(t)
  }
}

// Estrae il valore del primo tag <nome>…</nome> (case-insensitive), ovunque annidato.
function estraiTag(xml: string, nome: string): string | null {
  const m = new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`, 'i').exec(xml)
  return m ? m[1] : null
}

// Il risultato di AddParcel è un XML dentro <AddParcelResult> (spesso XML-escapato).
export function parseAddParcelResult(soapResponse: string): RisultatoGls {
  // srotola l'eventuale doppio-escape del contenuto di *Result
  const inner0 = estraiTag(soapResponse, 'AddParcelResult') ?? soapResponse
  const inner = inner0
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

  const numeroSpedizione = estraiTag(inner, 'NumeroSpedizione') || estraiTag(inner, 'NumeroDDT') || null
  const pdfBase64 = estraiTag(inner, 'PdfLabel') || null
  const zpl = estraiTag(inner, 'Zpl') || null
  // GLS segnala i problemi con <Errore>, <TassoErrore>, <DescrizioneErrore> o simili.
  const errore = estraiTag(inner, 'DescrizioneErrore') || estraiTag(inner, 'Errore')
    || (numeroSpedizione ? null : 'Nessun numero spedizione nella risposta')

  return { numeroSpedizione, pdfBase64, zpl, errore: numeroSpedizione ? null : errore, raw: inner }
}

// Crea una spedizione GLS e ne ottiene numero + etichetta PDF (base64) in un colpo solo.
export async function creaSpedizioneGls(cred: CredenzialiGls, parcel: ParcelGls): Promise<RisultatoGls> {
  const xml = costruisciXmlInfoParcel(cred, parcel)
  const soap = await chiamaGls('AddParcel', xml)
  return parseAddParcelResult(soap)
}

// Annulla un collo di prova (best-effort): serve al test per non lasciare colli appesi
// sull'account GLS. Se il formato DeleteParcel non è quello atteso non blocca nulla.
export async function annullaSpedizioneGls(cred: CredenzialiGls, numeroSpedizione: string): Promise<boolean> {
  try {
    const xml = `<Info>` +
      tag('SedeGls', cred.sigla_sede) +
      tag('CodiceClienteGls', cred.user_webservice) +
      tag('Password', cred.password_webservice) +
      tag('NumeroSpedizione', numeroSpedizione) +
      `</Info>`
    const soap = await chiamaGls('DeleteParcel', xml)
    return !/errore/i.test(soap) || /true|ok|success/i.test(soap)
  } catch {
    return false
  }
}
