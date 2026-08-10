// Nome paese -> codice ISO2. I file dei marketplace (Temu ha l'export tutto in italiano, ma capita
// anche l'inglese) scrivono il paese PER ESTESO ("Italia", "Italy") invece del codice ISO. Senza
// tradurlo, il motore prezzi lo prende per ESTERO e non trova tariffa ("Nessuna tariffa disponibile
// per spedizioni verso ITALY"): la zona "IT" ha i CAP con paese='IT', non 'ITALY'.
// Un codice gia' ISO2 passa invariato; un nome noto (it/en) diventa il codice; un valore ignoto
// resta com'e' (maiuscolo) cosi' l'estero legittimo continua a funzionare.
const NOMI_PAESE: Record<string, string> = {
  ITALIA: 'IT', ITALY: 'IT',
  GERMANIA: 'DE', GERMANY: 'DE', DEUTSCHLAND: 'DE',
  FRANCIA: 'FR', FRANCE: 'FR',
  SPAGNA: 'ES', SPAIN: 'ES', ESPANA: 'ES', 'ESPAÑA': 'ES',
  BELGIO: 'BE', BELGIUM: 'BE', BELGIQUE: 'BE',
  IRLANDA: 'IE', IRELAND: 'IE',
  DANIMARCA: 'DK', DENMARK: 'DK',
  LUSSEMBURGO: 'LU', LUXEMBOURG: 'LU',
  MONACO: 'MC',
  'PAESI BASSI': 'NL', NETHERLANDS: 'NL', HOLLAND: 'NL', OLANDA: 'NL', NEDERLAND: 'NL',
  PORTOGALLO: 'PT', PORTUGAL: 'PT',
  AUSTRIA: 'AT', OSTERREICH: 'AT',
  FINLANDIA: 'FI', FINLAND: 'FI',
  SVEZIA: 'SE', SWEDEN: 'SE',
  SLOVENIA: 'SI',
  'REP. CECA': 'CZ', 'REPUBBLICA CECA': 'CZ', 'CZECH REPUBLIC': 'CZ', CZECHIA: 'CZ',
  CROAZIA: 'HR', CROATIA: 'HR',
  GRECIA: 'GR', GREECE: 'GR',
  POLONIA: 'PL', POLAND: 'PL',
  SLOVACCHIA: 'SK', SLOVAKIA: 'SK',
  UNGHERIA: 'HU', HUNGARY: 'HU',
  BULGARIA: 'BG',
  ESTONIA: 'EE',
  LETTONIA: 'LV', LATVIA: 'LV',
  LITUANIA: 'LT', LITHUANIA: 'LT',
  ROMANIA: 'RO',
  'REGNO UNITO': 'GB', 'UNITED KINGDOM': 'GB', UK: 'GB', 'GREAT BRITAIN': 'GB', INGHILTERRA: 'GB', ENGLAND: 'GB',
  SVIZZERA: 'CH', SWITZERLAND: 'CH', SUISSE: 'CH', SCHWEIZ: 'CH',
}

// Ritorna sempre un codice ISO2 in maiuscolo. Vuoto -> 'IT' (default nazionale, come nei chiamanti).
export function normalizzaPaese(v: any): string {
  const s = String(v ?? '').trim().toUpperCase()
  if (!s) return 'IT'
  if (NOMI_PAESE[s]) return NOMI_PAESE[s]
  return s   // gia' un codice (ISO2) o un valore ignoto: lasciato com'e'
}
