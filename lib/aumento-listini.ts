// AUMENTO IN PERCENTUALE DEI LISTINI CLIENTE — la cifra mostrata in anteprima.
//
// Il prezzo vero lo scrive il database (`applica_aumento_listino`, scripts/aumenti-listino-e-codice-contratto.sql):
// round(prezzo × (1 + X/100), 2), cioe' al centesimo col mezzo centesimo per eccesso (7,10 +5% = 7,455 → 7,46).
// Qui la stessa formula per l'anteprima, e deve dare la STESSA cifra: un'anteprima che dice 7,45 e un
// listino che dice 7,46 e' esattamente la "discrepanza fra visto e salvato" che non deve esistere.
// Si conta in interi: 7,10 × 1,05 in virgola mobile fa 7,454999… e Math.round lo porterebbe a 7,45.
// I prezzi delle fasce hanno al massimo due decimali (colonna numeric(8,2)), la percentuale anche.

export const PERC_MASSIMA = 100

/** Percentuale scritta dal master → numero a due decimali, oppure null se non e' un aumento valido. */
export function leggiPercentuale(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const p = Math.round(n * 100) / 100
  return p > 0 && p <= PERC_MASSIMA ? p : null
}

/** Il prezzo dopo l'aumento, al centesimo. Un prezzo a 0 resta 0 (un aumento in % su zero non e' un aumento). */
export function aumentaPrezzo(prezzo: number, perc: number): number {
  const centesimi = Math.round(Number(prezzo) * 100)
  if (!(centesimi > 0)) return Number(prezzo) || 0
  const centesimiPerc = Math.round(perc * 100)              // 5% → 500, 2,5% → 250
  // centesimi × (10000 + centesimiPerc) / 10000, mezzo per eccesso: tutto in interi esatti.
  const nuovo = Math.floor((centesimi * (10000 + centesimiPerc) + 5000) / 10000)
  return nuovo / 100
}

export const euro = (n: number) => '€ ' + Number(n).toFixed(2).replace('.', ',')
