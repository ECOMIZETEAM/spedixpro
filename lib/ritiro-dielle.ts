import { siglaProvincia } from '@/lib/province-it'
import { erroreRitiroPulito } from '@/lib/errore-corriere'
import type { MittenteRitiro } from '@/lib/ritiro-poste'

// IL RITIRO SUI CONTRATTI DIELLE (PDB L e gli altri "L"): una regola sola per il portale e per l'API.
//
// Fino al 23/11/2026 non c'era: la richiesta cadeva nel ripiego Spedisci.online e rispondeva "Impossibile
// recuperare il corriere dalla spedizione" (inkeaters ed EUROPOSTE, primo giorno di PDB L: spedizione
// creata, ritiro mai prenotato). Lorenzo: i ritiri si prenotano davvero sul fornitore.

export type EsitoRitiroDielle =
  | { ok: true; ritiroId: string; codice: string; data: string }
  | { ok: false; motivo: 'corriere'; errore: string }
  | { ok: false; motivo: 'registrazione'; codice: string; errore: string }

// Fascia del portale/API → orari della presa. Il fornitore vuole SEMPRE la coppia del pomeriggio
// (da 13:00 in poi); quella del mattino può essere 00:00. Chi chiede il mattino ha anche il pomeriggio
// come seconda finestra: senza, la presa non si registra.
export function orariPresaDielle(da: string, a: string): { mattina: { da: string; a: string } | null; pomeriggio: { da: string; a: string } } {
  const h = (s: string) => parseInt(String(s).split(':')[0], 10) || 0
  if (h(da) >= 13) return { mattina: null, pomeriggio: { da, a: h(a) > h(da) ? a : '18:00' } }
  return { mattina: { da: h(da) < 7 ? '07:00' : da, a: h(a) > 13 || !a ? '13:00' : a }, pomeriggio: { da: '14:00', a: '18:00' } }
}

