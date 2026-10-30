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

// Servizi accessori NATIVI proposti come DEFAULT nel listino, DIVERSI per marca del corriere: SDA ha i
// suoi, Poste altri, GLS altri. Il master ne decide il prezzo (Prezzo € + % del valore) e li vende. Per
// le marche non elencate qui nessun default: il master aggiunge le voci a mano. ATTENZIONE: questa è la
// lista di ciò che il master può VENDERE, NON la lista di ciò che l'API sa trasmettere al corriere — la
// trasmissione dipende dal provider (oggi solo alcuni, es. DVA per contante/assegno e consegna su
// appuntamento; per gli altri il servizio va gestito col corriere fuori dall'API).
const SERVIZI_ACCESSORI_MARCA: Record<string, { nome: string; prezzo: number; perc: number }[]> = {
  Poste: [
    { nome: 'Reverse A Domicilio', prezzo: 0, perc: 0 },
    { nome: 'Andata & Ritorno', prezzo: 0, perc: 0 },
    { nome: 'Reverse PuntoPoste', prezzo: 0, perc: 0 },
    { nome: 'Reverse PuntoPoste Locker', prezzo: 0, perc: 0 },
    { nome: 'Reverse Ufficio Postale', prezzo: 0, perc: 0 },
    { nome: 'Consegna su appuntamento', prezzo: 0, perc: 0 },
  ],
  // GLS: solo i servizi che si trasmettono col codice GIUSTO (mappa nome→codice in lib/gls). Dal 30/10/2026
  // resta solo l'Exchange: Sabato, Preavviso, Appuntamento, Consegna al piano, Ident e Return partivano con
  // codici che su GLS attivavano un altro servizio (es. il Sabato mandava il 23 = document return).
  GLS: [
    { nome: 'Exchange', prezzo: 0, perc: 0 },                 // 24
  ],
  SDA: [
    { nome: 'Time Definite ore 10', prezzo: 0, perc: 0 },
  ],
  // BRT: i servizi TRASMISSIBILI via API (doc BRT REST). Priority/10:30 = serviceType E/H. (Fresh/B20 tolto
  // su richiesta di Lorenzo: vuole la data scadenza + catena freddo, non lo offriamo. Il RESO sta nelle Giacenze.)
  BRT: [
    { nome: 'Consegna Priority', prezzo: 0, perc: 0 },
    { nome: 'Consegna 10:30', prezzo: 0, perc: 0 },
  ],
}
// I CANALI DIRETTI che trasmettono il servizio con i codici del CORRIERE: gls → tag ServiziAccessori
// (codici GLS), brt → serviceType. Mappa nome→codice in lib/gls / lib/brt.
const CANALI_TRASMETTONO_SERVIZI = new Set(['gls', 'brt'])

// ── SERVIZI ACCESSORI VIA SPEDISCI.ONLINE (rivenditore) ──────────────────────
// Sui contratti 'spedisci' i codici NON sono quelli GLS diretti: sono i CODICI PROPRI di spedisci,
// quelli che tornano nella risposta /shipping/rates (campo `services`, es. {"200001":"Exchange"}).
// spedisci li traduce lui verso il corriere (200001 → GLS 24 sull'etichetta). PROVATO con create+delete
// reali il 3/9: il commento storico "spedisci manda accessoriServices vuoto" era una NOSTRA scelta, non
// un limite di spedisci — il campo esiste e funziona.
// ATTIVI ORA: Exchange + Saturday (provati puliti). DA ATTIVARE dopo una consegna di prova: Document
// Return (200002, codice etichetta anomalo), Preavviso (200005, codice anomalo), Express12 (200004,
// no-op sui contratti Light).
const SERVIZI_SPEDISCI_GLS: { nome: string; prezzo: number; perc: number }[] = [
  { nome: 'Exchange', prezzo: 0, perc: 0 },
  { nome: 'Saturday Service', prezzo: 0, perc: 0 },
]
// NOME del servizio (come sta a listino/nel form) → CODICE spedisci da mandare in accessoriServices
// alla CREAZIONE su un contratto 'spedisci'. null se non è fra quelli attivi/trasmissibili via spedisci.
export function codiceServizioSpedisci(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (/exchange|cambio/.test(n)) return '200001'
  if (/sabato|saturday/.test(n)) return '200003'
  // (dopo, con calma, ognuno dietro una consegna di prova vera):
  // if (/document\s*return/.test(n)) return '200002'
  // if (/preavviso/.test(n)) return '200005'
  // if (/express\s*12/.test(n)) return '200004'   // NB: no-op sui contratti Light
  return null
}

