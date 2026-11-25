import { spediamoproCreatePickup, spediamoproWaitPickupCode, codiceRitiroSpediamopro, type SpediamoproPickupContact } from '@/lib/spediamopro'
import { dataDaRiprovare } from '@/lib/ritiro-giorno'
import { siglaProvincia } from '@/lib/province-it'

// IL RITIRO SU SPEDIAMOPRO, per il portale (/api/ritiri/crea) e per l'API pubblica (/api/v1/pickups).
//
// Dal 3 al 17/11/2026 SpediamoPro ha respinto circa 1.600 richieste di ritiro, e quasi tutte per motivi
// che si correggono senza chiedere niente a nessuno:
//   - 1.015 "Invalid data": nome o indirizzo oltre la lunghezza massima, che cambia col corriere
//     (indirizzo 35; nome 22, 35 o 40). Il corriere dice il campo e il massimo: si accorcia e si riprova.
//   - 263 ritiri in giornata dopo le 11:55, o in zone dove in giornata non passa: il giorno dopo.
//   - 99 "pickup address is not valid for the shipment sender": la pagina Nuovo ritiro manda lo stesso
//     indirizzo per tutte le spedizioni scelte, SpediamoPro vuole quello del mittente di ciascuna.
// Prima ogni porta aveva la sua chiamata e nessuna riprovava: il pacco restava dal mittente.

export type ContattoRitiro = SpediamoproPickupContact

export type EsitoRitiroSpediamopro =
  | { ok: true; id: number; codice: string; data: string }
  | { ok: false; errore: any }

// I dettagli che SpediamoPro mette nel 422: [{ source: 'contactInfo.name', message: 'Maximum length 35' }].
// Letti coppia per coppia e non col JSON: lib/spediamopro taglia il corpo della risposta a 300
// caratteri, e con due campi sbagliati il JSON arriva spezzato e non si legge piu'.
function dettagli(testo: string): Array<{ source?: string; message?: string }> {
  return [...String(testo || '').matchAll(/"source"\s*:\s*"([^"]*)"\s*,\s*"message"\s*:\s*"([^"]*)"/g)]
    .map(m => ({ source: m[1], message: m[2] }))
}

export async function prenotaRitiroSpediamopro(authcode: string, p: {
  contactInfo: ContattoRitiro
  // Il mittente della spedizione (dalla nostra riga): si usa solo se SpediamoPro rifiuta l'indirizzo
  // scritto nel modulo perche' non e' quello del mittente.
  mittenteSpedizione?: { nome?: string | null; indirizzo?: string | null; cap?: string | null; citta?: string | null; provincia?: string | null } | null
  date: string; from: string; to: string; shipments: number[]; courier: string
}): Promise<EsitoRitiroSpediamopro> {
  let contatto: ContattoRitiro = { ...p.contactInfo }
  let data = p.date
  let ultimo: any = null
  const giaFatto = new Set<string>()
  // Al massimo una correzione per giorno e mittente, piu' le lunghezze: arrivano un campo alla volta, e dopo
  // aver preso il mittente della spedizione il suo nome puo' essere di nuovo troppo lungo (provato: 6 giri).
  for (let tentativo = 0; tentativo < 7; tentativo++) {
    try {
      const pk = await spediamoproCreatePickup(authcode, { contactInfo: contatto, date: data, from: p.from, to: p.to, shipments: p.shipments, courier: p.courier })
      // Il POST non restituisce sempre il codice (CP...): lo si legge con una GET.
      let codice: string | null = pk.code
      if (!codice && pk.id) codice = await spediamoproWaitPickupCode(authcode, pk.id)
      return { ok: true, id: pk.id, codice: codice || String(pk.id), data }
    } catch (e: any) {
      ultimo = e
      const testo = String(e?.message || e)

      let accorciato = false
      for (const d of dettagli(testo)) {
        const max = Number((String(d?.message || '').match(/maximum length (\d+)/i) || [])[1])
        const campo = String(d?.source || '').replace(/^contactInfo\./, '') as keyof ContattoRitiro
        const valore = (contatto as any)[campo]
        if (max && typeof valore === 'string' && valore.length > max) {
          contatto = { ...contatto, [campo]: valore.slice(0, max).trim() }
          accorciato = true
        }
      }
      if (accorciato) continue

      if (!giaFatto.has('data')) {
        const nuova = dataDaRiprovare(testo, data)
        if (nuova) { data = nuova; giaFatto.add('data'); continue }
      }

      const ms = p.mittenteSpedizione
      if (!giaFatto.has('mittente') && ms?.cap && ms?.citta && /pickup address is not valid for the shipment sender/i.test(testo)) {
        const prov = siglaProvincia(String(ms.provincia || ''))
        contatto = {
          ...contatto,
          name: String(ms.nome || contatto.name).trim(),
          address: String(ms.indirizzo || contatto.address).trim(),
          postalCode: String(ms.cap).trim(),
          city: String(ms.citta).trim(),
          ...(prov && prov.length === 2 ? { province: prov } : {}),
        }
        giaFatto.add('mittente')
        continue
      }
      break
    }
  }
  // Il motivo nei log, senza i dati del mittente: e' cio' che serve per il controllo per contratto.
  const testo = String(ultimo?.message || ultimo || '')
  const motivo = (testo.match(/"message":"([^"]*)"/) || [])[1] || testo.replace(/\{[\s\S]*\}/, '').trim()
  const campi = dettagli(testo).filter(d => String(d?.source || '').includes('.')).map(d => `${d?.source}: ${d?.message}`).join('; ')
  console.error('[RITIRO][SPEDIAMOPRO] ritiro rifiutato -', String(motivo).slice(0, 160), campi ? `(${campi.slice(0, 160)})` : '')
  return { ok: false, errore: ultimo }
}

