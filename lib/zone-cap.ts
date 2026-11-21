// I CAP DELLE ZONE DI UN LISTINO IN UNA LETTURA SOLA (funzione del database zone_cap_di_zone).
//
// Prima si leggevano a blocchi da 1.000 righe con OFFSET: per un master reale ~19.000 CAP, ~20 blocchi, e
// ogni blocco riordinava tutte le righe delle zone per saltare quelle gia' lette (168 ms a blocco, 236.000
// letture dal 04/11 al 19/11, il 5,4% di tutto il tempo del database). Era l'attesa dell'anteprima prezzi
// del cliente e dei calcolatori dell'elenco e dei report.
// La funzione restituisce le stesse righe, nello stesso ordine (id) e con lo stesso filtro sui CAP da
// prezzare, in una risposta sola. Gira con i permessi di chi chiama: col client della sessione l'utente
// vede solo i CAP che la regola di zone_cap gli mostrava gia'.

// I CAP da prezzare diventano un filtro (piu' le righe senza CAP e il jolly '*', che il match usa quando il
// CAP esatto non c'e'). Senza elenco — o con troppi CAP, es. un report su tutto il mese — si leggono tutte
// le righe delle zone: meglio una lettura grossa che mille piccole.
export function capMirati(cap?: string[] | null): string[] | null {
  const grezzi = (cap || []).map(c => String(c || '').trim())
  const lista = Array.from(new Set(grezzi.filter(c => /^[A-Za-z0-9-]{1,10}$/.test(c))))
  // CAP portoghesi: anche il prefisso di 4 cifre, su cui le zone PT possono essere scritte (vedi
  // capPrefissoZona in zone-match: stessa forma, spazio compreso). Le righe di altri paesi lette in
  // piu' le scarta il match, che filtra per paese.
  for (const c of grezzi) { const m = /^(\d{4})[-\s]?\d{3}$/.exec(c); if (m && !lista.includes(m[1])) lista.push(m[1]) }
  if (!lista.length || lista.length > 200) return null
  return lista
}

// Righe { zona_id, paese, provincia, cap, citta } delle zone date, in ordine di id.
// Per i PREZZI una lettura non riuscita da' una lista vuota, come la lettura a pagine di prima (fetchAll):
// il calcolatore resta senza zona e il prezzo di ripiego manca, come prima. Si scrive nei log.
// `stretto`: dove dai CAP letti si decide cosa CANCELLARE o riscrivere (copia del listino ai sotto-master),
// una lettura non riuscita deve fermare tutto: "non sono riuscito a leggere" non vale "non ci sono CAP".
export async function leggiZoneCap(db: any, zonaIds: string[], capDaPrezzare?: string[] | null, opz: { stretto?: boolean } = {}): Promise<any[]> {
  if (!zonaIds.length) return []
  const { data, error } = await db.rpc('zone_cap_di_zone', { p_zone: zonaIds, p_cap: capMirati(capDaPrezzare) })
  if (error || !Array.isArray(data)) {
    const msg = error?.message || 'risposta non valida'
    if (opz.stretto) throw new Error('CAP delle zone non letti: ' + msg)
    console.error('[ZONE_CAP] lettura non riuscita:', msg)
    return []
  }
  return data
}
