// UN BLOCCO = QUELLO CHE IL LIVELLO DI SOPRA TI HA ADDEBITATO, COME SE FOSSE UN FILE.
//
// I blocchi di «Dal mio network» si facevano per GIORNO DI NASCITA della riga. Ma una rettifica nasce
// quando il livello di sopra la carica e si addebita quando la CONFERMA, anche giorni dopo. Il 07/11/2026
// alle 00:10 MULTIEXPRESS ha confermato in una volta 299 righe per 531,88 € a Ecomize Solution, che nella
// sua pagina le ha viste spezzate in tre blocchi: 366,99 sotto il 06/11, 163,24 sotto il 30/10 (supplementi
// UPS caricati quel giorno), 1,65 sotto il 05/11. Nessun euro mancava, ma i conti con MULTI non tornavano e
// sembrava sparito tutto. Ora il blocco segue l'ADDEBITO: mittente + giorno in cui ha confermato.
//
// L'ora dell'addebito e' `rettifiche.confermata_il`, scritta dal database (trg_rettifica_confermata_il) nel
// momento in cui la riga diventa confermata, da qualunque porta. Lo storico e' stato riempito dai movimenti
// RIP-. Una riga senza quell'ora (solo storico molto vecchio, o righe a 0 € che non hanno movimento) ripiega
// sul giorno di nascita, come prima.

const GIORNO = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
// Chiave ordinabile (AAAA-MM-GG) dello stesso giorno italiano: il server gira in UTC, e le 00:10 del 07/11
// italiane sono le 23:10 del 06/11 UTC.
const CHIAVE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })

// UNA CONFERMA CHE SCAVALCA LA MEZZANOTTE RESTA NEL GIORNO IN CUI E' COMINCIATA. Dentro una stessa conferma le
// righe si addebitano a pochi secondi l'una dall'altra (al massimo un minuto e mezzo, misurato su MULTI →
// Ecomize Solution); fra due conferme diverse passano almeno un paio di minuti, di solito ore. Dieci minuti
// senza addebiti = conferma nuova. Senza questa regola una conferma partita alle 23:58 si spezzerebbe in due
// giorni: lo stesso errore di prima.
const PAUSA_FRA_INVII_MS = 10 * 60 * 1000

export function oraAddebito(r: { confermata_il?: string | null; created_at: string }): number {
  return new Date(r.confermata_il || r.created_at).getTime()
}

type Riga = { id: string; master_id: string; confermata_il?: string | null; created_at: string; propagazione?: string | null; [k: string]: any }

/**
 * Assegna a ogni riga ricevuta il suo blocco: mittente + giorno italiano in cui e' cominciata la conferma.
 * Scrive su ogni riga: `blocco` (chiave), `invio_giorno` (GG/MM/AAAA), `addebitata_ts` (ms) e, se serve,
 * `blocco_parziale`.
 *
 * `storicheTagliate`: le righe gia' decise si leggono fino a un tetto, dalla conferma piu' recente. Se il tetto
 * e' stato raggiunto, il giorno piu' vecchio letto puo' essere a meta' — e un blocco a meta' mostra un totale
 * che non e' quello addebitato, cioe' proprio l'errore da evitare. Quel giorno (e i precedenti) si tolgono
 * dalle gia' decise; le da decidere restano tutte, perche' vanno decise, e il loro blocco si segna parziale.
 */
export function raggruppaPerInvio<T extends Riga>(righe: T[], storicheTagliate: boolean): T[] {
  const perMittente = new Map<string, T[]>()
  for (const r of righe) {
    const k = r.master_id || '—'
    if (!perMittente.has(k)) perMittente.set(k, [])
    perMittente.get(k)!.push(r)
  }
  const chiaveGiorno = new Map<string, string>()   // id riga → AAAA-MM-GG del suo blocco
  for (const [mittente, lista] of perMittente) {
    lista.sort((a, b) => oraAddebito(a) - oraAddebito(b))
    let inizio = 0, prec = -Infinity
    for (const r of lista) {
      const t = oraAddebito(r)
      if (t - prec > PAUSA_FRA_INVII_MS) inizio = t
      prec = t
      const giorno = CHIAVE.format(inizio)
      chiaveGiorno.set(r.id, giorno)
      ;(r as any).blocco = mittente + '|' + giorno
      ;(r as any).invio_giorno = GIORNO.format(inizio)
      ;(r as any).addebitata_ts = t
    }
  }
  if (!storicheTagliate) return righe

  // Il giorno dell'ultima gia' decisa letta: da li' in giu' le gia' decise possono mancare.
  let taglio = ''
  for (const r of righe) {
    if (!r.propagazione) continue
    const g = CHIAVE.format(oraAddebito(r))
    if (!taglio || g < taglio) taglio = g
  }
  const blocchiToccati = new Set<string>()
  const tenute = righe.filter(r => {
    if (!r.propagazione) return true
    if ((chiaveGiorno.get(r.id) || '') > taglio) return true
    blocchiToccati.add((r as any).blocco)
    return false
  })
  for (const r of tenute) if (blocchiToccati.has((r as any).blocco)) (r as any).blocco_parziale = true
  return tenute
}
