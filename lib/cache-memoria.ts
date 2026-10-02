// Cache in-memory con TTL per i calcoli PESANTI e read-only delle Statistiche (le RPC calderone/corrieri/
// contrassegni girano in qualche secondo sul super-master). È per-istanza serverless (non condivisa fra
// istanze, si svuota al cold start) e con TTL breve: le statistiche non devono essere al secondo, e un
// dato vecchio di <60s è accettabile. NON usarla per prezzi/credito (lì serve il dato vivo).
//
// Chiave: includi SEMPRE il master e il periodo, così due master o due intervalli non si mescolano.
const store = new Map<string, { t: number; v: any }>()

export async function conCache<T>(chiave: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(chiave)
  if (hit && now - hit.t < ttlMs) return hit.v as T
  const v = await fn()
  store.set(chiave, { t: now, v })
  // Pulizia leggera per non crescere all'infinito.
  if (store.size > 500) for (const [k, e] of store) if (now - e.t > ttlMs) store.delete(k)
  return v
}

// Helper condiviso: il calderone di un master per un periodo, cache 60s. Lo usano Report Guadagno,
// Clienti e Fatturazione: una sola computazione serve tutte e tre per lo stesso (master, dal, al).
export async function calderoneCache(admin: any, master: string, dalISO: string, alISO: string): Promise<any> {
  return conCache(`cald:${master}:${dalISO}:${alISO}`, 60_000, async () => {
    const { data, error } = await admin.rpc('calderone_dettaglio_v2', { p_master: master, p_dal: dalISO, p_al: alISO })
    if (error) throw new Error(error.message)
    return data || {}
  })
}
