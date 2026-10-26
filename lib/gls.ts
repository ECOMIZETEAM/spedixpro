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

import { testoIndicaReso } from '@/lib/spedisci'
import { normalizzaPaese } from '@/lib/paesi'

// IL GLS DIRETTO FA SOLO L'ITALIA. AddParcel qui sotto manda a GLS CAP e provincia, ma non il paese:
// una destinazione estera arriva come se fosse un CAP italiano. Non e' un'ipotesi: dall'8 al 12/10/2026
// Quick ha creato 7 spedizioni verso Germania, Francia e Lussemburgo sul suo GLS diretto, e GLS le ha
// rimandate tutte e 7 in "GLS Check" (non instradate, etichetta da rilavorare a mano) — tutte annullate.
// La piattaforma intanto le aveva quotate e addebitate (poi rimborsate dall'annullo), perche' bastava
// una zona estera con le fasce per far comparire il contratto. Finche' l'internazionale non e'
// costruito sul manuale GLS, il contratto non si offre e non si crea fuori dall'Italia. La decisione
// sta qui, e la chiamano i due preventivi (cliente e spedizione propria del master) e la creazione.
//
// L'ESTERO E' UN ALTRO SERVIZIO GLS, NON UN'ALTRA DESTINAZIONE DELLO STESSO. Nel <Parcel> c'e'
// TipoSpedizione: N = nazionale (il default, quello che GLS assume se il tag manca) e P = Parcel,
// cioe' internazionale. Percio' il servizio sta nel CONTRATTO (settings.tipo_spedizione = 'P'), non
// nella destinazione: un contratto nazionale serve solo l'Italia, un contratto Parcel solo l'estero.
// Il primo Parcel e' "Q GLS NL STANDARD Europa" di Quick (14/10/2026): stesse credenziali del
// nazionale, servizio diverso.
export type ServizioGls = 'N' | 'P'
export function servizioGls(settings: unknown): ServizioGls {
  return (settings as any)?.tipo_spedizione === 'P' ? 'P' : 'N'
}

// IL PAESE DEL PARCEL VA NEL TAG <Provincia>, con la sigla GLS del paese: non c'e' un tag "nazione".
// Fonte: manuale GLS MU162 rev.22 (05/07/2022), par. 6.1 "Tag <Provincia> (sigla sede paesi
// internazionali)" e tabella AddParcel ("Provincia / Codice Stato"). Le sigle coincidono con l'ISO
// 3166 tranne due (Liechtenstein LC, Turchia TK), che pero' sono extra-UE e qui non entrano.
// SOLO PAESI UE: per l'extra-UE (Svizzera, Norvegia, Regno Unito, Serbia, Turchia, Andorra…) GLS
// vuole i dati doganali (Incoterm, fattura doganale, valore, categoria, nazione d'origine), che non
// mandiamo: senza, il pacco si ferma in dogana. L'Islanda nell'elenco GLS non c'e' proprio.
const SIGLA_GLS_PARCEL_UE: Record<string, string> = {
  AT: 'AT', BE: 'BE', BG: 'BG', CY: 'CY', CZ: 'CZ', DE: 'DE', DK: 'DK', EE: 'EE', ES: 'ES', FI: 'FI',
  FR: 'FR', GR: 'GR', HR: 'HR', HU: 'HU', IE: 'IE', LT: 'LT', LU: 'LU', LV: 'LV', MT: 'MT', NL: 'NL',
  PL: 'PL', PT: 'PT', RO: 'RO', SE: 'SE', SI: 'SI', SK: 'SK',
}
// Territori di paesi UE FUORI dall'area doganale e IVA dell'Unione: anche li' servirebbero i dati
// doganali. Si riconoscono dal CAP (la zona "Spagna" del listino copre anche le Canarie).
const TERRITORI_FUORI_DOGANA_UE: Array<[string, RegExp, string]> = [
  ['ES', /^(35|38)\d{3}$/, 'le Canarie'], ['ES', /^51\d{3}$/, 'Ceuta'], ['ES', /^52\d{3}$/, 'Melilla'],
  // Francia: 971-978 e 984-989 sono oltremare. I 980xx sono Monaco, che col CAP francese sta nel
  // territorio doganale dell'Unione e va servito.
  ['FR', /^9(7[1-8]|8[4-9])\d{2}$/, 'i territori francesi d\'oltremare'], ['FI', /^22\d{3}$/, 'le isole Åland'],
  ['DE', /^27498$/, 'Helgoland'], ['DE', /^78266$/, 'Büsingen'], ['GR', /^6308[67]$/, 'il Monte Athos'],
]
function capPulito(cap: unknown): string {
  return String(cap ?? '').replace(/\s+/g, '').toUpperCase()
}
// CAP del Parcel: GLS lo vuole alfanumerico di massimo 7 caratteri. Il prefisso del paese ("LT-") e
// il trattino si tolgono SOLO se il CAP non ci sta: un portoghese "1000-001" troncato a 7 diventava
// "1000-00" (meta' dei CAP portoghesi nei nostri dati ha questa forma), mentre i CAP che ci stanno
// (polacco "00-950", lettone "LV-1050", olandese senza spazio) restano come sono. Se anche cosi'
// supera i 7, erroreParcelGls ferma la spedizione: un CAP tagliato non arriva a destinazione.
function capParcel(cap: unknown): string {
  const c = capPulito(cap)
  return c.length > 7 ? c.replace(/^[A-Z]{1,3}-/, '').replace(/-/g, '') : c
}

