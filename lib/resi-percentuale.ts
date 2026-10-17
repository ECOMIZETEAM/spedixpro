// LA PERCENTUALE RESI DI UN CLIENTE E IL SUO COLORE — una regola sola, per la dashboard del master, la
// sezione Analisi resi, la dashboard e la sezione Resi del cliente.
//
// Regole di Lorenzo (17/10/2026): il controllo serve a vedere per tempo un cliente che truffa o che sta
// per fallire. Sotto l'8% e' normale; dall'8 al 10% giallo; sopra il 10% e fino al 20% arancione; oltre
// il 20% rosso. Si colora solo da 20 spedizioni in su: con poche spedizioni la percentuale non dice niente
// (1 reso su 2 = 50%), e si mostra in grigio con "pochi dati".
// Il conteggio (cosa e' un reso, quali spedizioni contano) sta nel database: resi_per_cliente_v2.
//
// File senza import del server: lo usano anche le pagine.

export const RESI_MIN_SPEDIZIONI = 20
export const RESI_SOGLIA_GIALLO = 8
export const RESI_SOGLIA_ARANCIONE = 10
export const RESI_SOGLIA_ROSSO = 20
export const RESI_PERIODI = [30, 90, 180] as const
export type PeriodoResi = typeof RESI_PERIODI[number]

export type LivelloResi = 'pochi' | 'ok' | 'giallo' | 'arancione' | 'rosso'

export function livelloResi(partite: number, resi: number): { pct: number; livello: LivelloResi } {
  const p = Number(partite) || 0, r = Number(resi) || 0
  const pct = p > 0 ? Math.round((r / p) * 1000) / 10 : 0
  if (p < RESI_MIN_SPEDIZIONI) return { pct, livello: 'pochi' }
  if (pct > RESI_SOGLIA_ROSSO) return { pct, livello: 'rosso' }
  if (pct > RESI_SOGLIA_ARANCIONE) return { pct, livello: 'arancione' }
  if (pct >= RESI_SOGLIA_GIALLO) return { pct, livello: 'giallo' }
  return { pct, livello: 'ok' }
}

// Ordine di gravita', per mettere in cima i casi peggiori.
export const GRAVITA: Record<LivelloResi, number> = { rosso: 4, arancione: 3, giallo: 2, ok: 1, pochi: 0 }

export const COLORI_RESI: Record<LivelloResi, { bg: string; bd: string; fg: string; etichetta: string }> = {
  ok:        { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#15803d', etichetta: 'Nella norma' },
  giallo:    { bg: '#fefce8', bd: '#fde047', fg: '#a16207', etichetta: 'Da tenere d’occhio' },
  arancione: { bg: '#fff7ed', bd: '#fdba74', fg: '#c2410c', etichetta: 'Alto' },
  rosso:     { bg: '#fef2f2', bd: '#fca5a5', fg: '#b91c1c', etichetta: 'Molto alto' },
  pochi:     { bg: '#f3f4f6', bd: '#e5e7eb', fg: '#6b7280', etichetta: 'Pochi dati' },
}

export function testoSoglie(): string {
  return `Sotto l'${RESI_SOGLIA_GIALLO}% nella norma · ${RESI_SOGLIA_GIALLO}–${RESI_SOGLIA_ARANCIONE}% giallo · oltre ${RESI_SOGLIA_ARANCIONE}% arancione · oltre ${RESI_SOGLIA_ROSSO}% rosso. Colorato da ${RESI_MIN_SPEDIZIONI} spedizioni in su.`
}

export function periodoValido(v: any, predefinito: PeriodoResi = 90): PeriodoResi {
  const n = Number(v)
  return (RESI_PERIODI as readonly number[]).includes(n) ? (n as PeriodoResi) : predefinito
}
