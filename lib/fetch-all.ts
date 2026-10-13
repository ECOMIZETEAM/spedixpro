// Carica TUTTE le righe di una query PostgREST a blocchi da 1000 (il DB tronca a 1000/query).
// `build()` deve restituire una query NUOVA ad ogni chiamata, SENZA .range()/.limit() applicati.
// Nessun limite pratico: si ferma solo quando i dati finiscono. `max` è solo un backstop anti-loop.
//
// Prima pagina DA SOLA (nella stragrande maggioranza dei casi ≤1000 righe: una sola query, come
// prima). Se è piena, le pagine successive partono in PARALLELO a gruppi di 4: prima erano tutte
// sequenziali → con le liste grandi (migliaia di righe) si sommavano i round-trip uno dietro
// l'altro. Semantica identica: output in ordine, stop alla prima pagina corta/errore.
//
// `lancia: true` = un blocco non letto e' un ERRORE, non la fine dei dati. Senza, un errore del
// database restituisce [] o un elenco a meta' e chi legge non puo' distinguerlo da "non c'e' altro":
// e' cosi' che un guasto diventava "Nessuna spedizione trovata" (distinte di un cliente, 13/10/2026).
// Opzionale perche' molti chiamanti usano il risultato cosi' com'e': si accende dove l'errore si sa mostrare.
export async function fetchAll<T = any>(build: () => any, max = 500000, opzioni?: { lancia?: boolean }): Promise<T[]> {
  const lancia = !!opzioni?.lancia
  const { data: prima, error: e0 } = await build().range(0, 999)
  if (e0 && lancia) throw new Error('fetchAll: primo blocco non letto: ' + (e0.message || e0))
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
      if (r?.error && lancia) throw new Error('fetchAll: blocco non letto: ' + (r.error.message || r.error))
      if (r?.error) { fine = true; break }
      const rows = (r?.data as T[]) || []
      out.push(...rows)
      if (rows.length < 1000) { fine = true; break }
    }
    if (fine) break
  }
  return out
}

// Come fetchAll, ma una pagina che non si legge LANCIA invece di chiudere l'elenco lì: serve dove un
// elenco incompleto porterebbe a decidere male. La condivisione decide da qui cosa cancellare, e
// "non sono riuscito a leggere" non deve mai valere "non c'è niente".
export async function fetchAllStretto<T = any>(build: () => any, max = 500000): Promise<T[]> {
  const out: T[] = []
  for (let base = 0; base < max; base += 1000) {
    const { data, error } = await build().range(base, base + 999)
    if (error) throw new Error('lettura a pagine non riuscita: ' + error.message)
    const rows = (data as T[]) || []
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}
