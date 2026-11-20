// FARE N COSE, QUALCUNA ALLA VOLTA.
// Le creazioni in blocco (ordini dei negozi, import da file) andavano una dopo l'altra: con circa 9 secondi
// per creazione, 50 ordini Shopify erano 7-8 minuti di attesa (Lorenzo, 20/11/2026: «la creazione è
// lentissima»). Il credito non corre rischi a farne piu' insieme: la creazione lo PRENOTA con capienza
// verificata nella stessa istruzione (crea/route.ts, «PRENOTAZIONE DEL CREDITO»), e il numero interno lo
// assegna il database. Piu' di qualcuna alla volta no: ogni creazione parla col corriere, e non si vuole
// aprire cinquanta richieste insieme verso lo stesso account.
//
// I risultati tornano NELL'ORDINE DI PARTENZA, non in quello di arrivo: chi stampa le etichette del lotto
// le vuole nell'ordine in cui ha preparato i pacchi.
export const CREAZIONI_INSIEME = 4

export async function aGruppi<T, R>(elementi: T[], quanti: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(elementi.length)
  let prossimo = 0
  await Promise.all(Array.from({ length: Math.max(1, Math.min(quanti, elementi.length)) }, async () => {
    while (prossimo < elementi.length) {
      const i = prossimo++
      out[i] = await fn(elementi[i], i)
    }
  }))
  return out
}