// Perche' un contratto GLS Parcel NON puo' servire quella destinazione (null = la serve).
export function motivoParcelNonServito(paeseDestinazione: unknown, cap: unknown): string | null {
  const paese = normalizzaPaese(paeseDestinazione)
  if (paese === 'IT') return 'Questo contratto GLS spedisce solo all\'estero: per l\'Italia scegli il contratto nazionale.'
  if (!SIGLA_GLS_PARCEL_UE[paese]) return `Questo contratto GLS non spedisce verso ${paese}: fuori dall'Unione europea servono i dati doganali.`
  const c = capPulito(cap).replace(/^[A-Z]{1,3}-/, '')   // "ES-35001" e' comunque le Canarie
  const territorio = TERRITORI_FUORI_DOGANA_UE.find(([p, re]) => p === paese && re.test(c))
  if (territorio) return `Questo contratto GLS non spedisce verso ${territorio[2]}: sono fuori dall'area doganale dell'Unione europea.`
  return null
}

// PERCHE' UN CONTRATTO GLS DIRETTO NON PUO' FARE QUESTA SPEDIZIONE (null = la puo' fare). E' la regola
// unica: la chiamano i due preventivi (per non mostrarlo) e la creazione (per fermarlo prima del
// credito). Dentro c'e' solo cio' che si sa gia' al momento del prezzo: destinazione e contrassegno.
// Il contrassegno sul Parcel GLS lo vuole con numero e data fattura e su un collo solo (manuale
// MU162): non lo mandiamo, quindi il contratto non si offre a chi lo chiede.
export function motivoGlsNonServe(
  corriere: { tipo?: unknown; settings?: unknown } | null | undefined,
  dest: { paese?: unknown; cap?: unknown; contrassegno?: unknown },
): string | null {
  if (corriere?.tipo !== 'gls') return null
  if (servizioGls(corriere.settings) !== 'P') {
    return normalizzaPaese(dest.paese) !== 'IT' ? 'Questo contratto GLS spedisce solo in Italia: per l\'estero scegli un altro corriere.' : null
  }
  const motivo = motivoParcelNonServito(dest.paese, dest.cap)
  if (motivo) return motivo
  if (Number(dest.contrassegno || 0) > 0) return 'Il contrassegno non e\' disponibile su GLS Europa: toglilo o scegli un altro corriere.'
  return null
}

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
  // UN PESO (kg) PER COLLO; la lunghezza = numero colli. GLS vuole N <Parcel> (uno per collo):
  // verificato che <Colli>N in un solo Parcel crea 1 collo, mentre 3 <Parcel> creano 3 colli sotto
  // lo stesso NumeroSpedizione (ProgressivoCollo 01/02/03).
  pesiColli: number[]
  bda?: string               // riferimento ordine/documento (max 20)
  importoContrassegno?: number   // EUR, 0 = niente COD (solo sul PRIMO collo)
  modalitaIncasso?: string       // codice metodo incasso (dipende dal contratto)
  assicurazione?: number         // EUR (solo sul primo collo)
  note?: string                  // Notespedizione
  serviziAccessori?: string[]    // codici GLS 2-cifre (max 6): Sabato 23, Exchange 24, Preavviso 14, ...
  // Contatti del DESTINATARIO per il FlexDeliveryService (FDS): GLS manda al destinatario il link
  // via email/SMS per gestirsi la consegna (riprogramma, dirotta, deposito sicuro, vicino, rifiuta).
  // Attivo se FDS è abilitato sul contratto GLS: senza questi campi GLS non ha come avvisare nessuno
  // e il servizio non parte. Vanno passati SOLO quando si vuole davvero far scrivere GLS al cliente
  // (è l'opposto della regola "email schermo corriere"): lo decide il ramo crea, non questa libreria.
  email?: string                 // <Email> destinatario (max 70)
  cellulare?: string             // <Cellulare1> destinatario (GLS vuole le ultime 10 cifre)
  // PARCEL (estero, contratto con settings.tipo_spedizione = 'P'). Manuale MU162 rev.22: per il
  // Parcel sono obbligatori Bda, PersonaRiferimento e TelefonoDestinatario; il paese va in
  // <Provincia> come sigla GLS; non si usano Notespedizione, TipoPorto e i servizi accessori
  // (solo il 31 FlexDelivery). Il contrassegno vuole numero e data fattura e un collo solo: non lo
  // mandiamo, e creaSpedizioneGls rifiuta un Parcel che lo chiede.
  tipoSpedizione?: ServizioGls
  paese?: string                 // ISO 3166 del paese di destinazione (solo Parcel)
  personaRiferimento?: string    // <PersonaRiferimento> (max 50)
  telefono?: string              // <TelefonoDestinatario> (solo cifre, max 16)
}

