// ─────────────────────────────────────────────────────────────────────────────
// BRT (Bartolini) — REST API DIRETTA (contratto proprio del master)
//
// Endpoint: https://api.brt.it/rest/v1/shipments  (JSON, non SOAP).
// STRUTTURA VERIFICATA il 2/9/2026 contro l'API vera (contratto BRT PF di Quick): creata una
// spedizione di prova (parcelID 164130041700569503, etichetta PDF reale) e annullata. Operazioni:
//
//  • POST /shipment  — crea la spedizione. Body: {account, createData, isLabelRequired, labelParameters}.
//      Torna createResponse con executionMessage.code (0=ok, >0=warning, <0=errore), parcelNumberFrom/To
//      e labels.label[] (UNA per collo): parcelID (barcode 18 char), trackingByParcelID (15 char),
//      stream (etichetta base64, PDF se outputType=PDF). L'etichetta torna GIÀ qui (a differenza del GLS).
//  • PUT  /delete    — annulla. Identifica la spedizione con senderCustomerCode + numericSenderReference
//      (+ alphanumericSenderReference se passato in creazione): vanno quindi SALVATI. Subito dopo la
//      creazione torna -153 "still in processing": l'annullo va RITENTATO dopo qualche secondo.
//  • PUT  /confirm   — conferma (solo se il contratto è a "Conferma Esplicita"): senza, per quei contratti
//      BRT non passa a ritirare. Best-effort in chiusura distinta, come la CloseWorkDay del GLS.
//
// Le credenziali di produzione stanno in corrieri.credenziali (dal pannello), MAI in chat. Qui arrivano
// già lette da chi chiama. numericSenderReference è OBBLIGATORIO e numerico: lo generiamo univoco.
// ─────────────────────────────────────────────────────────────────────────────

import { testoIndicaReso } from '@/lib/spedisci'

const BRT_BASE = 'https://api.brt.it/rest/v1/shipments'

export type CredenzialiBrt = {
  user?: string            // account.userID
  password?: string        // account.password
  cod_cliente?: string     // senderCustomerCode
  cod_filiale?: string     // departureDepot
  codice_tariffa?: string  // pricingConditionCode
  orm_api_key?: string     // facoltativa (non usata dalla create)
}

export type ParcelBrt = {
  ragioneSociale: string
  indirizzo: string
  localita: string
  cap: string
  provincia: string
  paese?: string           // ISO alpha-2, default IT
  contatto?: string
  telefono?: string
  email?: string
  // PESO TOTALE della spedizione (BRT vuole il totale, non per collo) e NUMERO COLLI (max 30).
  pesoTotKg: number
  numeroColli: number
  volumeM3?: number
  importoContrassegno?: number   // EUR
  codPaymentType?: string        // tipo pagamento contrassegno (dal contratto)
  assicurazione?: number         // EUR
  note?: string
  rifOrdine?: string             // alphanumericSenderReference (max 15)
  // TIPO SERVIZIO (serviceType): '' standard, 'E' Priority, 'H' 10:30. È a scelta singola (un solo valore),
  // non additivo: lo decide il servizio accessorio scelto in creazione.
  serviceType?: string
}

export type RisultatoBrt = {
  parcelID: string | null        // barcode del PRIMO collo (18 char)
  tracking: string | null        // = parcelID (è il codice sull'etichetta)
  parcelIDs: string[]            // barcode di tutti i colli
  trackingByParcelID: string | null   // 15 char, per l'API di tracking BRT
  numericRef: number             // riferimento numerico (serve all'annullo) — DA SALVARE
  alphaRef: string | null        // riferimento alfanumerico (serve all'annullo)
  etichette: string[]            // etichette base64 (PDF), una per collo
  numeroColli: number
  errore: string | null
  warning: string | null
  raw: string
}

function num(v: unknown): number | undefined {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : undefined
}
function s(v: unknown, max: number): string {
  return String(v ?? '').trim().substring(0, max)
}