// LO STATO DEL RITIRO SECONDO SPEDIAMOPRO (doc API v2, Pickup.status; "non e' un percorso in sequenza").
// Prima si guardava solo "almeno 4 = elaborato": un ritiro gia' fatto, uno annullato dal corriere e uno
// appena confermato apparivano tutti "Elaborato". Le parole sono in lib/ritiro-vista.
//   0 il corriere ha dato errore · 1-3 creato, validato, in lavorazione presso il fornitore · 4 confermato
//   dal corriere · 5 annullato dal fornitore · 6 annullato dal corriere (rifiutato, nessuno all'indirizzo…)
//   7 merce ritirata · 8 rimandato (merce non pronta)
export function statoRitiroSpediamopro(status: unknown): string | null {
  if (status === null || status === undefined || status === '') return null
  switch (Number(status)) {
    case 0: return 'errore'
    case 1: case 2: case 3: return 'prenotato'
    case 4: return 'confermato'
    case 5: return 'annullato'
    case 6: return 'annullato_corriere'
    case 7: return 'ritirato'
    case 8: return 'rimandato'
    default: return null
  }
}

// Lo stato dopo cui non si rilegge piu'. Solo 'ritirato': la doc dice che gli stati non vanno in sequenza, e un
// "rifiutato" o un "annullato" possono ancora cambiare. Tanto si rilegge solo finche' il ritiro e' recente.
export const STATI_RITIRO_FINALI = ['ritirato']

// Il codice sulla riga e' ancora il numero interno del fornitore (o manca): si puo' sostituire. Un codice
// vero del corriere (CP…, quello di UPS, anche se fatto di sole cifre) non si tocca mai.
function codiceInterno(cod: unknown, pickupId: unknown): boolean {
  const s = String(cod ?? '').trim()
  if (!s) return true
  return /^\d+$/.test(s) && Number(s) === Number(pickupId)
}

// COSA CAMBIA SU UNA RIGA RITIRI dopo averla riletta presso il fornitore. La usano il giro automatico
// (lib/ritiro-codice) e il recupero una tantum.
export function aggiornamentoRitiroSpediamopro(
  riga: { stato?: string | null; cod_ritiro?: string | null; pickup_id?: number | null; data_ritiro?: string | null },
  pk: any,
): Record<string, string> {
  const upd: Record<string, string> = {}
  if (!pk) return upd
  const stato = statoRitiroSpediamopro(pk.status)
  if (stato && stato !== riga.stato) upd.stato = stato
  // Il giorno lo decide il corriere: un ritiro rimandato cambia data, e con la data vecchia uscirebbe dal giro
  // prima che arrivino codice e "ritirato".
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(pk.date || '')) && riga.data_ritiro && pk.date !== riga.data_ritiro) upd.data_ritiro = pk.date
  const codice = codiceRitiroSpediamopro(pk)
  if (codice && codiceInterno(riga.cod_ritiro, riga.pickup_id) && !codiceInterno(codice, riga.pickup_id) && codice !== riga.cod_ritiro) {
    upd.cod_ritiro = codice
    upd.tracking_ritiro = codice
  }
  return upd
}
