// I GIORNI IN CUI SI PUO' PRENOTARE UN RITIRO: dal lunedi' al venerdi', festivi nazionali esclusi.
//
// Calcolati, non scritti in una lista da aggiornare ogni anno: le date fisse piu' la Pasquetta, che cade il lunedi'
// dopo Pasqua e cambia ogni anno. I santi patroni sono locali e qui non ci sono: dove un corriere non ritira, lo dice
// la sua risposta alla prenotazione. Il modulo di oggi blocca solo sabato e domenica; il calendario della pagina
// nuova (20/11/2026, Lorenzo: «non sarebbe meglio un calendario?») spegne anche i festivi.

// Le date fisse della Repubblica, come mese-giorno.
const FESTIVI_FISSI = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26']

// La domenica di Pasqua (calendario gregoriano, algoritmo di Meeus/Jones/Butcher).
export function pasqua(anno: number): Date {
  const a = anno % 19, b = Math.floor(anno / 100), c = anno % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return new Date(anno, Math.floor(n / 31) - 1, (n % 31) + 1)
}

// La data come la scrive il campo «date» del browser (AAAA-MM-GG), nell'ora LOCALE: toISOString porterebbe in UTC e
// a mezzanotte italiana darebbe il giorno prima.
export function isoGiorno(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const cache = new Map<number, Set<string>>()
export function festiviNazionali(anno: number): Set<string> {
  let s = cache.get(anno)
  if (!s) {
    s = new Set(FESTIVI_FISSI.map(md => `${anno}-${md}`))
    const lunedi = pasqua(anno)
    lunedi.setDate(lunedi.getDate() + 1)
    s.add(isoGiorno(lunedi))
    cache.set(anno, s)
  }
  return s
}

export function eFestivo(d: Date): boolean { return festiviNazionali(d.getFullYear()).has(isoGiorno(d)) }

export function giornoDiRitiro(d: Date): boolean {
  const g = d.getDay()
  return g !== 0 && g !== 6 && !eFestivo(d)
}

// Il primo giorno utile a partire da `da` compreso: oggi se si puo', se no il primo lavorativo dopo.
export function primoGiornoDiRitiro(da: Date): Date {
  const d = new Date(da.getFullYear(), da.getMonth(), da.getDate())
  for (let i = 0; i < 15 && !giornoDiRitiro(d); i++) d.setDate(d.getDate() + 1)
  return d
}