async function chiamaBrt(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST', timeoutMs = 25000): Promise<{ status: number; j: any; txt: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BRT_BASE}/${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    })
    const txt = await res.text()
    let j: any = null; try { j = JSON.parse(txt) } catch { /* non-JSON */ }
    return { status: res.status, j, txt }
  } finally {
    clearTimeout(t)
  }
}

// Riferimento numerico univoco per la spedizione (precision 15): ms + 2 cifre casuali. Serve a creare e
// poi a ritrovare la spedizione per l'annullo. Univoco per non farsi rifiutare da BRT una creazione dup.
function generaNumericRef(): number {
  return Date.now() * 100 + Math.floor(Math.random() * 100)
}

const EMPTY: RisultatoBrt = {
  parcelID: null, tracking: null, parcelIDs: [], trackingByParcelID: null,
  numericRef: 0, alphaRef: null, etichette: [], numeroColli: 0, errore: null, warning: null, raw: '',
}

// Crea una spedizione BRT (+ etichette). Torna parcelID/etichette o l'errore BRT.
export async function creaSpedizioneBrt(cred: CredenzialiBrt, p: ParcelBrt): Promise<RisultatoBrt> {
  const numericRef = generaNumericRef()
  const alphaRef = s(p.rifOrdine, 15) || null
  const conCod = !!(p.importoContrassegno && p.importoContrassegno > 0)
  const createData: any = {
    network: ' ',
    departureDepot: num(cred.cod_filiale),
    senderCustomerCode: num(cred.cod_cliente),
    deliveryFreightTypeCode: 'DAP',   // porto franco: paga il mittente (il nostro modello)
    consigneeCompanyName: s(p.ragioneSociale, 70),
    consigneeAddress: s(p.indirizzo, 35),
    consigneeZIPCode: s(p.cap, 9),
    consigneeCity: s(p.localita, 35),
    consigneeProvinceAbbreviation: s(p.provincia, 2).toUpperCase(),
    consigneeCountryAbbreviationISOAlpha2: (s(p.paese, 2) || 'IT').toUpperCase(),
    consigneeContactName: s(p.contatto, 35) || undefined,
    consigneeTelephone: s(p.telefono, 16) || undefined,
    consigneeEMail: s(p.email, 70) || undefined,
    isAlertRequired: '0',
    pricingConditionCode: s(cred.codice_tariffa, 3) || '',
    serviceType: s(p.serviceType, 1) || '',
    insuranceAmount: p.assicurazione && p.assicurazione > 0 ? Number(p.assicurazione.toFixed(2)) : undefined,
    insuranceAmountCurrency: p.assicurazione && p.assicurazione > 0 ? 'EUR' : undefined,
    cashOnDelivery: conCod ? Number(p.importoContrassegno!.toFixed(2)) : undefined,
    isCODMandatory: conCod ? '1' : '0',
    codPaymentType: conCod && p.codPaymentType ? s(p.codPaymentType, 2) : undefined,
    codCurrency: conCod ? 'EUR' : undefined,
    numberOfParcels: Math.max(1, Math.min(30, Math.round(p.numeroColli || 1))),
    weightKG: Number((p.pesoTotKg > 0 ? p.pesoTotKg : 1).toFixed(1)),
    volumeM3: p.volumeM3 && p.volumeM3 > 0 ? Number(p.volumeM3.toFixed(3)) : undefined,
    numericSenderReference: numericRef,
    alphanumericSenderReference: alphaRef || undefined,
    notes: s(p.note, 70) || undefined,
  }
  const body = {
    account: { userID: cred.user, password: cred.password },
    createData,
    isLabelRequired: '1',
    labelParameters: { outputType: 'PDF', offsetX: 0, offsetY: 0, isBorderRequired: '0', isLogoRequired: '1', isBarcodeControlRowRequired: '0' },
  }

  let r: { status: number; j: any; txt: string }
  try {
    r = await chiamaBrt('shipment', body, 'POST')
  } catch (e) {
    return { ...EMPTY, numericRef, alphaRef, errore: 'BRT non raggiungibile: ' + (e instanceof Error ? e.message : String(e)) }
  }
  const resp = r.j?.createResponse
  const em = resp?.executionMessage
  const code = num(em?.code)
  // code < 0 = errore; assenza di createResponse = risposta non valida.
  if (!resp || code === undefined || code < 0) {
    const msg = em ? `${em.codeDesc || ''}${em.message ? ' — ' + em.message : ''} (code ${em.code})`.trim() : `BRT: risposta non valida (HTTP ${r.status})`
    return { ...EMPTY, numericRef, alphaRef, errore: msg, raw: (r.txt || '').substring(0, 2000) }
  }
  const labelArr: any[] = Array.isArray(resp.labels?.label) ? resp.labels.label : []
  const etichette = labelArr.map(l => String(l?.stream || '').replace(/\s+/g, '')).filter(Boolean)
  const parcelIDs = labelArr.map(l => String(l?.parcelID || '').trim()).filter(Boolean)
  return {
    parcelID: parcelIDs[0] || null,
    tracking: parcelIDs[0] || null,
    parcelIDs,
    trackingByParcelID: labelArr[0]?.trackingByParcelID ? String(labelArr[0].trackingByParcelID).trim() : null,
    numericRef, alphaRef,
    etichette,
    numeroColli: labelArr.length || createData.numberOfParcels,
    errore: null,
    warning: code > 0 ? `${em.codeDesc || ''}${em.message ? ' — ' + em.message : ''}`.trim() : null,
    raw: (r.txt || '').substring(0, 2000),
  }
}