// Servizi accessori proposti come DEFAULT nel listino, diversi per canale/marca. Il `tipo` è il canale
// tecnico del contratto (corrieri.tipo). Retro-compatibile: senza `tipo` si ripiega sul comportamento
// per marca di prima.
export function serviziAccessoriDefault(nomeContratto?: string | null, tipo?: string | null): { nome: string; prezzo: number; perc: number }[] {
  const t = tipo == null ? null : String(tipo).toLowerCase()
  const marca = marchioCorriere(nomeContratto || '')
  // Rivenditore spedisci di marca GLS: SOLO i servizi che spedisci sa trasmettere davvero (provati),
  // mandati a creazione con codiceServizioSpedisci. Gli altri contratti spedisci (Poste/SDA) non li hanno.
  if (t === 'spedisci') return marca === 'GLS' ? SERVIZI_SPEDISCI_GLS.map(s => ({ ...s })) : []
  // Altri canali non-diretti (DVA/SpediamoPro): l'API non espone i codici servizio → niente default.
  if (t != null && !CANALI_TRASMETTONO_SERVIZI.has(t)) return []
  // Contratti DIRETTI (gls/brt) o chiamante senza tipo: default per MARCA.
  return (SERVIZI_ACCESSORI_MARCA[marca] || []).map(s => ({ ...s }))
}

// Elenco UNICO dei provider tecnici a valle. Serve alle schermate che mostrano il tipo del
// contratto solo quando e' un'etichetta innocua (es. 'generico'): il tipo di un provider vero
// non va mai stampato. Tenerlo in un posto solo evita che l'aggiunta del prossimo provider
// ricrei la fuga in tre pagine diverse — e' esattamente com'e' successo aggiungendo il terzo.
export const PROVIDER_TECNICI = ['spediamopro', 'spedisci', 'easyparcel', 'dielle']
export function isProviderTecnico(tipo?: string | null): boolean {
  return PROVIDER_TECNICI.includes(String(tipo || '').toLowerCase())
}

// I NOMI DEI FORNITORI TECNICI DENTRO UN TESTO LIBERO. Le descrizioni dei movimenti le scrivono anche
// a mano i master ("Addebito rettifiche spedisci.online 10.09.2026", "Trasferimento piattaforma
// spedisci online", "Reso ... (spedisci.online)"): nel database restano come sono — lo storico non
// si riscrive — ma verso clienti e agenti escono senza il nome. Al 15/10/2026 erano 141 righe nei
// Consumabili di 80 clienti e 293 nella loro Lista movimenti.
// NON ci sono "dielle" e "dva", e "spediamo" vale solo con "pro": nelle descrizioni delle spedizioni
// c'e' il destinatario, e "DIELLE SRL", "Dielle Car Tech", "c/o NOI SPEDIAMO" sono clienti veri.
const NOMI_FORNITORI = /\b(?:spedisci[\s.\-]*on[\s\-]*line|spedisci|spediamo[\s\-]*pro|easy[\s\-]*parcel)\b/gi
export function senzaNomiFornitori(testo?: string | null): string {
  if (!testo) return ''
  const t = String(testo)
  const senza = t.replace(NOMI_FORNITORI, '')
  if (senza === t) return t
  return senza
    .replace(/\(\s*\)/g, '')            // "(spedisci.online)" lasciava "()"
    .replace(/\s+([.,;:)])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s·\-–—:,]+$/g, '')
    // "TRASFERIMENTO DA SPEDISCI ON LINE" restava "TRASFERIMENTO DA"
    .replace(/\s+(?:da|dal|dalla|su|sul|sulla|di|del|della|per|in)$/i, '')
    .trim()
}

// SIGLA NEUTRA da mandare al browser al posto del tipo del contratto. Il tipo e' il nome del
// sistema tecnico a valle e non deve uscire da qui: non basta non stamparlo a schermo, perche'
// chiunque apra gli strumenti per sviluppatori legge la risposta JSON. Le pagine mostrano gia'
// queste sigle, quindi il comportamento non cambia — cambia solo cosa viaggia sulla rete.
// 'V' e' la lettera con cui questi contratti sono gia' contrassegnati in Gestione Zone: dice a noi
// di quale canale si tratta senza nominare nessun fornitore, che al cliente non deve arrivare mai.
const SIGLA: Record<string, string> = { spediamopro: 'SP', spedisci: 'SO', easyparcel: 'V', dielle: 'DL' }
export function siglaContratto(tipo?: string | null): string {
  const t = String(tipo || '').toLowerCase()
  return SIGLA[t] || t
}
