// Carica TUTTE le righe di una query PostgREST a blocchi da 1000 (il DB tronca a 1000/query).
// `build()` deve restituire una query NUOVA ad ogni chiamata, SENZA .range()/.limit() applicati.
// Nessun limite pratico: si ferma solo quando i dati finiscono. `max` è solo un backstop anti-loop.
export async function fetchAll<T = any>(build: () => any, max = 500000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error || !data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}
