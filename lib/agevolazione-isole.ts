// AGEVOLAZIONE ISOLE MAGGIORI.
//
// Su certi contratti il fornitore non fa pagare il supplemento delle isole (la zona "SCS") quando il
// pacco parte e arriva nella stessa area: per DVA, sui servizi Poste, Palermo→Catania, Palermo→Reggio
// Calabria e Cagliari→Sassari costano come Milano→Roma, mentre Napoli→Palermo e Palermo→Cagliari pagano
// la SCS (preventivi del 26/11/2026, PDBX 3 kg: 5,44 contro 6,54). Le aree sono due: Sicilia e Calabria
// INSIEME (Reggio→Palermo e Palermo→Reggio sono prezzo Italia), e la Sardegna da sola.
//
// Chi gode dell'agevolazione lo decide chi vende, listino per listino (Lorenzo, 26/11/2026): MULTIEXPRESS
// la accende sul listino di un master, quel master la paga cosi' su tutte le spedizioni sue e della sua
// rete, e ai suoi clienti la da' solo se la accende anche lui. Spenta, i prezzi restano quelli di sempre.
//
// Valgono insieme tre cose: il listino con il flag, il contratto su cui il fornitore la concede davvero
// (`corrieri.settings.agevolazione_isole`, che il database fa scendere alle copie), mittente e
// destinatario nella stessa area. Allora la zona regionale (SCS) non rivendica la destinazione e vale il
// prezzo Italia del listino; le zone piu' precise (Isole Minori, Disagiate) restano come sono.

export type AreaIsole = 'sicilia_calabria' | 'sardegna'

const PROVINCE_SICILIA_CALABRIA = new Set(['AG', 'CL', 'CT', 'EN', 'ME', 'PA', 'RG', 'SR', 'TP', 'CS', 'CZ', 'KR', 'RC', 'VV'])
const PROVINCE_SARDEGNA = new Set(['CA', 'CI', 'MD', 'NU', 'OG', 'OR', 'OT', 'SS', 'SU', 'VS'])

type Luogo = { provincia?: string | null; cap?: string | null; paese?: string | null }

// L'area di un indirizzo italiano: dalla provincia; se manca o non e' una sigla nota, dal CAP
// (87-89 Calabria, 90-98 Sicilia, 07-09 Sardegna). Fuori dall'Italia, o senza dati, nessuna area.
export function areaIsole(l: Luogo | null | undefined): AreaIsole | null {
  if (!l) return null
  const paese = String(l.paese || 'IT').trim().toUpperCase()
  if (paese && paese !== 'IT') return null
  const prov = String(l.provincia || '').trim().toUpperCase()
  if (PROVINCE_SICILIA_CALABRIA.has(prov)) return 'sicilia_calabria'
  if (PROVINCE_SARDEGNA.has(prov)) return 'sardegna'
  const cap = String(l.cap || '').trim()
  if (!/^\d{5}$/.test(cap)) return null
  const p2 = Number(cap.slice(0, 2))
  if (p2 >= 87 && p2 <= 98) return 'sicilia_calabria'
  if (p2 >= 7 && p2 <= 9) return 'sardegna'
  return null
}

// Partenza e arrivo nella stessa area. Mittente sconosciuto = no: senza sapere da dove parte il pacco
// non si regala niente (vale il prezzo di sempre).
export function stessaAreaIsole(mitt: Luogo | null | undefined, dest: Luogo | null | undefined): boolean {
  const a = areaIsole(mitt)
  return !!a && a === areaIsole(dest)
}

// Il contratto su cui il fornitore concede l'agevolazione (impostazione del contratto del detentore,
// copiata alle copie dei master dal trigger trg_corrieri_settings_alle_copie).
export function contrattoConAgevolazioneIsole(corriere: { settings?: any } | null | undefined): boolean {
  return (corriere?.settings as any)?.agevolazione_isole === true
}

// I contratti per cui, su QUESTA spedizione e con QUESTO listino, la zona regionale non vale.
// Vuoto quando il listino non ha il flag o la spedizione non resta nell'area: il motore lavora come prima.
export function corrieriConAgevolazioneIsole(
  corrieri: Iterable<{ id?: string | null; settings?: any } | null | undefined>,
  flagListino: boolean,
  mitt: Luogo | null | undefined,
  dest: Luogo | null | undefined,
): Set<string> {
  const out = new Set<string>()
  if (!flagListino || !stessaAreaIsole(mitt, dest)) return out
  for (const c of corrieri) if (c?.id && contrattoConAgevolazioneIsole(c)) out.add(c.id)
  return out
}