// Annulla una spedizione BRT (PUT /delete). Subito dopo la creazione BRT risponde -153 "in processing":
// il chiamante deve ritentare dopo qualche secondo. Torna true se l'annullo è confermato (code >= 0).
export async function annullaSpedizioneBrt(
  cred: CredenzialiBrt, ref: { numericRef: number; alphaRef?: string | null }
): Promise<{ ok: boolean; inLavorazione: boolean; errore: string | null }> {
  const body = {
    account: { userID: cred.user, password: cred.password },
    deleteData: {
      senderCustomerCode: num(cred.cod_cliente),
      numericSenderReference: ref.numericRef,
      ...(ref.alphaRef ? { alphanumericSenderReference: ref.alphaRef } : {}),
    },
  }
  try {
    const r = await chiamaBrt('delete', body, 'PUT')
    const em = r.j?.deleteResponse?.executionMessage
    const code = num(em?.code)
    if (code !== undefined && code >= 0) return { ok: true, inLavorazione: false, errore: null }
    // -153 = ancora in lavorazione: si può ritentare.
    const inLav = code === -153 || /in processing|still in process/i.test(String(em?.message || ''))
    return { ok: false, inLavorazione: inLav, errore: em ? `${em.codeDesc || ''} ${em.message || ''}`.trim() : `HTTP ${r.status}` }
  } catch (e) {
    return { ok: false, inLavorazione: false, errore: e instanceof Error ? e.message : String(e) }
  }
}