export async function prenotaRitiroDielle(admin: any, p: {
  corriere: any                 // contratto tipo 'dielle' che ritira (per un ponte: quello vero, vedi contrattoCheRitira)
  masterId: string
  clienteId: string | null
  spedizioni: { id: string; colli?: number | null; peso_reale?: any; dest_paese?: string | null }[]   // quelle che si legano al ritiro
  ldv: string[]                 // i numeri presso il fornitore (sulla gamba vera, per un ponte)
  mittente: MittenteRitiro
  data: string                  // AAAA-MM-GG
  orario: { da: string; a: string }
  note?: string | null
  contenuto?: string | null
}): Promise<EsitoRitiroDielle> {
  const { credenzialiDielleContratto, vettoreDielle, vettoreDaServizioDielle, prenotaPresaDielle } = await import('@/lib/dielle')
  const cred = await credenzialiDielleContratto(admin, p.corriere.id)
  if (!cred) return { ok: false, motivo: 'corriere', errore: 'Contratto non configurato per il ritiro: contatta l\'assistenza.' }

  // Il fornitore tiene separate le prese per l'Italia e per l'estero (due prese per lo stesso indirizzo).
  const paesi = new Set(p.spedizioni.map(s => String(s.dest_paese || 'IT').toUpperCase() === 'IT' ? 'IT' : 'EST'))
  if (paesi.size > 1) return { ok: false, motivo: 'corriere', errore: 'Prenota separatamente il ritiro delle spedizioni per l\'Italia e di quelle per l\'estero: il corriere le ritira con due prenotazioni diverse.' }

  // L'email del mittente per la presa è obbligatoria. Se il modulo non la porta, quella del cliente.
  let email = String(p.mittente.email || '').trim()
  if (!email.includes('@') && p.clienteId) {
    const { data: cl } = await admin.from('clienti').select('email').eq('id', p.clienteId).maybeSingle()
    email = String((cl as any)?.email || '').trim()
  }
  if (!email.includes('@')) return { ok: false, motivo: 'corriere', errore: 'Inserisci l\'email del mittente: il corriere la richiede per prenotare il ritiro.' }

  const vettore = (p.ldv[0] ? await vettoreDielle(cred, p.ldv[0]) : null) || vettoreDaServizioDielle(p.corriere?.settings?.servizio)
  if (!vettore) return { ok: false, motivo: 'corriere', errore: 'Non riesco a capire quale corriere deve ritirare: contatta l\'assistenza.' }

  const colli = p.spedizioni.reduce((n, s) => n + (s.colli || 1), 0)
  const peso = p.spedizioni.reduce((n, s) => n + (parseFloat(String(s.peso_reale)) || 1), 0)
  const m = p.mittente
  const orari = orariPresaDielle(p.orario.da, p.orario.a)

  let esito: Awaited<ReturnType<typeof prenotaPresaDielle>>
  try {
    esito = await prenotaPresaDielle(cred, {
      recapito: {
        ragione_sociale: m.nome, referente: m.nome, indirizzo: m.indirizzo, comune: m.citta, cap: m.cap,
        provincia: siglaProvincia(m.provincia || '') || (m.provincia || ''), nazione: m.paese || 'IT',
        telefono: m.telefono || '', email,
      },
      data: p.data, mattina: orari.mattina, pomeriggio: orari.pomeriggio,
      pacchi: colli, pesoKg: peso, vettore, internazionale: paesi.has('EST'), note: p.note,
    })
  } catch (e: any) {
    console.error('[RITIRO][DIELLE] fornitore non raggiungibile:', String(e?.message || e).slice(0, 200))
    return { ok: false, motivo: 'corriere', errore: erroreRitiroPulito(e) }
  }
  if (!esito.ok) {
    console.error('[RITIRO][DIELLE] presa rifiutata del', p.data, vettore, '-', String(esito.errore).slice(0, 200))
    return { ok: false, motivo: 'corriere', errore: erroreRitiroPulito(esito.errore) }
  }

  // LE SPEDIZIONI DEL RITIRO SI CONFERMANO SUBITO (Lorenzo, 23/11): di regola la conferma al corriere parte
  // alla chiusura della distinta (lib/distinte-chiusura), ma un ritiro per oggi arriverebbe prima della
  // chiusura serale e il corriere passerebbe per pacchi che non conosce. Se non riesce il ritiro resta
  // valido: la chiusura della distinta la ritenta (riconfermare non fa danni, lib/dielle).
  try {
    const { confermaSpedizioniDielle } = await import('@/lib/dielle')
    const conf = await confermaSpedizioniDielle(cred, p.ldv)
    if (!conf.ok) console.error('[RITIRO][DIELLE] presa ok, conferma delle spedizioni non riuscita (la ritenta la distinta):', String(conf.errore).slice(0, 200))
  } catch (e: any) {
    console.error('[RITIRO][DIELLE] presa ok, conferma delle spedizioni non raggiungibile (la ritenta la distinta):', String(e?.message || e).slice(0, 200))
  }

  const { data: r, error } = await admin.from('ritiri').insert({
    master_id: p.masterId, cliente_id: p.clienteId, corriere_id: p.corriere.id,
    pickup_id: null, tracking_ritiro: esito.codice, cod_ritiro: esito.codice,
    mitt_nome: m.nome, mitt_indirizzo: m.indirizzo, mitt_citta: m.citta,
    mitt_provincia: m.provincia || null, mitt_cap: m.cap, mitt_telefono: m.telefono || null,
    colli, peso, contenuto: p.contenuto || null,
    data_ritiro: esito.data, stato: 'richiesto',
  }).select('id').single()
  if (error || !r?.id) return { ok: false, motivo: 'registrazione', codice: esito.codice, errore: error?.message || 'riga del ritiro non scritta' }
  const { error: eLink } = await admin.from('spedizioni').update({ ritiro_id: r.id }).in('id', p.spedizioni.map(s => s.id))
  if (eLink) console.error('[RITIRO][DIELLE] collegamento spedizioni al ritiro fallito:', r.id, eLink.message)
  return { ok: true, ritiroId: r.id, codice: esito.codice, data: esito.data }
}
