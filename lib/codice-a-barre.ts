// CODICE A BARRE CODE 128 — disegnato da noi, senza librerie esterne.
//
// Serve per l'etichetta del circuito interno: il numero deve poter essere letto da un lettore, non
// solo dagli occhi. Code 128 e' lo standard della logistica (lo leggono tutti i palmari), accetta
// lettere e cifre, ed e' abbastanza semplice da generare senza portarsi dietro una dipendenza.
//
// Restituisce la sequenza di barre come larghezze: chi disegna decide quanto vale un modulo.

// Ogni simbolo Code128 e' fatto di 6 elementi alternati barra/spazio, per 11 moduli totali.
const PATTERN = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
]

const START_B = 104   // Set B: lettere maiuscole/minuscole e cifre — copre i nostri numeri di LDV
const STOP = 106

// Larghezze delle barre/spazi, alternate a partire da una BARRA.
export function barreCode128(testo: string): number[] {
  const codici: number[] = [START_B]
  for (const ch of testo) {
    const c = ch.charCodeAt(0)
    // Set B parte dallo spazio (32) e vale fino a 126: fuori da li' il carattere non e'
    // rappresentabile e viene sostituito, meglio di un codice illeggibile.
    codici.push(c >= 32 && c <= 126 ? c - 32 : 0)
  }
  // Somma di controllo: senza, un lettore accetterebbe letture sbagliate come valide.
  let somma = START_B
  for (let i = 1; i < codici.length; i++) somma += codici[i] * i
  codici.push(somma % 103)
  codici.push(STOP)

  const larghezze: number[] = []
  for (const c of codici) for (const d of PATTERN[c]) larghezze.push(Number(d))
  return larghezze
}
