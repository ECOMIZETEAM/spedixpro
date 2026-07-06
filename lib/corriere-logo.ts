// Restituisce il path del logo del corriere in base al nome del contratto (brand),
// NON al provider tecnico (spedisci/spediamopro) che non deve mai essere mostrato all'utente.
// I loghi sono in /public/corrieri/<file>.png
export function logoCorriere(nomeContratto: string): string | null {
  const n = (nomeContratto || '').toUpperCase()
  const regole: [string, string][] = [
    ['DELIVERY BUSINESS', 'poste_delivery_business'], ['POSTE', 'poste_delivery_business'],
    ['SDA', 'sda'], ['GLS', 'gls'], ['BRT', 'brt'], ['TNT', 'tnt'],
    ['DHL ECONNECT', 'dhl_econnect'], ['ECONNECT', 'dhl_econnect'], ['DHL', 'dhl'],
    ['FEDEX', 'fedex'], ['UPS', 'ups'], ['HERMES', 'hermes'], ['NEXIVE', 'nexive'],
    ['LICCARDI', 'liccardi'], ['SAILPOST', 'sailpost'], ['BDM', 'bdm'], ['NSSA', 'nssa'],
    ['HR PARCEL', 'hrp'], ['HRP', 'hrp'], ['PALLETWAYS', 'palletways'],
    ['CORREOS EXPRESS', 'correos_express'], ['CORREOS', 'correos'],
    ['INPOST', 'inpost'], ['SPRING', 'spring'], ['PAACK', 'paack'], ['SPEEDY', 'speedy'],
    ['AMAZON', 'amazon_shipping'], ['CTT', 'ctt_express'], ['AIPACK', 'aipack'], ['ALT', 'alt'],
    ['GTECH', 'gtechgroup'],
  ]
  for (const [chiave, file] of regole) { if (n.includes(chiave)) return `/corrieri/${file}.png` }
  return null
}