// NOME servizio accessorio (come sta a listino/nel form) → CODICE GLS ServiziAccessori (tabella GLS,
// verificata sul contratto Quick 2/9). I codici sono 2 cifre; il tag ne accetta max 6 separati da virgola.
// 01/02/03 sono le modalità del CONTRASSEGNO (contanti/assegno banc./assegno circ.), qui NON mappate:
// la modalità COD la mette il ramo crea a parte. Torna null se il nome non è un servizio GLS trasmissibile.
export function codiceServizioGls(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (/exchange|cambio/.test(n)) return '24'
  if (/sabato|saturday/.test(n)) return '23'
  if (/preavviso/.test(n)) return '14'
  if (/infoservice|info service|sms/.test(n)) return '15'
  if (/appuntamento/.test(n)) return '16'
  if (/flex|e-?commerce/.test(n)) return '21'
  if (/consegna al piano|al piano/.test(n)) return '22'
  if (/ident/.test(n)) return '25'
  if (/return|reso/.test(n)) return '27'
  return null   // es. "Express12"/"Document Return": nessun codice ServiziAccessori → non trasmesso
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
  numeroColli: number
  pdfBase64: string | null   // etichetta del PRIMO collo (comodità: test / mono-collo)
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

// Costruisce l'XMLInfoParcel per AddParcel (STRUTTURA VERIFICATA). Un <Parcel> PER COLLO.
export function costruisciXmlInfoParcel(cred: CredenzialiGls, p: ParcelGls): string {
  const info =
    tag('SedeGls', cred.sigla_sede) +
    tag('CodiceClienteGls', cred.user_webservice) +
    tag('PasswordClienteGls', cred.password_webservice)
  const pesi = (p.pesiColli && p.pesiColli.length) ? p.pesiColli : [1]
  const parcel = p.tipoSpedizione === 'P'
  const parcels = pesi.map((peso, idx) => {
    const primo = idx === 0
    if (parcel) return `<Parcel>${campiParcel(cred, p, peso, idx)}</Parcel>`
    const campi = [
      tag('CodiceContrattoGls', cred.codice_contratto),
      tag('RagioneSociale', (p.ragioneSociale || '').substring(0, 70)),
      tag('Indirizzo', (p.indirizzo || '').substring(0, 70)),
      tag('Localita', (p.localita || '').substring(0, 50)),
      tag('Zipcode', p.cap),
      tag('Provincia', (p.provincia || '').substring(0, 2).toUpperCase()),
      tag('Colli', '1'),
      tag('PesoReale', pesoIt(peso)),
      // Il riferimento (Bda) va su OGNI collo: GLS mette nella stessa spedizione i colli con lo stesso
      // destinatario E la stessa Bda. Quando stava solo sul primo, un multicollo con riferimento si
      // spezzava in due spedizioni: il collo 1 con il numero che salvavamo, gli altri in una seconda
      // che non vedevamo — etichetta con un collo solo, e la seconda restava aperta su GLS. Rifatta poi
      // senza riferimento, ci si agganciava sopra: Hard2Buff → Salerno, 2 pacchi, su GLS 665264142 a
      // 3 colli più la 665264141 (19/10/2026; 9 casi di Quick dal 01/10).
      p.bda ? tag('Bda', String(p.bda).substring(0, 20)) : '',
      // Contrassegno / assicurazione / note SOLO sul primo collo (dati di spedizione, non di collo:
      // ripeterli su ogni Parcel rischia di moltiplicarli).
      primo && p.importoContrassegno && p.importoContrassegno > 0 ? tag('Importocontrassegno', euroIt(p.importoContrassegno)) : '',
      primo && p.importoContrassegno && p.importoContrassegno > 0 && p.modalitaIncasso ? tag('ModalitaIncasso', p.modalitaIncasso) : '',
      primo && p.assicurazione && p.assicurazione > 0 ? tag('Assicurazione', euroIt(p.assicurazione)) : '',
      // Servizi accessori (Sabato/Exchange/Preavviso…): codici 2-cifre, max 6, separati da virgola. Solo primo collo.
      primo && p.serviziAccessori && p.serviziAccessori.length ? tag('ServiziAccessori', Array.from(new Set(p.serviziAccessori)).slice(0, 6).join(',')) : '',
      primo && p.note ? tag('Notespedizione', p.note.substring(0, 100)) : '',
      // Contatti destinatario per il FlexDeliveryService — solo primo collo (dati di spedizione).
      // Email: GLS la vuole <=70. Cellulare1: solo cifre, ULTIME 10 (toglie prefisso +39/0039 e spazi);
      // se ne restano meno di 9 non si manda (evita un valore monco che GLS potrebbe rifiutare).
      primo && p.email && p.email.includes('@') ? tag('Email', p.email.trim().substring(0, 70)) : '',
      primo && (() => { const d = String(p.cellulare || '').replace(/\D/g, ''); return d.length >= 9 ? tag('Cellulare1', d.slice(-10)) : '' })(),
    ].filter(Boolean).join('')
    return `<Parcel>${campi}</Parcel>`
  }).join('')
  return `<Info>${info}${parcels}</Info>`
}

// UN COLLO PARCEL (estero). I campi obbligatori del Parcel — TipoSpedizione, Bda, PersonaRiferimento,
// TelefonoDestinatario — vanno su OGNI <Parcel>: per GLS ogni tag e' un collo da validare, e i colli
// con lo stesso destinatario confluiscono nella stessa spedizione (aggregazione di default). Il
// destinatario e' lo stesso su tutti, quindi la spedizione resta una.
// GeneraPdf: sul nazionale non lo mandiamo (default 0 = solo XML, l'etichetta si prende dopo con
// GetPdfBySped). Sul Parcel GLS rifiuta il default — prova del 14/10/2026 sul contratto di Quick:
// nessuna spedizione creata, NoteSpedizione "Valore tag GeneraPdf non ammesso." — quindi 4
// (etichetta subito nella risposta, e resta richiamabile con GetPdfBySped), con il
// ContatoreProgressivo che il manuale vuole univoco per collo e diverso da zero.
function campiParcel(cred: CredenzialiGls, p: ParcelGls, peso: number, idx: number): string {
  const primo = idx === 0
  const telefono = String(p.telefono || '').replace(/\D/g, '').slice(-16)
  const contatore = String(100000000 + ((Date.now() * 10 + idx) % 900000000))
  return [
    tag('CodiceContrattoGls', cred.codice_contratto),
    tag('RagioneSociale', (p.ragioneSociale || '').substring(0, 70)),
    tag('Indirizzo', (p.indirizzo || '').substring(0, 70)),
    tag('Localita', (p.localita || '').substring(0, 50)),
    tag('Zipcode', capParcel(p.cap)),        // estero: alfanumerico, max 7 (oltre, erroreParcelGls ferma)
    tag('Provincia', SIGLA_GLS_PARCEL_UE[normalizzaPaese(p.paese)] || ''),   // il PAESE, non la provincia
    tag('Colli', '1'),
    tag('PesoReale', pesoIt(peso)),
    tag('TipoSpedizione', 'P'),
    tag('Bda', String(p.bda || '').substring(0, 11)),
    tag('PersonaRiferimento', (p.personaRiferimento || p.ragioneSociale || '').substring(0, 50)),
    tag('TelefonoDestinatario', telefono),
    tag('GeneraPdf', '4'),
    tag('ContatoreProgressivo', contatore),
    primo && p.assicurazione && p.assicurazione > 0 ? tag('Assicurazione', euroIt(p.assicurazione)) : '',
    // Niente Cellulare1 sul Parcel: la regola del nazionale (ultime 10 cifre, per togliere il +39)
    // storpia un cellulare estero ("+33 6 12 34 56 78" diventava 3612345678, un numero italiano).
    // Il numero completo viaggia gia' in TelefonoDestinatario, che sul Parcel e' obbligatorio.
    primo && p.email && p.email.includes('@') ? tag('Email', p.email.trim().substring(0, 70)) : '',
  ].filter(Boolean).join('')
}

// Cosa impedisce di mandare a GLS un Parcel (null = si puo'). Si controlla PRIMA di chiamare GLS:
// GLS su questi casi o rifiuta con un errore generico, o — peggio — crea la spedizione senza il dato.
export function erroreParcelGls(p: ParcelGls): string | null {
  if (p.tipoSpedizione !== 'P') return null
  const motivo = motivoParcelNonServito(p.paese, p.cap)
  if (motivo) return motivo
  if (p.importoContrassegno && p.importoContrassegno > 0) return 'Il contrassegno non e\' disponibile su GLS Europa.'
  if (String(p.telefono || '').replace(/\D/g, '').length < 6) return 'Per GLS Europa serve il telefono del destinatario.'
  if (!String(p.bda || '').trim()) return 'Per GLS Europa serve un riferimento della spedizione.'
  if (!capParcel(p.cap) || capParcel(p.cap).length > 7) return 'CAP del destinatario non valido per GLS Europa (al massimo 7 caratteri).'
  return null
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
  // Parcel incompleto: non si chiama GLS (nessun collo creato, niente da annullare).
  const erroreParcel = erroreParcelGls(parcel)
  if (erroreParcel) return { numeroSpedizione: null, tracking: null, siglaMittente: null, siglaSedeDestino: null, glsCheck: false, numeroColli: 0, pdfBase64: null, errore: erroreParcel, raw: '' }
  const xml = costruisciXmlInfoParcel(cred, parcel)
  let soap: string
  try {
    soap = await chiamaGls('AddParcel', `<XMLInfoParcel>${escXml(xml)}</XMLInfoParcel>`)
  } catch (e) {
    // Rete/timeout PRIMA di una risposta: non c'è (quasi certamente) nessun collo creato.
    return { numeroSpedizione: null, tracking: null, siglaMittente: null, siglaSedeDestino: null, glsCheck: false, numeroColli: 0, pdfBase64: null, errore: 'GLS non raggiungibile: ' + (e instanceof Error ? e.message : String(e)), raw: '' }
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
  const numeroColli = (parcel.pesiColli && parcel.pesiColli.length) ? parcel.pesiColli.length : 1
  return { numeroSpedizione, tracking, siglaMittente, siglaSedeDestino, glsCheck, numeroColli, pdfBase64: null, errore, raw: (soap || '').substring(0, 2000) }
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
    // NumeroCollo VUOTO torna null (verificato): serve il numero del collo (1..N). Default 1.
    `<NumeroCollo>${escXml(opts?.numeroCollo || '1')}</NumeroCollo>` +
    `<TipoPorto>${escXml(opts?.tipoPorto || '')}</TipoPorto>`
  const soap = await chiamaGls('GetPdfBySped', inner)
  const b64 = estraiTag(soap, 'GetPdfBySpedResult')
  const pulito = (b64 || '').replace(/\s+/g, '')
  // un PDF vero in base64 è lungo e inizia con "JVBER" (%PDF); sotto una certa soglia è un errore.
  if (pulito.length > 500 && /^JVBER/i.test(pulito)) return { pdfBase64: pulito, errore: null }
  return { pdfBase64: null, errore: faultString(soap) || 'Etichetta non disponibile' }
}

// Etichette di TUTTI i colli (uno per collo: GetPdfBySped NumeroCollo 1..N). Torna il base64 per
// collo nell'ordine (indice 0 = collo 1). Best-effort: salta i colli che non tornano.
// `mittente`: SOLO dove il contratto lo chiede (lib/etichetta-mittente), il nome dell'intestatario del
// conto GLS stampato in alto si sostituisce col mittente della spedizione. E' qui perche' da qui passa
// OGNI etichetta GLS: creazione, ripresa in background e recupero all'apertura.
export async function etichetteGls(
  cred: CredenzialiGls, numeroSpedizione: string, numeroColli: number,
  opts?: { bda?: string; tipoPorto?: string; mittente?: { nome?: string | null; destinatario?: string | null } | null }
): Promise<{ etichette: string[]; errore: string | null }> {
  const n = Math.max(1, Math.round(numeroColli || 1))
  const { mittente, ...optsGls } = opts || {}
  const etichette: string[] = []
  for (let i = 1; i <= n; i++) {
    try {
      const et = await etichettaGls(cred, numeroSpedizione, { ...optsGls, numeroCollo: String(i) })
      if (et.pdfBase64) {
        let pdf = et.pdfBase64
        if (mittente?.nome) {
          const { mittenteEtichettaGls } = await import('@/lib/etichetta-gls')
          pdf = await mittenteEtichettaGls(pdf, mittente)
        }
        etichette.push(pdf)
      }
    } catch { /* la riprende il recupero in background */ }
  }
  return { etichette, errore: etichette.length ? null : 'nessuna etichetta disponibile' }
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

// Chiude (= TRASMETTE alla sede GLS) una o più spedizioni per numero NUDO. Senza questa, AddParcel
// crea la spedizione ma resta "in attesa di chiusura" e GLS NON passa a ritirare. Batch: un <Parcel>
// per numero in una sola chiamata. Il campo è `NumeroDiSpedizioneGLSDaConfermare` (verificato: con
// <NumeroSpedizione> GLS cercava "-1" → "Spedizione inesistente"). Param `_xmlRequest` (underscore).
export async function chiudiSpedizioniGls(
  cred: CredenzialiGls, numeri: string[]
): Promise<{ ok: boolean; esiti: Record<string, string>; errore: string | null; raw: string }> {
  const nums = Array.from(new Set(numeri.map(n => String(n || '').trim()).filter(Boolean)))
  if (!nums.length) return { ok: true, esiti: {}, errore: null, raw: '' }
  const parcels = nums.map(n => `<Parcel><NumeroDiSpedizioneGLSDaConfermare>${escXml(n)}</NumeroDiSpedizioneGLSDaConfermare></Parcel>`).join('')
  const xmlReq =
    `<Info>` +
    tag('SedeGls', cred.sigla_sede) +
    tag('CodiceClienteGls', cred.user_webservice) +
    tag('PasswordClienteGls', cred.password_webservice) +
    parcels +
    `</Info>`
  let soap: string
  try {
    soap = await chiamaGls('CloseWorkDayByShipmentNumber', `<_xmlRequest>${escXml(xmlReq)}</_xmlRequest>`)
  } catch (e) {
    return { ok: false, esiti: {}, errore: 'GLS non raggiungibile: ' + (e instanceof Error ? e.message : String(e)), raw: '' }
  }
  const fault = faultString(soap)
  if (fault) return { ok: false, esiti: {}, errore: fault, raw: soap.substring(0, 2000) }
  // Esito per-spedizione: coppie <NumeroDiSpedizioneGLSDaConfermare> + <esito> dentro ogni <Parcel>.
  const esiti: Record<string, string> = {}
  const re = /<NumeroDiSpedizioneGLSDaConfermare>\s*([^<]*?)\s*<\/NumeroDiSpedizioneGLSDaConfermare>[\s\S]*?<esito>\s*([^<]*?)\s*<\/esito>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(soap))) esiti[m[1].trim()] = m[2].trim()
  const descr = (estraiTag(soap, 'DescrizioneErrore') || '').trim()
  // Trasmesso se GLS risponde OK a livello globale e almeno una spedizione è andata a buon fine.
  const ok = /^ok$/i.test(descr) && nums.some(n => /ok/i.test(esiti[n] || ''))
  return { ok, esiti, errore: ok ? null : (descr || 'chiusura GLS non confermata'), raw: soap.substring(0, 2000) }
}

// Numero GLS "nudo" (quello che vuole la CloseWorkDay) di una spedizione: sta in raw_response.numero,
// altrimenti le prime 6+ cifre di numero/tracking. Estratto per condividerlo con la chiusura MISTA.
export function numeroNudoGls(s: { numero?: string | null; tracking_number?: string | null; raw_response?: any }): string {
  const raw = (s?.raw_response || {}) as any
  let n = raw?.numero ? String(raw.numero) : ''
  if (!n) { const mm = String(s?.numero || s?.tracking_number || '').match(/\d{6,}/); n = mm ? mm[0] : '' }
  return n
}

// Chiusura GLS di una DISTINTA (stessa forma di chiudiBorderoSpedisci/chiudiBordereauSpediamopro).
// Best-effort, mai bloccante. Solo per corrieri di tipo 'gls'. Il numero NUDO sta in
// raw_response.numero (fallback: le cifre del numero/tracking). GLS non produce un PDF di borderò:
// a chiusura avvenuta si segna bordero_id='N/A' e confermata_vettore=true (come SDA/spedisci-già-chiusa).
export async function chiudiGiornataGls(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta || (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE'))) return { skip: true }

    // Credenziali SEMPRE via admin: la colonna non è leggibile col token utente.
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: corriere } = await createAdminSupabase()
      .from('corrieri').select('id, tipo, credenziali').eq('id', distinta.corriere_id).maybeSingle()
    if (!corriere || corriere.tipo !== 'gls') return { skip: true }
    const cred = (corriere.credenziali || {}) as CredenzialiGls
    if (!cred.sigla_sede || !cred.user_webservice || !cred.password_webservice) return { errore: 'credenziali GLS mancanti' }

    const { data: speds } = await supabase
      .from('spedizioni').select('id, numero, tracking_number, raw_response').eq('distinta_id', distintaId)
    const numeri: string[] = []
    for (const s of speds || []) { const n = numeroNudoGls(s); if (n) numeri.push(n) }
    if (!numeri.length) return { errore: 'nessuna spedizione GLS con numero' }

    const r = await chiudiSpedizioniGls(cred, numeri)
    await supabase.from('distinte').update({
      bordero_id: r.ok ? 'N/A' : ('ERRORE: ' + (r.errore || 'chiusura GLS').slice(0, 150)),
      ...(r.ok ? { confermata_vettore: true, data_conferma: new Date().toISOString() } : {}),
    }).eq('id', distintaId)
    return { ok: r.ok, errore: r.errore, esiti: r.esiti }
  } catch (e: any) {
    try {
      await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(e?.message || e).slice(0, 150) }).eq('id', distintaId)
    } catch {}
    return { errore: String(e?.message || e) }
  }
}

