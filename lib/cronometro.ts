import { AsyncLocalStorage } from 'node:async_hooks'

// IL CRONOMETRO DI UNA RICHIESTA. Misura soltanto: non cambia una risposta, un prezzo o una scrittura.
//
// Perche' (20/11/2026): la creazione di una spedizione dura 9,3 s a meta' dei casi e fino a 29 s nel 5% piu' lento
// (Vercel, 13-20/11), sempre a Londra accanto al database. I corrieri rispondono quasi tutti sotto i 150 ms,
// una lettura del database costa 34 ms: il tempo e' nelle letture fatte una dopo l'altra, ma QUALI non lo dice
// nessun registro. Prima di toccare la creazione (soldi) si misura su quelle vere: una riga di registro per
// creazione, con le fasi e quanto si e' aspettato ogni indirizzo esterno (database, corriere, la piattaforma stessa).
//
// Come: un AsyncLocalStorage tiene il cronometro della richiesta in corso; fetch viene avvolto UNA volta, e conta
// solo se c'e' un cronometro attivo, altrimenti passa la chiamata cosi' com'e'. Le chiamate in parallelo si sommano:
// il totale per indirizzo e' tempo di attesa, non tempo da orologio.

type Cronometro = {
  inizio: number
  fasi: [string, number][]
  host: Record<string, [number, number]>   // indirizzo -> [quante chiamate, millisecondi di attesa]
  note: Record<string, string | number>
}

const deposito = new AsyncLocalStorage<Cronometro>()

function hostDi(input: any): string {
  try {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || '')
    return new URL(u).hostname || '?'
  } catch { return '?' }
}

let fetchAvvolto = false
function avvolgiFetch() {
  if (fetchAvvolto || typeof globalThis.fetch !== 'function') return
  fetchAvvolto = true
  const vero = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const c = deposito.getStore()
    if (!c) return vero(input, init)
    const t = performance.now()
    try { return await vero(input, init) }
    finally {
      const h = hostDi(input), v = c.host[h] || (c.host[h] = [0, 0])
      v[0]++; v[1] += performance.now() - t
    }
  }) as typeof fetch
}

// Segna il momento di una fase («prezzo», «corriere», «salvata»…), in millisecondi dall'inizio della richiesta.
export function segna(fase: string) {
  const c = deposito.getStore()
  if (c) c.fasi.push([fase, Math.round(performance.now() - c.inizio)])
}

// Una nota da riportare nella riga (es. il tipo di contratto). Solo testi brevi e numeri: mai dati personali.
export function annota(chiave: string, valore: string | number) {
  const c = deposito.getStore()
  if (c) c.note[chiave] = typeof valore === 'string' ? valore.slice(0, 40) : valore
}

// Esegue `fn` con un cronometro attivo e, comunque finisca, scrive UNA riga col prefisso dato.
export async function cronometra<T>(prefisso: string, fn: () => Promise<T>): Promise<T> {
  avvolgiFetch()
  const c: Cronometro = { inizio: performance.now(), fasi: [], host: {}, note: {} }
  try { return await deposito.run(c, fn) }
  finally {
    try {
      const host: Record<string, [number, number]> = {}
      for (const [h, [n, ms]] of Object.entries(c.host)) host[h] = [n, Math.round(ms)]
      console.log(prefisso, JSON.stringify({ ms: Math.round(performance.now() - c.inizio), ...c.note, fasi: c.fasi, host }))
    } catch { /* il registro non deve mai far fallire la richiesta */ }
  }
}
