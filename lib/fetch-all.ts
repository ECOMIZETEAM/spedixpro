// Carica TUTTE le righe di una query PostgREST a blocchi da 1000 (il DB tronca a 1000/query).
// `build()` deve restituire una query NUOVA ad ogni chiamata, SENZA .range()/.limit() applicati.
// Nessun limite pratico: si ferma solo quando i dati finiscono. `max` è solo un backstop anti-loop.
//
// Prima pagina DA SOLA (nella stragrande maggioranza dei casi ≤1000 righe: una sola query, come
// prima). Se è piena, le pagine successive partono in PARALLELO a gruppi di 4: prima erano tutte
// sequenziali → con le liste grandi (migliaia di righe) si sommavano i round-trip uno dietro
// l'altro. Semantica identica: output in ordine, stop alla prima pagina corta/errore.
export async function fetchAll<T = any>(build: () => any, max = 500000): Promise<T[]> {
  const { data: prima, error: e0 } = await build().range(0, 999)
  if (e0 || !prima?.length) return []
  const out: T[] = [...(prima as T[])]
  if (prima.length < 1000) return out
  const BATCH = 4
  for (let base = 1000; base < max; base += BATCH * 1000) {
    const results = await Promise.all(
      Array.from({ length: BATCH }, (_, k) => build().range(base + k * 1000, base + k * 1000 + 999))
    )
    let fine = false
    for (const r of results) {
      if (r?.error) { fine = true; break }
      const rows = (r?.data as T[]) || []
      out.push(...rows)
      if (rows.length < 1000) { fine = true; break }
    }
    if (fine) break
  }
  return out
}
