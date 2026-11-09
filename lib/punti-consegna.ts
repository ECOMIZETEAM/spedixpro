// LA CONSEGNA A UN PUNTO: QUALE CONTRATTO LA FA, E I PUNTI DA SCEGLIERE.
//
// Il portale spedisce a un punto da settembre (PuntoPoste e Uffici Postali, Fermopoint BRT, locker
// InPost) ma l'API pubblica no: il 09/11/2026 un cliente che si integra ce l'ha chiesto, con la mappa
// dei punti gia' pronta dal suo lato. Qui stanno le tre cose che servono a tutte e due le porte:
//
//   1. la REGOLA: un contratto consegna a un punto? serve il deposito del mittente? serve l'email del
//      destinatario? La usano il preventivo del portale e l'anteprima dei negozi (lib/tariffe-offerte)
//      e l'API pubblica. Era scritta solo dentro annotaPuntoPoste: un'API che la riscrivesse da sola,
//      il giorno che nasce un nuovo contratto a punto, manderebbe a casa pacchi che vanno al locker;
//   2. la RICERCA dei punti, con le stesse chiamate ai fornitori del selettore del portale, in una
//      forma unica per chi integra (i tre fornitori rispondono in tre forme diverse);
//   3. il RITROVAMENTO di un punto dal suo codice. Garantisce che il codice sia di QUESTO contratto
//      (ogni corriere ha i suoi codici, e uno sbagliato fa rifiutare la creazione) e da' l'indirizzo
//      del punto, che serve all'etichetta e al preventivo del fornitore.
//
// Nessun nome di fornitore tecnico esce di qui: i punti portano solo nome, indirizzo e tipo.

import { pudoConfigDaVettore, spediamoproPudoCourier, type CorrierePudoSp } from '@/lib/punti-poste'

// Che punto riceve un contratto. Valori dell'API pubblica: non cambiarli, li leggono i partner.
export type TipoPuntoContratto = 'punto_poste' | 'ufficio_postale' | 'fermopoint' | 'locker' | 'punto_sda'

export type ModalitaConsegna = {
  aUnPunto: boolean               // il pacco va a un punto preciso, da scegliere
  tipoPunto: TipoPuntoContratto | null
  deposito: boolean               // il mittente porta il pacco a un punto: niente ritiro, serve il tipo di deposito
  emailObbligatoria: boolean      // il codice per ritirare arriva al destinatario per email
  inpostLocker: boolean           // InPost diretto verso locker (punto passato a InPost cosi' com'e')
  courierSp: CorrierePudoSp | null
  tipologiaDva: 'RTZ' | 'FMP' | null
}

const DOMICILIO: ModalitaConsegna = {
  aUnPunto: false, tipoPunto: null, deposito: false, emailObbligatoria: false,
  inpostLocker: false, courierSp: null, tipologiaDva: null,
}

export function modalitaConsegna(c: { tipo?: string | null; credenziali?: any; settings?: any } | null | undefined): ModalitaConsegna {
  const cred = c?.credenziali || {}
  if (c?.tipo === 'inpost') {
    // Il Domicilio InPost (stesso tipo, senza consegna=locker) resta consegna a casa.
    return (c.settings as any)?.consegna === 'locker'
      ? { ...DOMICILIO, aUnPunto: true, tipoPunto: 'locker', inpostLocker: true }
      : DOMICILIO
  }
  if (c?.tipo === 'spediamopro') {
    const courier = spediamoproPudoCourier(cred.service_id)
    if (!courier) return DOMICILIO
    return {
      ...DOMICILIO, aUnPunto: true, emailObbligatoria: true, courierSp: courier,
      tipoPunto: courier === 'brt' ? 'fermopoint' : courier === 'inpost' ? 'locker' : 'punto_sda',
    }
  }
  const cfg = pudoConfigDaVettore(cred.vettore)
  return {
    ...DOMICILIO,
    aUnPunto: !!cfg.consegnaTipologia,
    tipoPunto: cfg.consegnaTipologia === 'RTZ' ? 'punto_poste' : cfg.consegnaTipologia === 'FMP' ? 'ufficio_postale' : null,
    deposito: cfg.deposito,
    tipologiaDva: cfg.consegnaTipologia,
  }
}

