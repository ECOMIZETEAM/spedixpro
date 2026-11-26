import { isZonaDisagiata } from '@/lib/zone-match'

// UNA DESTINAZIONE CHE IL CORRIERE FA PAGARE COME PERIFERICA/DISAGIATA/ISOLA NON SI VENDE A PREZZO PIANURA,
// DA NESSUNA PORTA.
//
// Il corriere sa da solo se un indirizzo è una località disagiata: SpediamoPro lo mette nel supplemento di
// destinazione del preventivo, DVA in due flag sull'offerta, Spedisci nel nome della zona. Le nostre liste di
// CAP non lo sapranno mai del tutto (le frazioni non hanno una mappa verso il comune: Champoluc, Zoldo Alto,
// Portella di Mare). Se il corriere dice "speciale" e la nostra vendita è uscita da una zona normale, la
// spedizione verrebbe pagata dal detentore del contratto a prezzo pieno e incassata a prezzo pianura: si ferma.
//
// La regola stava scritta solo nella creazione dal portale, e solo per le spedizioni con un cliente. Dal 10 al
// 26/11/2026 sono passati dall'API v1 13 pacchi BRT Express con 8,00 € di supplemento venduti a prezzo Italia
// (es. 050021293226917 Vico Canavese: pagati 12,59 € al fornitore, incassati 4,88 €) e dal portale una
// spedizione propria di un master senza cliente (050148293174937 Portella di Mare: 13,69 € contro 5,88 €).
// Per questo la decisione sta qui e la usano tutte le porte.

// La zona di vendita "copre" il supplemento SOLO se è una zona disagiata/periferica o isole. Le zone regionali
// base (Sicilia/Sardegna/Calabria) NON lo coprono: lì il corriere può ancora addebitare la disagiata
// (es. Villasmundo risolve "Sicilia" base 5,64 ma costa 13,60).
export const zonaCopreDisagiata = (z: string | undefined | null): boolean =>
  !!z && (isZonaDisagiata(z) || /isol/i.test(String(z)))

// SpediamoPro: il supplemento di destinazione disagiata/isola minore vale 8,00–9,10 €; la Sicilia/Sardegna base
// 1,10–1,30 €. Da 3 € in su è una destinazione speciale.
export const SOGLIA_SUPPLEMENTO_SPECIALE_CENT = 300

export function messaggioDestinazioneSpeciale(dove: string): string {
  return `Destinazione periferica/isola (${dove}): questo contratto non la prezza come zona speciale e verrebbe venduta a tariffa pianura sotto costo. Scegli un altro corriere che copre questa destinazione.`
}

// Vendita da una zona normale: è l'unico caso in cui il supplemento del corriere resterebbe scoperto.
// Senza zona (non si è riusciti a prezzare) la decisione resta a chi ha già fermato la spedizione prima.
export function venditaDaZonaNormale(zona: string | undefined | null): boolean {
  return !!zona && !zonaCopreDisagiata(zona)
}

// DVA dice da solo se la destinazione è periferica/disagiata: true SOLO sulle periferiche vere (18–46 €),
// non sulla Sicilia/Sardegna base (flag false).
export function dvaDiceSpeciale(offerta: any): boolean {
  return !!(offerta?.flag_localitaperiferica || offerta?.flag_localitadisagiata)
}

// Spedisci dice la zona che assegna alla destinazione (es. "ZONE DISAGIATE", "ISOLE", "PERIFERICHE").
export function spedisciDiceSpeciale(rate: any): boolean {
  return /disagiat|periferic|isol/i.test(String(rate?.zone_name || ''))
}

// SpediamoPro: accessoryServicePrice contiene ANCHE contrassegno e assicurazione. Se ce n'è uno, il supplemento
// di destinazione si isola con un preventivo pulito. Se il preventivo pulito non riesce non si blocca (prudente).
export async function spediamoproDiceSpeciale(
  quotation: any,
  conAccessori: boolean,
  preventivoPulito: () => Promise<any>,
): Promise<boolean> {
  const supplemento = (q: any) => Number(q?.priceBreakdown?.accessoryServicePrice) || 0
  if (supplemento(quotation) < SOGLIA_SUPPLEMENTO_SPECIALE_CENT) return false
  if (!conAccessori) return true
  try { return supplemento(await preventivoPulito()) >= SOGLIA_SUPPLEMENTO_SPECIALE_CENT }
  catch { return false }
}
