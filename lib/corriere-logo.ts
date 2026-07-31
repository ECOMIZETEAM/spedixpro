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

// NOME del vettore da mostrare a schermo, ricavato dal nome del contratto.
// Da usare ovunque compaia la voce "Vettore": il campo corrieri.tipo NON va mai stampato, perche'
// contiene il provider tecnico ('spediamopro', 'spedisci') che l'utente non deve vedere.
// Se il contratto non contiene un marchio riconosciuto si ripiega sul nome del contratto stesso,
// che e' comunque roba nostra e non nomina il provider.
const MARCHI: string[] = [
  'POSTE', 'SDA', 'GLS', 'BRT', 'TNT', 'DHL', 'FEDEX', 'UPS', 'HERMES', 'NEXIVE',
  'LICCARDI', 'SAILPOST', 'BDM', 'NSSA', 'HR PARCEL', 'HRP', 'PALLETWAYS',
  'CORREOS', 'INPOST', 'SPRING', 'PAACK', 'SPEEDY', 'AMAZON', 'CTT', 'AIPACK', 'ALT', 'GTECH',
]
export function marchioCorriere(nomeContratto: string): string {
  const nome = (nomeContratto || '').trim()
  const n = nome.toUpperCase()
  for (const m of MARCHI) { if (n.includes(m)) return m === 'POSTE' ? 'Poste' : m }
  return nome
}

// Elenco UNICO dei provider tecnici a valle. Serve alle schermate che mostrano il tipo del
// contratto solo quando e' un'etichetta innocua (es. 'generico'): il tipo di un provider vero
// non va mai stampato. Tenerlo in un posto solo evita che l'aggiunta del prossimo provider
// ricrei la fuga in tre pagine diverse — e' esattamente com'e' successo aggiungendo il terzo.
export const PROVIDER_TECNICI = ['spediamopro', 'spedisci', 'easyparcel']
export function isProviderTecnico(tipo?: string | null): boolean {
  return PROVIDER_TECNICI.includes(String(tipo || '').toLowerCase())
}

// SIGLA NEUTRA da mandare al browser al posto del tipo del contratto. Il tipo e' il nome del
// sistema tecnico a valle e non deve uscire da qui: non basta non stamparlo a schermo, perche'
// chiunque apra gli strumenti per sviluppatori legge la risposta JSON. Le pagine mostrano gia'
// queste sigle, quindi il comportamento non cambia — cambia solo cosa viaggia sulla rete.
const SIGLA: Record<string, string> = { spediamopro: 'SP', spedisci: 'SO', easyparcel: 'DVA' }
export function siglaContratto(tipo?: string | null): string {
  const t = String(tipo || '').toLowerCase()
  return SIGLA[t] || t
}
