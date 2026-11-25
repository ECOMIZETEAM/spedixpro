// QUANDO SI AVVISA per una voce del calendario. Una regola sola per i tre posti che la usano: la campanella
// (/api/notifiche/mie), l'email (giro /api/cron/calendario-avvisi) e l'avviso a calendario aperto. Funzione pura:
// vale sul server e nel browser.
//
// Le voci di «tutto il giorno» partono dalle 9 di quel giorno, non dalla mezzanotte: «il giorno prima» di
// un inventario deve arrivare alle 9 del giorno prima, non alle 0:00 (come fanno i calendari che tutti conoscono).
export const ORA_TUTTO_IL_GIORNO = 9

export function momentoAvviso(e: { inizio: string; avviso_minuti: number | null; tutto_il_giorno: boolean }): Date | null {
  if (e.avviso_minuti == null) return null
  const base = new Date(e.inizio)
  if (isNaN(base.getTime())) return null
  // l'inizio di «tutto il giorno» è la mezzanotte di quel giorno (ora di chi l'ha scritta, cioè di Roma)
  const t = base.getTime() + (e.tutto_il_giorno ? ORA_TUTTO_IL_GIORNO * 3600000 : 0)
  return new Date(t - e.avviso_minuti * 60000)
}

// oltre questo ritardo un avviso non si manda più per email: un promemoria scritto oggi per ieri non deve
// arrivare come se fosse urgente (resta nella campanella e nel calendario)
export const RITARDO_MASSIMO_MIN = 60