// Il deposito in partenza dei contratti PuntoPoste NON e' un punto preciso: e' il TIPO di sportello
// ('FMP' Ufficio Postale, 'APT' Punto Poste) e il mittente porta il pacco in uno qualsiasi. Si
// accettano i nomi dell'API e, per chi arriva dal portale, i codici.
export function depositoDaRichiesta(v: unknown): 'FMP' | 'APT' | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (s === 'ufficio_postale' || s === 'fmp') return 'FMP'
  if (s === 'punto_poste' || s === 'puntoposte' || s === 'apt') return 'APT'
  return null
}
export const depositoInRisposta = (d: 'FMP' | 'APT'): 'ufficio_postale' | 'punto_poste' => (d === 'FMP' ? 'ufficio_postale' : 'punto_poste')

// InPost Locker S: oltre queste misure il pacco finisce in un locker piu' grande, che costa di piu'
// della tariffa venduta (le guardie stanno nelle rotte di creazione). Qui solo per dirlo a chi integra.
export const eLockerS = (nomeContratto: unknown) => /\blocker\s*s\b/i.test(String(nomeContratto || ''))
export const LOCKER_S_CM: [number, number, number] = [64, 38, 19]

// ── Punti nella forma dell'API pubblica ──────────────────────────────────────────────────────────

export type TipoPunto = 'punto_poste' | 'ufficio_postale' | 'locker' | 'negozio'
export type PuntoApi = {
  code: string
  type: TipoPunto
  name: string
  address: string
  postalCode: string
  city: string
  province: string | null
  lat: number | null
  lng: number | null
  distanceKm: number | null
}

// Errore con lo stato HTTP da restituire: il CAP sbagliato e' un 400 di chi chiede, il fornitore
// che non risponde e' un 502 nostro. Confonderli manda a cercare il problema dalla parte sbagliata.
export class ErrorePunti extends Error {
  stato: number
  constructor(messaggio: string, stato = 400) { super(messaggio); this.stato = stato }
}

const numero = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

// UN SECONDO TENTATIVO quando il fornitore non risponde. La ricerca Fermopoint del fornitore risponde
// 503 a intermittenza (09/11/2026: due ricerche su cinque, a pochi minuti l'una dall'altra, e subito
// dopo di nuovo regolare). Un 400 invece (CAP rifiutato) non si ripete: la risposta sarebbe la stessa.
async function conUnaRiprova<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (/status code 400|bad request/i.test(msg)) throw e
    await new Promise(r => setTimeout(r, 1200))
    return await f()
  }
}

