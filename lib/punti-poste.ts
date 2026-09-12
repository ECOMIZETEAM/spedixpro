// PuntoPoste / Ufficio Postale — mappatura contratto → punti, lato CLIENT-SAFE (nessun segreto).
//
// Contratti Poste PDB "Porta a un Punto Poste" (verificato 12/9 con ORDINI REALI sull'API DVA):
//   PDB-P2H   = deposito a un punto → consegna a Domicilio (casa)
//   PDB-P2TAB = deposito a un punto → consegna a un PuntoPoste
//   PDB-P2UP  = deposito a un punto → consegna a un Ufficio Postale
//
// DUE cose DIVERSE nell'ordine DVA (accessori):
//  • pudo_mittente = DOVE SI DEPOSITA, ma è una **TIPOLOGIA**, non un punto preciso: vale "FMP"
//    (Ufficio Postale) o "APT" (Punto Poste). Obbligatorio per tutti e tre. (Provato: un codice punto
//    come mittente dà errore 175 "tipologia non valida (ammessi FMP, APT)"; il valore giusto è la
//    stringa "FMP"/"APT".)
//  • pudo_destinatario = il PUNTO PRECISO di consegna (codice dalla chiamata pudo). Solo P2TAB (un
//    PuntoPoste, tipologia RTZ) e P2UP (un Ufficio Postale, tipologia FMP). P2H consegna a casa → niente.
// Niente reverse (gli ordini di prova sono passati senza).
//
// TIPOLOGIE pudo (verificate sul campo): RTZ = PuntoPoste (tabaccherie/negozi) • FMP = Ufficio Postale
// • APT = "Punto Poste Locker" (ricerca solo per provincia, senza coordinate).

export type TipologiaPunto = 'RTZ' | 'FMP' | 'APT'
export type DepositoTipo = 'FMP' | 'APT'   // valore di pudo_mittente

export type PudoConfig = {
  deposito: boolean                      // true: il mittente sceglie DOVE depositare (FMP/APT)
  consegnaTipologia: 'RTZ' | 'FMP' | null // punto di consegna da scegliere (con mappa), o null (casa)
}

export function pudoConfigDaVettore(vettore?: string | null): PudoConfig {
  switch (String(vettore || '').trim().toUpperCase()) {
    case 'PDB-P2H':   return { deposito: true, consegnaTipologia: null }
    case 'PDB-P2TAB': return { deposito: true, consegnaTipologia: 'RTZ' }
    case 'PDB-P2UP':  return { deposito: true, consegnaTipologia: 'FMP' }
    default:          return { deposito: false, consegnaTipologia: null }
  }
}

export function eContrattoPuntoPoste(vettore?: string | null): boolean {
  const c = pudoConfigDaVettore(vettore)
  return c.deposito || !!c.consegnaTipologia
}

// Etichetta leggibile del tipo di punto (UI, senza nominare il provider tecnico).
export function etichettaTipologia(t?: string | null): string {
  switch (String(t || '').toUpperCase()) {
    case 'RTZ': return 'PuntoPoste'
    case 'FMP': return 'Ufficio Postale'
    case 'APT': return 'Punto Poste'
    default: return 'Punto di ritiro'
  }
}
