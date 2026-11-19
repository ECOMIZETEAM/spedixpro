// LA RIGA DELLA SPEDIZIONE DOPO CHE IL PONTE HA COMPRATO LA LDV.
//
// Su un contratto condiviso, quando questa riga si scrive la LDV dal venditore esiste gia' e le gambe sotto
// sono gia' addebitate. Se l'insert cade, il pacco resta senza la spedizione di chi l'ha chiesto. Il 12/11/2026
// 382343J004713 (LA MARCA SERVICES, SDA EXPRESS L) e' caduto per «statement timeout», un errore isolato e
// passeggero. Il cliente ha letto «contatta l'assistenza», la prenotazione e' rimasta trattenuta 20 minuti e
// le gambe pagate per mezz'ora, finche' i due giri automatici hanno rimesso a posto.
// Regola di Lorenzo (12/11/2026): si riprova subito, una o due volte. Prima di riprovare si guarda se la riga
// c'e' gia': il primo insert poteva essere andato e averne persa solo la risposta, e in quel caso si tiene
// quella, senza scriverne un doppione. Se non va, chi chiama annulla le gambe (lib/ponte-orfane) e restituisce
// il credito.

export type EsitoTesta = { id: string | null; adottata?: boolean; errore?: string }

// `scrivi` = l'insert della riga, ripetibile cosi' com'e'. `numero` = il numero della riga (UNIQUE): e' da li'
// che si ritrova una riga gia' scritta. `finoA` = oltre questo istante non si riprova, per lasciare il tempo
// di chiudere.
export async function scriviTestaPonte(
  admin: any, scrivi: () => PromiseLike<{ data: any; error: any }>, numero: string, finoA: number,
): Promise<EsitoTesta> {
  let r = await scrivi()
  if (!r.error) return { id: r.data?.id || null }
  let errore = String(r.error?.message || r.error)
  for (const attesa of [1_500, 3_000]) {
    if (finoA - Date.now() < attesa + 9_000) break   // un insert puo' durare fino al tetto di 8 s del database
    await new Promise(res => setTimeout(res, attesa))
    const gia = await rigaGiaScritta(admin, numero)
    if (gia) return { id: gia, adottata: true }
    r = await scrivi()
    if (!r.error) return { id: r.data?.id || null }
    errore = String(r.error?.message || r.error)
  }
  const gia = await rigaGiaScritta(admin, numero)
  return gia ? { id: gia, adottata: true } : { id: null, errore }
}

async function rigaGiaScritta(admin: any, numero: string): Promise<string | null> {
  const { data, error } = await admin.from('spedizioni').select('id').eq('numero', numero).maybeSingle()
  return !error && data?.id ? data.id : null
}
