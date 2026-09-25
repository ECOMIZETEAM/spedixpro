// QUANTI FILTRI HO MESSO, E QUALI: si deve vedere a colpo d'occhio.
//
// Un filtro e' "toccato" quando il suo valore e' DIVERSO da quello di partenza della pagina (il suo
// FILTRI_DEFAULT), non quando e' semplicemente pieno: la data parte sempre valorizzata (ultimi 30
// giorni) e finche' resta quella non e' una scelta di chi guarda, e' il default.
//
// `dal` e `al` contano come UN filtro solo ('data'): sono un intervallo con un controllo solo, e
// dirne due farebbe un numero che non corrisponde a quello che l'utente ha toccato.
//
// La regola sta qui, non nelle pagine: elenco spedizioni (master, cliente, agente), distinte,
// contrassegni e le altre liste devono contare e colorare allo stesso modo.

export const GRUPPI_FILTRI: Record<string, string[]> = { data: ['dal', 'al'] }
// Ordinamento e direzione non sono filtri: non tolgono righe, le mettono in un altro ordine.
export const IGNORA_FILTRI = ['ordina', 'dir']

export function filtriToccati(
  filtri: Record<string, any>,
  predefiniti: Record<string, any>,
  opt: { ignora?: string[]; gruppi?: Record<string, string[]> } = {},
): Set<string> {
  const ignora = opt.ignora ?? IGNORA_FILTRI
  const gruppi = opt.gruppi ?? GRUPPI_FILTRI
  const diGruppo = new Map<string, string>()
  for (const [nome, chiavi] of Object.entries(gruppi)) for (const k of chiavi) diGruppo.set(k, nome)

  const toccati = new Set<string>()
  for (const k of Object.keys({ ...predefiniti, ...filtri })) {
    if (ignora.includes(k)) continue
    const v = filtri?.[k] ?? ''
    const d = predefiniti?.[k] ?? ''
    if (String(v) !== String(d)) toccati.add(diGruppo.get(k) || k)
  }
  return toccati
}

// Il campo toccato si accende: bordo e sfondo arancione (lo stesso arancione del portale), cosi' fra
// dodici caselle grigie si vede subito quali sono quelle che stanno filtrando.
export function stileFiltro<T extends Record<string, any>>(base: T, attivo: boolean) {
  if (!attivo) return base
  return { ...base, border: '1px solid #f97316', background: '#fff7ed', color: '#9a3412', fontWeight: 600 as const }
}
