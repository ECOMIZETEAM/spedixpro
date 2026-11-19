// IL GIORNO DEL RITIRO, QUANDO IL CORRIERE DICE "OGGI NO".
//
// Le pagine propongono OGGI come data del ritiro, e ogni corriere ha le sue regole sul ritiro in
// giornata: Spedisci.online lo rifiuta con frasi che cambiano nel tempo, SpediamoPro solo dopo le
// 11:55, KSync (SDA EXPRESS L) dopo mezzogiorno e in molte zone sempre (17/11/2026, ultimi 5 giorni:
// Catania 58 rifiuti su 69, Agrigento 13 su 13, Lecce 11 su 11; Roma 2 su 85). Il ritiro del giorno
// dopo invece passa quasi sempre (10 rifiuti su oltre 1.700). Riprovare il primo giorno lavorativo
// utile, e dirlo, e' meglio che lasciare il pacco dal mittente con un errore in pagina.
// Le frasi stanno qui, e non in ogni porta, perche' le porte che prenotano sono tre (ritiro dal
// portale, /api/v1/pickups, creazione via API) e la prossima frase nuova va aggiunta una volta sola.

// Oggi nel fuso italiano: il server gira in UTC e tra mezzanotte e le 2 l'UTC e' ancora ieri.
export function oggiRoma(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
}

// Il primo giorno lavorativo (lun-ven) dopo `data` (AAAA-MM-GG).
export function prossimoGiornoLavorativo(data: string): string {
  const d = new Date(String(data) + 'T12:00:00Z')
  do { d.setUTCDate(d.getUTCDate() + 1) } while ([0, 6].includes(d.getUTCDay()))
  return d.toISOString().slice(0, 10)
}

// "La prima data utile è 18/11/2026": quando il corriere la scrive, vale piu' di qualsiasi calcolo
// nostro (sa lui in che giorni passa da quella zona).
export function primaDataUtile(testo: string): string | null {
  const m = String(testo || '').match(/prima data utile[^0-9]{0,10}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

// Il corriere rifiuta il ritiro in giornata. Ogni frase e' stata vista davvero nei log:
//   "PICKUP_DATE = today is no longer possible", "Time slot not compatible with today's date",
//   "...ritiro nella mattina stessa", "Non è possibile effettuare un ritiro per la stessa giornata",
//   "Same-day pickup must be requested before 11:55", "Same-day pickup is not available".
export function ritiroInGiornataRifiutato(testo: string): boolean {
  return /PICKUP_DATE\s*=\s*today|time slot not compatible with today|nella mattina stessa|per la stessa giornata|same-day pickup/i.test(String(testo || ''))
}

// La data da riprovare dopo un rifiuto, o null se il rifiuto non riguarda la data.
export function dataDaRiprovare(testo: string, dataChiesta: string): string | null {
  const indicata = primaDataUtile(testo)
  if (indicata && indicata > dataChiesta) return indicata
  if (ritiroInGiornataRifiutato(testo)) return prossimoGiornoLavorativo(dataChiesta)
  return null
}

// Cosa dire a chi ha chiesto il ritiro quando la data e' cambiata.
export function avvisoDataSpostata(dataChiesta: string, dataFinale: string): string | null {
  if (!dataFinale || dataFinale === dataChiesta) return null
  const it = (d: string) => d.split('-').reverse().join('/')
  return `Il corriere non accetta il ritiro per il ${it(dataChiesta)}: ritiro prenotato per il ${it(dataFinale)}, il primo giorno utile.`
}
