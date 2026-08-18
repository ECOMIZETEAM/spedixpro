// Maggiorazione da applicare ai prezzi peso/zona quando si DUPLICA un listino/contratto.
// Per OGNI fascia kg si può scegliere una PERCENTUALE (%) oppure un VALORE FISSO (€), più un
// default globale per le fasce non specificate. Retro-compatibile con la vecchia "% globale".
// Usata da: /api/listini/costo-in-cliente e /api/listini/duplica-corriere (e chiunque duplichi fasce).

export type MarkupFascia = { mode: 'perc' | 'fisso'; valore: number }
export type MarkupConfig = { default: MarkupFascia | null; perFascia: Record<string, MarkupFascia> }

// Chiave stabile per fascia: tipo ('fino_a'|'oltre') + peso massimo numerico. DEVE combaciare con
// la chiave usata lato UI, altrimenti le sovrascritture per-fascia non aggancerebbero nulla.
export function chiaveFascia(tipo: string, peso_max: unknown): string {
  return `${tipo === 'oltre' ? 'oltre' : 'fino_a'}_${Number(peso_max)}`
}

// Accetta il nuovo formato { default, perFascia } e, in fallback, la vecchia % globale.
export function normalizzaMarkup(markup: any, maggiorazioneLegacy?: unknown): MarkupConfig {
  const def: MarkupFascia | null =
    markup?.default && Number(markup.default.valore)
      ? { mode: markup.default.mode === 'fisso' ? 'fisso' : 'perc', valore: Number(markup.default.valore) }
      : (Number(maggiorazioneLegacy) ? { mode: 'perc', valore: Number(maggiorazioneLegacy) } : null)
  const perFascia: Record<string, MarkupFascia> = {}
  for (const [k, v] of Object.entries((markup?.perFascia || {}) as Record<string, any>)) {
    const val = Number(v?.valore)
    if (v && val) perFascia[k] = { mode: v.mode === 'fisso' ? 'fisso' : 'perc', valore: val }
  }
  return { default: def, perFascia }
}

// Ritorna la funzione che applica la maggiorazione a un prezzo di fascia (arrotonda al centesimo).
export function creaApplicaMarkup(cfg: MarkupConfig): (prezzo: unknown, tipo: string, peso_max: unknown) => number {
  return (prezzo, tipo, peso_max) => {
    const base = Number(prezzo) || 0
    const c = cfg.perFascia[chiaveFascia(tipo, peso_max)] || cfg.default
    if (!c || !c.valore) return base
    const nuovo = c.mode === 'fisso' ? base + c.valore : base * (1 + c.valore / 100)
    return Math.round(nuovo * 100) / 100
  }
}
