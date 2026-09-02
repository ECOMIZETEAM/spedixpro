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
  const parcels = pesi.map((peso, idx) => {
    const primo = idx === 0
    const campi = [
      tag('CodiceContrattoGls', cred.codice_contratto),
      tag('RagioneSociale', (p.ragioneSociale || '').substring(0, 70)),
      tag('Indirizzo', (p.indirizzo || '').substring(0, 70)),
      tag('Localita', (p.localita || '').substring(0, 50)),
      tag('Zipcode', p.cap),
      tag('Provincia', (p.provincia || '').substring(0, 2).toUpperCase()),
      tag('Colli', '1'),
      tag('PesoReale', pesoIt(peso)),
      // Contrassegno / assicurazione / note / riferimento SOLO sul primo collo (dati di spedizione,
      // non di collo: ripeterli su ogni Parcel rischia di moltiplicarli).
      primo && p.importoContrassegno && p.importoContrassegno > 0 ? tag('Importocontrassegno', euroIt(p.importoContrassegno)) : '',
      primo && p.importoContrassegno && p.importoContrassegno > 0 && p.modalitaIncasso ? tag('ModalitaIncasso', p.modalitaIncasso) : '',
      primo && p.assicurazione && p.assicurazione > 0 ? tag('Assicurazione', euroIt(p.assicurazione)) : '',
      primo && p.note ? tag('Notespedizione', p.note.substring(0, 100)) : '',
      primo && p.bda ? tag('Bda', String(p.bda).substring(0, 20)) : '',
    ].filter(Boolean).join('')
    return `<Parcel>${campi}</Parcel>`
  }).join('')
  return `<Info>${info}${parcels}</Info>`
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
export async function etichetteGls(
  cred: CredenzialiGls, numeroSpedizione: string, numeroColli: number, opts?: { bda?: string; tipoPorto?: string }
): Promise<{ etichette: string[]; errore: string | null }> {
  const n = Math.max(1, Math.round(numeroColli || 1))
  const etichette: string[] = []
  for (let i = 1; i <= n; i++) {
    try {
      const et = await etichettaGls(cred, numeroSpedizione, { ...opts, numeroCollo: String(i) })
      if (et.pdfBase64) etichette.push(et.pdfBase64)
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
    for (const s of speds || []) {
      const raw = (s.raw_response || {}) as any
      let n = raw?.numero ? String(raw.numero) : ''
      if (!n) { const mm = String(s.numero || s.tracking_number || '').match(/\d{6,}/); n = mm ? mm[0] : '' }
      if (n) numeri.push(n)
    }
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
  const et = await etichetteGls(cred, numeroBare, nColli)
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
): Promise<{ stati: string[]; raw: string }> {
  const sede = (cred.sigla_sede || '').trim()
  const contratto = (cred.codice_contratto || '').trim()
  const num = String(numeroNudo || '').replace(/\D/g, '')   // il T&T vuole il numero NUDO (solo cifre)
  if (!sede || !num) return { stati: [], raw: '' }
  const url = `${GLS_TT_ENDPOINT}?locpartenza=${encodeURIComponent(sede)}&NumSped=${encodeURIComponent(num)}` +
    (contratto ? `&CodCli=${encodeURIComponent(contratto)}` : '')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  let xml = ''
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/xml, text/xml' } })
    xml = await res.text()
  } catch {
    return { stati: [], raw: '' }   // rete/timeout: nessun aggiornamento, si riprova al giro dopo
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
  return { stati, raw: xml.substring(0, 2000) }
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
  return null
}
