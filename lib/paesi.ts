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
  // Nomi nella LINGUA DEL PAESE (i marketplace li usano quando il negozio vende in locale) e altri
  // che mancavano: senza, il valore restava com'era ("POLSKA", "OSTERREICH") e per il motore prezzi
  // era un paese inesistente -> "nessuna tariffa". Misurato il 21/09/2026 su 102 scritture comuni.
  ITALIE: 'IT', ITALIEN: 'IT',
  FRANKREICH: 'FR', ALLEMAGNE: 'DE',
  BELGIE: 'BE',
  POLSKA: 'PL',
  SUOMI: 'FI', SVERIGE: 'SE', DANMARK: 'DK', NORGE: 'NO', NORVEGIA: 'NO', NORWAY: 'NO',
  MALTA: 'MT', CIPRO: 'CY', CYPRUS: 'CY',
  'SAN MARINO': 'SM',
  USA: 'US', 'UNITED STATES': 'US', 'STATI UNITI': 'US', 'UNITED STATES OF AMERICA': 'US',
  CANADA: 'CA',
}

// Ritorna sempre un codice ISO2 in maiuscolo. Vuoto -> 'IT' (default nazionale, come nei chiamanti).
export function normalizzaPaese(v: any): string {
  const s = String(v ?? '').trim().toUpperCase()
  if (!s) return 'IT'
  if (NOMI_PAESE[s]) return NOMI_PAESE[s]
  // Accenti via PRIMA di cercare: "OSTERREICH" era in tabella ma "ÖSTERREICH" no, e cosi' "BELGIË"
  // ed "ESPAÑA" — il paese arrivava dal file con l'accento e restava non tradotto.
  const senzaAccenti = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return NOMI_PAESE[senzaAccenti] || s   // gia' un codice (ISO2) o un valore ignoto: lasciato com'e'
}

// IL FILE NON DICE LA NAZIONE: si prova a leggerla dalla FORMA DEL CAP, ma solo dove non ci sono
// dubbi (lettere o trattino: un CAP italiano e' 5 cifre e basta). Niente ipotesi sui CAP a 4-5 cifre,
// che sono di mezza Europa: li' decide chi importa.
// Serve perche' "nessuna nazione" diventava ITALIA per difetto: due ordini polacchi (60-326 POZNAN,
// 52-317 WROCLAW) sono entrati come italiani, con la provincia cercata fra le sigle IT.
const CAP_PAESE: Array<[RegExp, string]> = [
  [/^\d{2}-\d{3}$/, 'PL'],
  [/^\d{4}-\d{3}$/, 'PT'],
  [/^\d{4}\s?[A-Z]{2}$/i, 'NL'],
  [/^[A-Z]\d{2}\s?[A-Z0-9]{4}$/i, 'IE'],                 // Eircode: H53X058, D02 AF30
  [/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, 'GB'],
  [/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, 'CA'],
  [/^[A-Z]{3}\s?\d{4}$/i, 'MT'],
]

export function paeseDaCap(cap: any): string {
  const c = String(cap ?? '').trim()
  if (!c) return ''
  for (const [re, iso] of CAP_PAESE) if (re.test(c)) return iso
  return ''
}

// Un CAP che potrebbe essere italiano: solo cifre, al massimo cinque (Excel mangia gli zeri davanti,
// quindi anche 142 puo' essere 00142). Tutto il resto italiano non e'.
export function capPuoEssereItaliano(cap: any): boolean {
  return /^\d{1,5}$/.test(String(cap ?? '').replace(/^'/, '').replace(/\s+/g, '').trim())
}