export async function cercaPuntiConsegna(
  corriere: { tipo?: string | null; credenziali?: any; settings?: any },
  q: { cap?: string; citta?: string; lat?: number; lng?: number },
): Promise<PuntoApi[]> {
  const m = modalitaConsegna(corriere)
  if (!m.aUnPunto) throw new ErrorePunti('Questo contratto consegna a domicilio: non ci sono punti da scegliere.')
  const cred = corriere.credenziali || {}
  const cap = String(q.cap || '').trim()
  const haPosizione = q.lat != null && q.lng != null && Number.isFinite(q.lat) && Number.isFinite(q.lng)
  if (!cap && !haPosizione) throw new ErrorePunti('Indica il CAP (postalCode) oppure la posizione (lat e lng).')

  if (m.inpostLocker) {
    if (!cred.clientId || !cred.secretId || !cred.organizationId) throw new ErrorePunti('Contratto non configurato.', 400)
    const { puntiInpost } = await import('@/lib/inpost')
    try {
      // Stessi parametri del selettore del portale (app/api/inpost/punti).
      const punti = await conUnaRiprova(() => puntiInpost(
        { clientId: cred.clientId, secretId: cred.secretId, organizationId: cred.organizationId, ambiente: cred.ambiente === 'prod' ? 'prod' : 'stage' },
        { cap: cap || undefined, lat: haPosizione ? q.lat : undefined, lng: haPosizione ? q.lng : undefined, maxDistanza: 15000, limite: 40 },
      ))
      return punti.filter(p => p.id).map(p => ({
        code: p.id, type: String(p.tipo).toUpperCase() === 'APM' ? 'locker' : 'negozio',
        name: p.nome || p.id, address: p.indirizzo, postalCode: p.cap, city: p.citta, province: null,
        lat: numero(p.lat), lng: numero(p.lng), distanceKm: null,
      }))
    } catch (e: any) {
      console.error('[PUNTI-CONSEGNA][INPOST]', String(e?.message || e).slice(0, 150))
      throw new ErrorePunti('Ricerca punti non disponibile in questo momento.', 502)
    }
  }

  if (m.courierSp) {
    // Questo fornitore cerca solo per CAP (niente coordinate), come nel selettore del portale.
    if (!cap) throw new ErrorePunti('Per questo contratto cerca i punti con il CAP (postalCode): la ricerca per posizione non è disponibile.')
    if (!cred.authcode) throw new ErrorePunti('Contratto non configurato.', 400)
    const { spediamoproPudoSearch } = await import('@/lib/spediamopro')
    try {
      const punti = await conUnaRiprova(() => spediamoproPudoSearch(cred.authcode, { courier: m.courierSp!, cap, city: String(q.citta || '').trim() || undefined }))
      return punti.map(p => ({
        code: p.codice, type: p.categoria === 'locker' ? 'locker' : 'negozio',
        name: p.nome, address: p.indirizzo, postalCode: p.cap, city: p.localita, province: p.provincia || null,
        lat: numero(p.lat), lng: numero(p.lon), distanceKm: numero(p.distanzaKm),
      }))
    } catch (e: any) {
      const msg = String(e?.message || e)
      console.error('[PUNTI-CONSEGNA][SP]', msg.slice(0, 150))
      // Il fornitore rifiuta i CAP generici di citta' (40100 Bologna no, 40121 si'): e' il CAP da correggere.
      if (/status code 400|bad request/i.test(msg)) throw new ErrorePunti('Nessun punto per questo CAP: controlla il CAP (i CAP generici di città non sono validi).')
      throw new ErrorePunti('Ricerca punti non disponibile in questo momento.', 502)
    }
  }

  if (m.tipologiaDva) {
    if (!cred.apikey) throw new ErrorePunti('Contratto non configurato.', 400)
    const { easyparcelPudo } = await import('@/lib/easyparcel')
    try {
      // La ricerca usa la FAMIGLIA vettore 'PDB' + la tipologia del punto (RTZ/FMP): come il portale.
      const punti = await conUnaRiprova(() => easyparcelPudo(cred.apikey, {
        vettore: 'PDB', tipologia: m.tipologiaDva!, cap: cap || undefined,
        lat: haPosizione ? q.lat : undefined, lon: haPosizione ? q.lng : undefined, radius: 20, limit: 30,
      }))
      return punti.map(p => ({
        code: p.codice, type: p.tipologia === 'FMP' ? 'ufficio_postale' : p.tipologia === 'APT' ? 'locker' : 'punto_poste',
        name: p.nome, address: p.indirizzo, postalCode: p.cap, city: p.localita, province: p.provincia || null,
        lat: numero(p.lat), lng: numero(p.lon), distanceKm: numero(p.distanzaKm),
      }))
    } catch (e: any) {
      console.error('[PUNTI-CONSEGNA][DVA]', String(e?.message || e).slice(0, 150))
      throw new ErrorePunti('Ricerca punti non disponibile in questo momento.', 502)
    }
  }

  throw new ErrorePunti('Questo contratto consegna a domicilio: non ci sono punti da scegliere.')
}

// IL PUNTO COME CE LO RIMANDA CHI INTEGRA (l'oggetto di GET /delivery-points, intero). Serve solo
// quando la ricerca del fornitore e' giu' anche al secondo tentativo: il portale in quel momento
// spedisce col punto che il browser ha in mano, e l'API non deve fermarsi dove il portale passa.
// Il codice sbagliato non passa comunque: lo rifiuta il fornitore alla creazione, prima di comprare.
// Null se mancano i dati per l'etichetta (indirizzo, CAP, citta').
export function puntoDichiarato(dp: unknown, codice: string): PuntoApi | null {
  if (!dp || typeof dp !== 'object') return null
  const d: any = dp
  const address = String(d.address || '').trim(), postalCode = String(d.postalCode || d.cap || '').trim(), city = String(d.city || '').trim()
  if (!codice || !address || !postalCode || !city) return null
  const t = String(d.type || '').trim()
  return {
    code: codice, type: (['punto_poste', 'ufficio_postale', 'locker', 'negozio'].includes(t) ? t : 'negozio') as TipoPunto,
    name: String(d.name || '').trim(), address, postalCode, city,
    province: String(d.province || '').trim().slice(0, 2).toUpperCase() || null,
    lat: numero(d.lat), lng: numero(d.lng), distanceKm: null,
  }
}

// Il punto scelto da chi integra, ritrovato fra quelli del contratto vicino al suo CAP. Null se il
// codice non c'e': codice inventato, di un altro corriere, o cercato con un CAP diverso.
export async function trovaPuntoDaCodice(
  corriere: { tipo?: string | null; credenziali?: any; settings?: any },
  codice: string,
  q: { cap?: string; citta?: string },
): Promise<PuntoApi | null> {
  const cercato = String(codice || '').trim().toUpperCase()
  if (!cercato) return null
  const punti = await cercaPuntiConsegna(corriere, q)
  return punti.find(p => String(p.code).trim().toUpperCase() === cercato) || null
}
