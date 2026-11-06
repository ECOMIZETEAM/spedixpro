import { siglaProvincia } from '@/lib/province-it'
import { erroreRitiroPulito } from '@/lib/errore-corriere'

// IL RITIRO SU POSTE DIRETTO (KSync): una regola sola per il portale e per l'API pubblica.
//
// Il portale (/api/ritiri/crea) i ritiri SDA EXPRESS L li prenotava da sempre; l'API no: sui ponti di
// condivisione e su Poste diretto rispondeva "richiedilo dal portale", e chi si integrava doveva entrare
// nel portale per ogni lotto (06/11/2026). Qui stanno i pezzi che le porte condividono: quale contratto
// fa davvero il ritiro, i controlli prima di chiamare il corriere, la prenotazione con la sua riga
// nell'elenco Ritiri.

// Il contratto che prenota il ritiro. Una gamba-ponte ('moovexpress') non ha un corriere suo: il ritiro
// lo prenota il contratto vero dello stesso pacco (la gamba non-ponte con lo stesso tracking), con le SUE
// credenziali. Senza, un ponte cadeva nel ripiego Spedisci e rispondeva "Impossibile recuperare il
// corriere". Senza tracking resta il contratto di partenza, come ha sempre fatto il portale.
export async function contrattoCheRitira(
  admin: any, corriere: any, tracking: string | null | undefined,
): Promise<{ corriere: any } | { errore: string }> {
  if (corriere?.tipo !== 'moovexpress' || !tracking) return { corriere }
  const { risolviGambeSpedizione } = await import('@/lib/condivisione-catena')
  const gambe = await risolviGambeSpedizione(admin, tracking)
  const owner = gambe.find((g: any) => g.tipo && g.tipo !== 'moovexpress')
  if (!owner) return { errore: 'Contratto condiviso: nessun owner reale per prenotare il ritiro.' }
  const { data: spO } = await admin.from('spedizioni').select('corriere_id').eq('id', owner.spedizioneId).maybeSingle()
  const { data: corrO } = (spO as any)?.corriere_id
    ? await admin.from('corrieri').select('id,tipo,credenziali,settings').eq('id', (spO as any).corriere_id).maybeSingle()
    : { data: null as any }
  if (!corrO) return { errore: 'Contratto condiviso: corriere dell\'owner non trovato per il ritiro.' }
  return { corriere: corrO }
}

const soloCifre = (v: any): string => String(v || '').replace(/[^0-9]/g, '')

// Gli stessi controlli del portale, per le porte che non li fanno gia' da sole (la creazione via API
// non guardava la data del ritiro). Senza, il corriere rifiuta con un errore poco chiaro.
export function motivoRitiroNonValido(data: string | null | undefined, telefono: string | null | undefined): string | null {
  const d = new Date(String(data || '') + 'T12:00:00')
  if (!data || isNaN(d.getTime())) return 'data del ritiro non valida (AAAA-MM-GG).'
  // "Oggi" nel fuso ITALIANO (il server gira in UTC: tra mezzanotte e le 2 l'UTC e' ancora ieri).
  const oggiRoma = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
  if (String(data) < oggiRoma) return 'la data del ritiro e\' gia\' passata: usa una data da oggi in poi.'
  if ([0, 6].includes(d.getDay())) return 'la data del ritiro cade di sabato o domenica: il corriere ritira solo nei giorni lavorativi (lun-ven).'
  if (soloCifre(telefono).length < 6) return 'serve il telefono del mittente (almeno 6 cifre): il corriere lo richiede per prenotare il ritiro.'
  return null
}

export type MittenteRitiro = {
  nome: string; indirizzo: string; citta: string; cap: string
  provincia?: string | null; paese?: string | null
  telefono?: string | null   // come la porta lo vuole registrare; al corriere vanno solo le cifre
  email?: string | null
}