// RECUPERO ON-DEMAND dell'etichetta GLS, con salvataggio. GLS genera il PDF con un attimo di ritardo
// dopo AddParcel: se alla creazione (tentativo sincrono + ripresa in background) era ancora troppo
// presto, l'etichetta non veniva mai salvata e il tasto "Etichetta" restava "non disponibile" per
// sempre — non essendoci, per GLS, il ripiego on-demand che invece hanno DVA e SpediamoPro. Questo lo
// aggiunge: quando manca, la si scarica ORA e la si salva (etichetta_url + per-collo), come fa la crea.
// Torna il PDF (unito se multicollo) o null. `admin` deve avere il service role (legge le credenziali).
export async function recuperaEtichettaGlsSalvando(
  admin: any,
  sped: { id: string; corriere_id?: string | null; colli?: number | null; raw_response?: any; colli_dettaglio?: any }
): Promise<Buffer | null> {
  const raw = (sped?.raw_response || {}) as any
  if (!raw._gls || !sped?.corriere_id || !sped?.id) return null
  const numeroBare = raw.numero ? String(raw.numero) : ''
  if (!numeroBare) return null
  const { data: corr } = await admin.from('corrieri').select('tipo,credenziali').eq('id', sped.corriere_id).maybeSingle()
  if (corr?.tipo !== 'gls') return null
  const cred = (corr.credenziali || {}) as CredenzialiGls
  if (!cred.sigla_sede || !cred.user_webservice || !cred.password_webservice) return null

  const nColli = Math.max(1, Math.round(Number(sped.colli) || 1))
  // Mittente vero al posto dell'intestatario del conto, se il contratto lo chiede (come alla creazione).
  let mittente: { nome: string | null; destinatario: string | null } | null = null
  try {
    const { stampaMittenteSpedizione } = await import('@/lib/etichetta-mittente')
    if (await stampaMittenteSpedizione(admin, { id: sped.corriere_id })) {
      const { data: sm } = await admin.from('spedizioni').select('mitt_nome, dest_nome').eq('id', sped.id).maybeSingle()
      if (sm?.mitt_nome) mittente = { nome: sm.mitt_nome, destinatario: sm.dest_nome }
    }
  } catch { /* senza mittente si serve l'etichetta di GLS com'e' */ }
  // Sul Parcel l'etichetta si e' presa (prova del 14/10/2026) passando anche il riferimento Bda, che
  // la creazione salva in raw_response.bda solo per le Parcel: le nazionali restano come prima.
  const et = await etichetteGls(cred, numeroBare, nColli, { ...(raw.parcel && raw.bda ? { bda: String(raw.bda) } : {}), mittente })
  if (!et.etichette.length) return null

  // Unione multicollo (una pagina per collo), come alla creazione; mono-collo = diretta.
  let b64unico = et.etichette[0]
  if (et.etichette.length > 1) {
    try {
      const { unisciEtichette } = await import('@/lib/easyparcel')
      b64unico = (await unisciEtichette(et.etichette)) || et.etichette[0]
    } catch { /* ripiega sul primo collo */ }
  }
  const etichettaUrl = `data:application/pdf;base64,${b64unico}`

  // Salva l'etichetta unica + quelle per-collo (se colli_dettaglio è presente), così le prossime
  // aperture la trovano già pronta e non richiamano GLS.
  const colli = Array.isArray(sped.colli_dettaglio) ? (sped.colli_dettaglio as any[]) : null
  const nuoviColli = colli && colli.length
    ? colli.map((c: any, i: number) => ({ ...c, etichetta_url: et.etichette[i] ? `data:application/pdf;base64,${et.etichette[i]}` : (c.etichetta_url || null) }))
    : null
  try {
    await admin.from('spedizioni').update({
      etichetta_url: etichettaUrl, ...(nuoviColli ? { colli_dettaglio: nuoviColli } : {}),
    }).eq('id', sped.id)
  } catch { /* il salvataggio è best-effort: l'importante è restituire il PDF adesso */ }

  return Buffer.from(b64unico, 'base64')
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

// ─────────────────────────────────────────────────────────────────────────────
// TRACKING DI CONSEGNA — T&T Infoweb (manuale GLS MU40)
//
// Il webservice di CREAZIONE (labelservice) NON dà lo stato di consegna: quello si legge dal sistema
// Track & Trace separato di GLS. Endpoint GET XML pubblico, keyato da sede+contratto+numero (niente
// password). Ritorna gli eventi come gli altri provider — una lista di stringhe di stato che il cron
// mappa con mapStatoGls + prioritaStato.
//
// Host DIVERSO dalla creazione: infoweb.gls-italy.com (TLS 1.2+, richiesto da GLS). Vuole il numero
// NUDO (es. 860091374), quello salvato in raw_response.numero alla creazione, NON il tracking_number
// prefissato (NL860…) che il T&T non riconosce.
// ─────────────────────────────────────────────────────────────────────────────
const GLS_TT_ENDPOINT = 'https://infoweb.gls-italy.com/XML/get_xml_track.php'

// Interroga il T&T GLS per numero spedizione e ritorna le stringhe di stato del tracking PRINCIPALE.
export async function trackingGls(
  cred: CredenzialiGls, numeroNudo: string, timeoutMs = 15000
): Promise<{ stati: string[]; eventi: { data: string; descrizione: string; luogo: string }[]; raw: string }> {
  const sede = (cred.sigla_sede || '').trim()
  const contratto = (cred.codice_contratto || '').trim()
  const num = String(numeroNudo || '').replace(/\D/g, '')   // il T&T vuole il numero NUDO (solo cifre)
  if (!sede || !num) return { stati: [], eventi: [], raw: '' }
  const url = `${GLS_TT_ENDPOINT}?locpartenza=${encodeURIComponent(sede)}&NumSped=${encodeURIComponent(num)}` +
    (contratto ? `&CodCli=${encodeURIComponent(contratto)}` : '')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  let xml = ''
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/xml, text/xml' } })
    xml = await res.text()
  } catch {
    return { stati: [], eventi: [], raw: '' }   // rete/timeout: nessun aggiornamento, si riprova al giro dopo
  } finally {
    clearTimeout(t)
  }
  // SOLO il PRIMO blocco <TRACKING>…</TRACKING> = la spedizione principale. Gli eventuali
  // <SPEDIZIONEDIRIENTRO> (reso) / <SPEDIZIONEDINOLTRO> (inoltro) hanno un LORO <TRACKING> con la
  // "Consegnata." del RITORNO al mittente: leggerli qui marcherebbe consegnata la spedizione di
  // ANDATA (stesso genere di bug del reso letto come consegna). <TRACKINGINT> ha un tag diverso e
  // non viene catturato da questa regex. NON si mappa <StatoSpedizione> ("Non consegnato" è il
  // default di QUALSIASI spedizione non ancora consegnata, non una mancata consegna): ci si basa
  // sui testi precisi degli eventi.
  const mTrack = /<TRACKING>([\s\S]*?)<\/TRACKING>/i.exec(xml)
  const blocco = mTrack ? mTrack[1] : ''
  const stati: string[] = []
  const re = /<Stato>([\s\S]*?)<\/Stato>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(blocco))) {
    const s = m[1].replace(/\s+/g, ' ').trim()
    if (s) stati.push(s)
  }
  // GLI EVENTI, dallo STESSO blocco da cui escono gli stati — quindi niente rientri e niente
  // inoltri, per la ragione scritta qui sopra. Il T&T manda le tuple Data/Ora/Luogo/Stato in
  // sequenza, SENZA un tag che racchiuda l'evento, dalla piu' recente: si chiude un evento quando
  // arriva <Stato>, usando gli ultimi Data/Ora/Luogo visti, cosi' un campo mancante non sfasa
  // tutta la lista come farebbe leggerli a gruppi di sei.
  // Perche' esiste: il ramo GLS del cron leggeva gli stati e non salvava NIENTE in tracking_events.
  // Era l'unico corriere senza cronologia (02/10/2026: 127 attive e tutte le consegnate, zero
  // eventi in assoluto) e chi apriva il tracking di una GLS diretta trovava la pagina vuota.
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  let dataEv = '', oraEv = '', luogoEv = ''
  const reTag = /<(Data|Ora|Luogo|Stato)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/gi
  let ev: RegExpExecArray | null
  while ((ev = reTag.exec(blocco))) {
    const nomeTag = ev[1].toLowerCase()
    const val = ev[2].replace(/\s+/g, ' ').trim()
    if (nomeTag === 'data') { dataEv = val; continue }
    if (nomeTag === 'ora') { oraEv = val; continue }
    if (nomeTag === 'luogo') { luogoEv = val; continue }
    if (!val) continue
    // GLS scrive l'anno con DUE cifre (02/10/26) e `istanteDaTesto` ne pretende quattro: senza
    // allungarlo qui ogni evento GLS finirebbe scartato per data illeggibile. Si tocca solo il
    // formato di GLS, non la funzione condivisa, che su due cifre non puo' indovinare il secolo.
    const giorno = dataEv.replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/, (_x, g, mm, aa) => `${g}/${mm}/20${aa}`)
    eventi.push({ data: oraEv ? `${giorno} ${oraEv}` : giorno, descrizione: val, luogo: luogoEv })
  }

  // PARCEL INOLTRATA ALL'ESTERO (manuale MU40 rev.8.1, par. 2.7): per ogni collo GLS aggiunge un
  // <ColloInternazionale> con il numero internazionale e gli eventi del tratto estero in
  // <TRACKINGINT>, presi dal tracking della Holding GLS. Il blocco <TRACKING> qui sopra copre solo il
  // tratto italiano, fino all'hub internazionale: la CONSEGNA al destinatario estero la dice solo il
  // tratto estero. Percio' sul Parcel una "consegnata" del tratto italiano non conta (potrebbe essere
  // la consegna all'hub o al partner), e contano gli stati dei colli internazionali.
  // Le spedizioni nazionali questo blocco non ce l'hanno: per loro non cambia niente. Rientri e inoltri
  // si tolgono prima di cercarlo, per la stessa ragione per cui sopra si legge solo il primo <TRACKING>.
  const xmlAndata = xml.replace(/<SPEDIZIONEDIRIENTRO>[\s\S]*?<\/SPEDIZIONEDIRIENTRO>/gi, '')
    .replace(/<SPEDIZIONEDINOLTRO>[\s\S]*?<\/SPEDIZIONEDINOLTRO>/gi, '')
  const colliEsteri = Array.from(xmlAndata.matchAll(/<ColloInternazionale>([\s\S]*?)<\/ColloInternazionale>/gi)).map(m => m[1])
  if (colliEsteri.length) {
    const statiPerCollo: string[][] = []
    for (const collo of colliEsteri) {
      const statiCollo: string[] = []
      let d = '', o = '', l = ''
      const reInt = /<(Data|Ora|Luogo|Stato)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/gi
      let x: RegExpExecArray | null
      while ((x = reInt.exec(collo))) {
        const nome = x[1].toLowerCase()
        const val = x[2].replace(/\s+/g, ' ').trim()
        if (nome === 'data') { d = val; continue }
        if (nome === 'ora') { o = val; continue }
        if (nome === 'luogo') { l = val; continue }
        if (!val) continue
        statiCollo.push(val)
        const giorno = d.replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/, (_x, g, mm, aa) => `${g}/${mm}/20${aa}`)
        eventi.push({ data: o ? `${giorno} ${o}` : giorno, descrizione: val, luogo: l })
      }
      statiPerCollo.push(statiCollo)
    }
    // Il cron prende lo stato piu' avanzato fra tutti quelli che riceve: con un solo elenco, il
    // primo collo consegnato chiudeva come consegnata una spedizione con altri colli ancora in
    // viaggio. La consegna passa solo se ce l'hanno TUTTI i colli esteri.
    // La giacenza estera resta in cronologia ma non diventa stato: in_giacenza vuol dire addebito
    // automatico, e i testi del tratto estero non li abbiamo ancora visti su una Parcel vera.
    const tuttiConsegnati = statiPerCollo.every(sc => sc.some(s => mapStatoGls(s) === 'consegnata'))
    const statiEsteri = statiPerCollo.flat().filter(s => {
      const m = mapStatoGls(s)
      return m !== 'in_giacenza' && (m !== 'consegnata' || tuttiConsegnati)
    })
    const statiItalia = stati.filter(s => mapStatoGls(s) !== 'consegnata')
    return { stati: [...statiItalia, ...statiEsteri], eventi, raw: xml.substring(0, 2000) }
  }
  return { stati, eventi, raw: xml.substring(0, 2000) }
}

