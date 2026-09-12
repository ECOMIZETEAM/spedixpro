// PuntoPoste / Ufficio Postale / Locker — mappatura contratto → punti, lato CLIENT-SAFE (nessun segreto).
//
// I contratti Poste PDB "Porta a un Punto Poste" (verificato 12/9 dal campo badge_tipo_consegna dell'API
// DVA, non dai nomi che ingannano):
//   PDB-P2H   = PuntoPoste (partenza) → Domicilio (arrivo a casa, nessun punto)
//   PDB-P2TAB = PuntoPoste (partenza) → PuntoPoste (arrivo)
//   PDB-P2UP  = PuntoPoste (partenza) → Ufficio Postale (arrivo)
// La PARTENZA è sempre un PuntoPoste (il cliente deposita il pacco): codice in `pudo_mittente`.
// La destinazione varia: `pudo_destinatario` per P2TAB/P2UP, niente per P2H (indirizzo di casa).
//
// TIPOLOGIA punti DVA (verificata sul campo, la doc mente: dice "APT=PuntoPoste" ma APT torna 0):
//   RTZ = PuntoPoste (tabaccherie/negozi/edicole)  •  FMP = Ufficio Postale  •  (INPOST = parcel_locker, altro vettore)

export type TipologiaPunto = 'RTZ' | 'FMP'
export type LatoPunto = 'partenza' | 'arrivo'
export type PudoConfig = { partenza: TipologiaPunto | null; arrivo: TipologiaPunto | null }

// Ritorna quali punti servono per un contratto (dal codice vettore DVA). Contratto normale → nulla.
export function pudoConfigDaVettore(vettore?: string | null): PudoConfig {
  switch (String(vettore || '').trim().toUpperCase()) {
    case 'PDB-P2H':   return { partenza: 'RTZ', arrivo: null }
    case 'PDB-P2TAB': return { partenza: 'RTZ', arrivo: 'RTZ' }
    case 'PDB-P2UP':  return { partenza: 'RTZ', arrivo: 'FMP' }
    default:          return { partenza: null, arrivo: null }
  }
}

// true se il contratto usa i PuntoPoste (almeno un lato).
export function eContrattoPuntoPoste(vettore?: string | null): boolean {
  const c = pudoConfigDaVettore(vettore)
  return !!(c.partenza || c.arrivo)
}

// Etichetta leggibile del tipo di punto (per la UI, senza nominare il provider tecnico).
export function etichettaTipologia(t?: string | null): string {
  switch (String(t || '').toUpperCase()) {
    case 'RTZ': return 'PuntoPoste'
    case 'FMP': return 'Ufficio Postale'
    default: return 'Punto di ritiro'
  }
}
