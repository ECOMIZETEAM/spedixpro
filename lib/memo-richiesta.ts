import { AsyncLocalStorage } from 'node:async_hooks'

// LO STESSO CALCOLO, UNA VOLTA PER RICHIESTA.
// La creazione (e l'API pubblica) costruiscono la catena dei costi due volte con gli STESSI ingressi: prima per
// controllare il credito, poi per gli addebiti. Lo stesso per il piano dei contratti condivisi. Ogni volta mezzo
// secondo di letture, e nei condivisi la spedizione passa da tre o quattro rotte in fila (cronometro [CREA]/[V1]
// [TEMPI], 20/11/2026). Qui il primo risultato si tiene per la durata della richiesta e il secondo lo riusa — ma
// SOLO se la chiave (gli ingressi, campo per campo) e' identica: un ingresso diverso anche di una virgola ricalcola.
//
// Fuori da conMemoRichiesta (ricalcolo rettifiche, giri automatici, qualunque altra rotta) non si tiene niente: ogni
// chiamata calcola come prima. Chi riceve ha sempre una COPIA: se la ritocca (il detentore livellato al costo reale),
// la volta dopo riceve il risultato originale, non il suo ritocco.

const deposito = new AsyncLocalStorage<Map<string, Promise<any>>>()

export function conMemoRichiesta<T>(fn: () => Promise<T>): Promise<T> {
  return deposito.run(new Map(), fn)
}

export async function ricordaNellaRichiesta<T>(chiave: string, calcola: () => Promise<T>): Promise<T> {
  const memoria = deposito.getStore()
  if (!memoria) return calcola()
  let attesa = memoria.get(chiave)
  if (!attesa) {
    attesa = calcola()
    memoria.set(chiave, attesa)
    // Un calcolo fallito non si tiene: chi viene dopo ricalcola, come senza memoria.
    attesa.catch(() => { if (memoria.get(chiave) === attesa) memoria.delete(chiave) })
  }
  return structuredClone(await attesa)
}

// Chiave stabile: stesso contenuto = stessa chiave, qualunque sia l'ordine dei campi. `undefined` resta distinto da
// null e da 0 (JSON.stringify li confonderebbe): un contrassegno assente non e' un contrassegno a zero.
export function chiaveDi(valore: any): string {
  const norm = (x: any): any => {
    if (x === undefined) return { __u: 1 }
    if (x === null || typeof x !== 'object') return typeof x === 'number' && !Number.isFinite(x) ? { __n: String(x) } : x
    if (Array.isArray(x)) return x.map(norm)
    const out: Record<string, any> = {}
    for (const k of Object.keys(x).sort()) out[k] = norm(x[k])
    return out
  }
  return JSON.stringify(norm(valore))
}