export type EsitoRitiroPoste =
  | { ok: true; ritiroId: string; codice: string }
  | { ok: false; motivo: 'corriere'; errore: string }
  | { ok: false; motivo: 'registrazione'; codice: string; errore: string }

// Prenota il ritiro presso Poste (/pickup/booking) e lo registra nell'elenco Ritiri: intestato a chi
// spedisce (master e cliente della spedizione di partenza) ma sul contratto che ritira, come ha sempre
// fatto il portale. Le spedizioni si legano al ritiro: escono dalle "da ritirare" (niente doppioni) e il
// dettaglio via API ne rilegge il codice.
export async function prenotaRitiroPoste(admin: any, p: {
  corriere: any                 // contratto tipo 'poste' che ritira (vedi contrattoCheRitira)
  masterId: string
  clienteId: string | null
  spedizioni: { id: string; numero?: string | null; tracking_number?: string | null; colli?: number | null; peso_reale?: any }[]
  mittente: MittenteRitiro
  data: string                  // AAAA-MM-GG
  fascia: 'AM' | 'PM'
  note?: string | null
  contenuto?: string | null
}): Promise<EsitoRitiroPoste> {
  const { ritiroPrenotaKsync } = await import('@/lib/ksync')
  const cred: any = p.corriere?.credenziali || {}
  const st: any = p.corriere?.settings || {}
  const credPo = { clientId: cred.clientId, secretId: cred.secretId, costCenterCode: cred.costCenterCode, ambiente: (cred.ambiente === 'demo' ? 'demo' : 'prod') as 'prod' | 'demo', baseUrl: cred.baseUrl, scope: cred.scope }
  const prima = p.spedizioni[0]
  const colli = p.spedizioni.reduce((n, s) => n + (s.colli || 1), 0)
  const peso = p.spedizioni.reduce((n, s) => n + (parseFloat(String(s.peso_reale)) || 1), 0)
  const m = p.mittente

  let codice = ''
  try {
    const ris = await ritiroPrenotaKsync(credPo, {
      bookingType: st.booking_type || 'RIT0003',
      indirizzo: {
        ragioneSociale: m.nome, referente: m.nome, indirizzo: m.indirizzo, cap: m.cap, citta: m.citta,
        provincia: siglaProvincia(m.provincia || '') || (m.provincia || ''), paese: m.paese || 'IT',
        telefono: soloCifre(m.telefono), email: m.email || '',
      },
      numColli: colli, pesoKg: peso,
      shipmentId: prima?.tracking_number || prima?.numero || '',
      dataRitiro: p.data, timeSlot: p.fascia, note: p.note || undefined,
    })
    if (!ris.ok || !ris.bookingId) return { ok: false, motivo: 'corriere', errore: erroreRitiroPulito(ris.errore || 'Poste: ritiro non riuscito') }
    codice = ris.bookingId
  } catch (e: any) {
    return { ok: false, motivo: 'corriere', errore: erroreRitiroPulito(e) }
  }

  const { data: r, error } = await admin.from('ritiri').insert({
    master_id: p.masterId, cliente_id: p.clienteId, corriere_id: p.corriere.id,
    pickup_id: null, tracking_ritiro: codice, cod_ritiro: codice,
    mitt_nome: m.nome, mitt_indirizzo: m.indirizzo, mitt_citta: m.citta,
    mitt_provincia: m.provincia || null, mitt_cap: m.cap, mitt_telefono: m.telefono || null,
    colli, peso, contenuto: p.contenuto || null,
    data_ritiro: p.data, stato: 'richiesto',
  }).select('id').single()
  if (error || !r?.id) return { ok: false, motivo: 'registrazione', codice, errore: error?.message || 'riga del ritiro non scritta' }
  const { error: eLink } = await admin.from('spedizioni').update({ ritiro_id: r.id }).in('id', p.spedizioni.map(s => s.id))
  if (eLink) console.error('[RITIRO][POSTE] collegamento spedizioni al ritiro fallito:', r.id, eLink.message)
  return { ok: true, ritiroId: r.id, codice }
}
