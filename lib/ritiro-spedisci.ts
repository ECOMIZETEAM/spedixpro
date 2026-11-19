import { dataDaRiprovare } from '@/lib/ritiro-giorno'

// IL RITIRO SU SPEDISCI.ONLINE, per il portale (/api/ritiri/crea) e per l'API pubblica (/api/v1/pickups).
//
// Le due porte avevano ognuna la sua chiamata e il suo "riprova domani", con la stessa lista di frasi
// copiata due volte. Dal 3 al 17/11/2026 sono passati senza riprova:
//   - 60 rifiuti per nome o ragione sociale oltre 35 caratteri (compName / contactPerson);
//   - 13 "Non è possibile effettuare un ritiro per la stessa giornata. La prima data utile è …" e
//     3 "La localita non e' servita nella giornata indicata! La prima data utile è …": frasi nuove,
//     che la vecchia lista non conosceva.

// Spedisci rifiuta nome, ragione sociale e via del mittente oltre i 35 caratteri (misurato il 22/9 e
// ancora nei log di novembre): meglio un nome accorciato che un pacco senza ritiro.
const MASSIMO = 35
export function accorciaMittenteSpedisci<T extends Record<string, any>>(shipFrom: T): T {
  const out: any = { ...shipFrom }
  for (const k of ['name', 'company', 'street1']) {
    if (typeof out[k] === 'string' && out[k].length > MASSIMO) out[k] = out[k].slice(0, MASSIMO).trim()
  }
  return out
}

export type EsitoInvioRitiroSpedisci = {
  ok: boolean          // il corriere ha accettato (HTTP ok e nessun campo error)
  timeout: boolean     // nessuna risposta in tempo
  status: number
  risposta: any        // il JSON del corriere (o { error: testo })
  data: string         // il giorno davvero prenotato
}

// Invia /pickup/create; se il corriere rifiuta il giorno, riprova una volta con quello che indica lui
// ("prima data utile") o col primo giorno lavorativo. `scadenza` e' l'istante oltre il quale non si
// aspetta: la rotta ha un tetto di 30 secondi e due attese da 25 non ci stanno.
export async function inviaRitiroSpedisci(baseUrl: string, password: string, payload: any, scadenza: number): Promise<EsitoInvioRitiroSpedisci> {
  const corpo = { ...payload, shipFrom: accorciaMittenteSpedisci(payload.shipFrom || {}) }
  const invia = async (): Promise<{ status: number; testo: string } | null> => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(25000, scadenza - Date.now())))
    try {
      const res = await fetch(`${baseUrl}/pickup/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      })
      return { status: res.status, testo: await res.text() }
    } catch { return null } finally { clearTimeout(t) }
  }
  const leggi = (testo: string) => { try { return JSON.parse(testo) } catch { return { error: testo.substring(0, 300) } } }

  let r = await invia()
  if (!r) return { ok: false, timeout: true, status: 504, risposta: null, data: corpo.pickupDate }
  let ok = r.status < 400 && !leggi(r.testo)?.error
  if (!ok) {
    const nuova = dataDaRiprovare(r.testo, String(corpo.pickupDate))
    if (nuova && scadenza - Date.now() > 3000) {
      console.log('[RITIRO] il corriere non accetta il ritiro del', corpo.pickupDate, ': riprovo per', nuova)
      const giornoChiesto = corpo.pickupDate
      corpo.pickupDate = nuova
      const r2 = await invia()
      if (!r2) return { ok: false, timeout: true, status: 504, risposta: null, data: giornoChiesto }
      r = r2
      ok = r.status < 400 && !leggi(r.testo)?.error
      if (!ok) corpo.pickupDate = giornoChiesto
    }
  }
  const risposta = leggi(r.testo)
  if (!ok) {
    // Solo il messaggio del corriere, mai il payload: contiene nome, indirizzo e telefono del mittente.
    // La password si toglie solo se c'e': con il pattern vuoto `split` metterebbe '***' ovunque. Nella
    // rotta del portale qui c'era un carattere NUL al posto della stringa vuota, e un byte NUL rende il
    // file "binario": ogni grep lo saltava, e la rotta era invisibile alle ricerche (trovato il 3/10/2026).
    const msg = String(risposta?.error || '')
    console.error('[RITIRO] pickup KO', r.status, (password ? msg.split(password).join('***') : msg).slice(0, 220))
  }
  return { ok, timeout: false, status: r.status, risposta, data: corpo.pickupDate }
}
