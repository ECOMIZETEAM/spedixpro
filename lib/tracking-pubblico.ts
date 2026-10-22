// GLI EVENTI COME LI LEGGE IL DESTINATARIO.
//
// La pagina pubblica di tracciamento mostrava le righe di tracking_events così come arrivano dai corrieri,
// e il 22/10/2026 se ne sono viste tre storture, misurate su 30 giorni (2.093.065 eventi):
//  - 30.969 volte «LA SPEDIZIONE E' STATA GENERATA DA KSYNC»: il nome di uno strumento nostro, che a chi
//    aspetta il pacco non deve arrivare (la rotta promette: MAI il nome tecnico di chi sta dietro);
//  - 166.087 eventi BRT del tipo «Presso filiale ROMA CASILINO (109) è stato registrato il seguente evento:
//    CONFERMA RITIRO», con il luogo dentro la frase e la colonna luogo vuota;
//  - 159.784 frasi tutte in maiuscolo, e luoghi come «SDA Bologna [BLOCCO 13.5]» col reparto interno.
// Qui si riscrive SOLO ciò che si mostra: tracking_events resta com'è, perché lo leggono gli stati, le
// giacenze e la cronologia del portale.

const BRT_VERBOSO = /^Presso filiale\s*(.*?)\s*\(\s*\d*\s*\)\s*è stato registrato il seguente evento:\s*/i
const SIGLE: Record<string, string> = { brt: 'BRT', sda: 'SDA', gls: 'GLS', ups: 'UPS', dhl: 'DHL', tnt: 'TNT', fedex: 'FedEx', ldv: 'LDV', pin: 'PIN', cap: 'CAP' }

const tuttoMaiuscolo = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase()

function frase(s: string): string {
  const t = s.toLowerCase()
    .replace(/\be'(?=\s|$)/g, 'è')
    .replace(/\b(brt|sda|gls|ups|dhl|tnt|fedex|ldv|pin|cap)\b/g, (m) => SIGLE[m] || m)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// «ROMA CASILINO» → «Roma Casilino», «CATANIA (CT)» → «Catania (CT)»: la sigla della provincia resta.
export function luogoLeggibile(s: string): string {
  const pulito = s.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (!tuttoMaiuscolo(pulito)) return pulito
  return pulito.toLowerCase().replace(/(^|[\s'-])([a-zà-ù])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\(([a-z]{2})\)/gi, (_, p) => `(${p.toUpperCase()})`)
}

export function eventoPubblico(descrizione: string | null, luogo: string | null): { descrizione: string; luogo: string } {
  let d = String(descrizione || '').trim()
  let l = String(luogo || '').trim()
  const brt = d.match(BRT_VERBOSO)
  if (brt) {
    d = d.slice(brt[0].length).trim()
    if (!l && brt[1]) l = brt[1]
  }
  if (/generata da ksync/i.test(d)) d = 'Spedizione registrata dal mittente'
  if (/ksync/i.test(l)) l = ''
  if (tuttoMaiuscolo(d)) d = frase(d)
  else {
    // «CONFERMA MANCATO RITIRO: causale: Il destinatario...»: solo il titolo in maiuscolo.
    const titolo = d.match(/^([^:a-z]{4,}):/)
    if (titolo && tuttoMaiuscolo(titolo[1])) d = frase(titolo[1]) + d.slice(titolo[1].length)
    if (d) d = d.charAt(0).toUpperCase() + d.slice(1)
  }
  return { descrizione: d || 'Aggiornamento', luogo: l ? luogoLeggibile(l) : '' }
}

// Il colore del marchio del master, se è un esadecimale pulito: entra in uno stile, non si fida del resto.
export function colorePubblico(c: unknown): string | null {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : null
}