// Conferma esplicita — per i contratti a Conferma Esplicita. È lo shipment in PUT (stesso path della
// create): "Servizio necessario per confermare una spedizione creata con Create non autoconfermata".
// Chi ha Auto Conferma non la usa (Quick è auto: la create è già confermata). Best-effort.
export async function confermaSpedizioniBrt(
  cred: CredenzialiBrt, refs: { numericRef: number; alphaRef?: string | null }[]
): Promise<{ ok: boolean; errore: string | null; raw: string }> {
  if (!refs.length) return { ok: true, errore: null, raw: '' }
  let okTot = true, ultimoErr: string | null = null, raw = ''
  for (const ref of refs) {
    try {
      const r = await chiamaBrt('shipment', {
        account: { userID: cred.user, password: cred.password },
        confirmData: {
          senderCustomerCode: num(cred.cod_cliente),
          numericSenderReference: ref.numericRef,
          ...(ref.alphaRef ? { alphanumericSenderReference: ref.alphaRef } : {}),
        },
      }, 'PUT')
      raw = (r.txt || '').substring(0, 1000)
      const em = r.j?.confirmResponse?.executionMessage || r.j?.createResponse?.executionMessage
      const code = num(em?.code)
      if (code === undefined || code < 0) { okTot = false; ultimoErr = em ? `${em.codeDesc || ''} ${em.message || ''}`.trim() : `HTTP ${r.status}` }
    } catch (e) { okTot = false; ultimoErr = e instanceof Error ? e.message : String(e) }
  }
  return { ok: okTot, errore: okTot ? null : ultimoErr, raw }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACKING — GET /rest/v1/tracking/parcelID/{parcelID} (STRUTTURA VERIFICATA sulla doc BRT).
// Interroga col parcelID (barcode 18 char) salvato alla creazione. Risposta: lista_eventi[].evento
// (data/ora/descrizione) + descrizione_stato_sped_parte1/2 + data_consegna_merce (valorizzata = consegnata).
// Ritorna gli eventi come stringhe, che il cron mappa con mapStatoBrt + prioritaStato.
// ─────────────────────────────────────────────────────────────────────────────
const BRT_TRACK = 'https://api.brt.it/rest/v1/tracking/parcelID'

// La risposta può essere avvolta in un oggetto (es. parcelIDResponse): si trova il nodo che porta i
// campi del tracking ovunque sia annidato, senza dipendere dal nome esatto del wrapper.
function trovaNodoTracking(j: any): any {
  if (!j || typeof j !== 'object') return null
  if (Array.isArray(j.lista_eventi) || j.data_consegna_merce !== undefined || j.spedizione_data !== undefined) return j
  for (const k of Object.keys(j)) { const r = trovaNodoTracking(j[k]); if (r) return r }
  return null
}

export async function trackingBrt(parcelID: string, timeoutMs = 15000): Promise<{ stati: string[]; consegnata: boolean; raw: string }> {
  const id = String(parcelID || '').trim()
  if (!id) return { stati: [], consegnata: false, raw: '' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BRT_TRACK}/${encodeURIComponent(id)}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    const txt = await res.text()
    let j: any = null; try { j = JSON.parse(txt) } catch { /* non-JSON */ }
    const root = trovaNodoTracking(j) || {}
    const eventi: any[] = Array.isArray(root.lista_eventi) ? root.lista_eventi : []
    const stati = eventi.map((e: any) => String(e?.evento?.descrizione || e?.descrizione || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    // Stato sintetico (parte1/parte2) come ulteriori righe da mappare.
    for (const v of [root.descrizione_stato_sped_parte1, root.descrizione_stato_sped_parte2]) {
      const s2 = String(v || '').replace(/\s+/g, ' ').trim(); if (s2) stati.push(s2)
    }
    const consegnata = !!String(root.data_consegna_merce || '').trim()
    if (consegnata) stati.push('consegnata')
    return { stati, consegnata, raw: (txt || '').substring(0, 2000) }
  } catch {
    return { stati: [], consegnata: false, raw: '' }
  } finally {
    clearTimeout(t)
  }
}

// Mappa uno stato del tracking BRT allo stato interno (sullo stampo di mapStatoGls, regola RESO condivisa).
export function mapStatoBrt(testo: string): string | null {
  const x = (testo || '').toLowerCase().trim()
  if (!x) return null
  if (testoIndicaReso(x)) return 'reso_mittente'
  if (/consegnat/.test(x)) return 'consegnata'
  if (/giacenz/.test(x)) return 'in_giacenza'
  if (/in consegna|in distribuzione|out for delivery|consegna prevista/.test(x)) return 'in_consegna'
  if (/mancata|non riuscit|assente|rifiut|indirizzo errato|indirizzo incompleto/.test(x)) return 'non_consegnato'
  if (/in transito|transito|partit|arrivat|smistament|hub|in viaggio|filiale/.test(x)) return 'in_transito'
  if (/presa in carico|ritiro|accettat|spedit|creata|registrat|partenza/.test(x)) return 'spedita'
  return null
}