// Mappa una stringa di stato del T&T GLS (evento <Stato>) allo stato interno. Sullo stampo di
// mapStatoEasyparcel, con la REGOLA RESO condivisa (testoIndicaReso). Ordine per priorità.
export function mapStatoGls(testo: string): string | null {
  const s = (testo || '').toLowerCase().trim()
  if (!s) return null
  // 1) RESO: regola unica condivisa (verbo di rientro + "al mittente"). GLS di norma mette il reso in
  //    una spedizione a parte (<SPEDIZIONEDIRIENTRO>, che qui NON leggiamo), ma se un evento del
  //    tracking principale dice "…al mittente" lo cogliamo lo stesso.
  if (testoIndicaReso(s)) return 'reso_mittente'
  // 2) CONSEGNATA: "consegnat…" col T finale. "consegna prevista" (senza T) è in consegna, non qui.
  if (/consegnat/.test(s)) return 'consegnata'
  // 3) GIACENZA VERA (in sede, in attesa di istruzioni dal mittente): è quella che si ADDEBITA, come
  //    per gli altri corrieri. NB: la disponibilità presso un GLS Point/Shop NON è una giacenza da
  //    addebitare (è un punto di ritiro, spesso la modalità scelta dal destinatario) → sta al punto 4.
  if (/in giacenza|giacenza presso/.test(s)) return 'in_giacenza'
  // 4) IN CONSEGNA / disponibile al punto di ritiro (nessun addebito).
  if (/consegna prevista|in consegna|out for delivery|in distribuzione|disponibile per il ritiro|disponibile presso/.test(s)) return 'in_consegna'
  // 5) MANCATA CONSEGNA vera (evento, non la "Non consegnato" complessiva che qui non arriva mai).
  if (/consegna non riuscita|indirizzo errato|indirizzo incompleto|destinatario assente|mancata|rifiut/.test(s)) return 'non_consegnato'
  // 6) IN TRANSITO.
  if (/in transito|partita dalla sede|arrivata nella sede|smistament|hub|inoltrat|in viaggio/.test(s)) return 'in_transito'
  // 7) SPEDITA / presa in carico (inclusa "creata dal mittente", che testoIndicaReso NON matcha apposta).
  if (/creata dal mittente|registrata nei nostri sistemi|ritiro effettuato|presa in carico|affidata a gls|spedit|accettat/.test(s)) return 'spedita'
  // 8) TRATTO ESTERO di una Parcel (<TRACKINGINT>): sono i testi della Holding GLS e possono arrivare in
  //    inglese. Stanno IN FONDO apposta: le frasi italiane del nazionale si fermano ai punti sopra e qui
  //    non arrivano, quindi il nazionale non cambia. NON ANCORA VISTI su una Parcel vera (la prima e'
  //    da seguire): per questo si mappa solo l'evidente, e la giacenza estera NON si mappa — vorrebbe
  //    dire addebitarla in automatico senza averne mai letto il testo. Prima i negativi e gli annunci,
  //    poi la consegna: "could not be delivered" e "expected to be delivered" contengono "delivered".
  //    La consegna si riconosce SOLO in forma affermativa: GLS scrive "is loaded on the GLS delivery
  //    vehicle to be delivered in the course of the day" (in consegna) e "It cannot be delivered
  //    as…" / "has not been delivered" (mancata consegna), e con un generico /delivered/ tutte e tre
  //    diventavano "consegnata", che e' uno stato finale (il cron non la rilegge piu').
  if (/parcel ?shop|parcel ?locker|pick-?up point/.test(s)) return 'in_consegna'
  if (/not (be |been )?delivered|cannot be delivered|undeliverable/.test(s)) return 'non_consegnato'
  if (/to be delivered|will be delivered|delivery vehicle|out for delivery/.test(s)) return 'in_consegna'
  if (/\b(has|have) been delivered\b|\bwas delivered\b|\bdelivered to\b/.test(s)) return 'consegnata'
  if (/in transit|parcel cent(er|re)|has left|has reached/.test(s)) return 'in_transito'
  if (/handed over to gls|data (has been )?(received|transmitted)/.test(s)) return 'spedita'
  return null
}
