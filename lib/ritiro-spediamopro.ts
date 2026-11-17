import { spediamoproCreatePickup, spediamoproWaitPickupCode, type SpediamoproPickupContact } from '@/lib/spediamopro'
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
