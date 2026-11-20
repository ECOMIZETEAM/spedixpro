/* I COLLI CON CUI PARTE UN ORDINE IMPORTATO DA FILE, quando lo si spedisce in massa.
 *
 * L'ordine dice QUANTI pacchi sono (colonna "colli" del file) e QUANTO pesa in tutto. Da qui nascono
 * i colli che si prezzano e quelli che si spediscono: una regola sola, usata dall'anteprima del
 * prezzo e da "Spedisci selezionati", cosi' cio' che e' stato prezzato e' cio' che parte.
 *
 * FINO AL 19/10/2026 IL LOTTO MANDAVA SEMPRE UN COLLO SOLO col peso intero, qualunque cosa dicesse
 * il file, e cosi' dal primo giorno (01/07). La tabella scriveva "2 colli" e partiva una spedizione
 * con un'etichetta: in novanta giorni 21 ordini, chi annullato e rifatto a mano, chi "rattoppato" con
 * una seconda spedizione da un collo (due noli invece di uno), quattro partiti con un'etichetta sola
 * per due scatole. Caso segnalato: TUTTO CASA SHOP, ordine 120989, 2 colli nel file, partito come
 * 282343J008423 da 1 collo da 20 kg. I colli giusti uscivano solo dalla matita.
 *
 * LA REGOLA E' QUELLA DELLA MATITA, di proposito: lo stesso ordine deve avere gli stessi colli e lo
 * stesso prezzo da qualunque strada lo si spedisca, e la matita e' quella che i clienti usano da
 * sempre per i multicollo (262 ordini su 283 in novanta giorni). Il peso si divide in parti uguali;
 * le misure del pacco o dell'articolo vanno al primo collo e gli altri hanno le misure di ripiego —
 * esattamente cio' che esce dal modulo Nuova spedizione quando lo apre la matita
 * (app/cliente/spedizioni/nuova/page.tsx: il precompilato scrive in ogni collo il suo pezzo del peso
 * con pesiDivisiScritti, da' le misure solo al primo collo, e buildPackages mette 20×15×10 dove le
 * misure mancano). Se un giorno i colli devono prendere tutti le misure del pacco, va cambiato qui E
 * nel modulo, insieme. */

export type Collo = { weight: number; length: number; width: number; height: number }

// Le misure di un collo che non ne ha di sue: le stesse del modulo (buildPackages).
export const MISURE_RIPIEGO = { length: 20, width: 15, height: 10 } as const

// Quanti colli al massimo si spediscono da qui. Dai file ne arrivano al massimo 10 (180 giorni al
// 19/10/2026), le spedizioni vere arrivano a 30. Oltre, l'anteprima risponde "troppi colli" e
// l'ordine va aperto con la matita.
export const MAX_COLLI_PER_RIGA = 30

// Il numero di colli scritto sull'ordine. L'import lo salva gia' intero e almeno 1
// (app/api/ordini/importa/route.ts): qui si ripete perche' un valore strano non diventi zero colli.
// Il tetto (uno oltre il massimo, quanto basta perche' l'anteprima dica "troppi colli") evita che un
// numero assurdo nel file — un codice finito nella colonna sbagliata — faccia costruire alla pagina,
// a ogni disegno, un elenco di milioni di colli e la blocchi.
export function numeroColli(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_COLLI_PER_RIGA + 1) : 1
}

// `peso` = peso TOTALE dell'ordine; `misure` = quelle del pacco o dell'articolo, se ci sono.
export function colliDellOrdine(
  peso: number,
  colli: unknown,
  misure?: { length: number; width: number; height: number } | null,
): Collo[] {
  const n = numeroColli(colli)
  const totale = Number(peso) || 0
  // Diviso senza arrotondare: 20 kg in 3 colli sono 6,666… a collo.
  // MA LA SOMMA NON DEVE SUPERARE IL PESO DELL'ORDINE. In virgola mobile 100/7 sommato sette volte fa
  // 100,00000000000001: il motore somma i colli senza arrotondare (lib/pricing.ts,
  // calcolaPesoFatturato), confronta con le fasce (peso <= peso_max) e oltre l'ultima conta i blocchi
  // arrotondando per eccesso. Caso vero: ordine TUTTO CASA 120725, 100 kg in 7 colli su SDA EXPRESS L,
  // 22 € col peso intero e 44 € diviso — un blocco "oltre" in piu' per un centomillesimo di
  // miliardesimo di chilo (l'operatore, dalla matita, aveva scritto 99 kg). Succede in 81 casi su 900
  // (pesi interi da 1 a 100 kg, da 2 a 10 colli), e fa danno quando il totale cade su un limite di
  // fascia. Vedi senzaEccedenza qui sotto.
  const pesi = senzaEccedenza(Array.from({ length: n }, () => totale / n), totale)
  return pesi.map((weight, i) => ({
    weight,
    ...(i === 0 && misure ? { length: misure.length, width: misure.width, height: misure.height } : MISURE_RIPIEGO),
  }))
}

// Come si legge un elenco di colli in una riga di testo (suggerimento accanto al prezzo).
export function descriviColli(colli: Collo[]): string {
  const kg = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',')
  const uno = (c: Collo) => `${kg(c.weight)} kg, ${c.length}×${c.width}×${c.height} cm`
  if (colli.length === 1) return uno(colli[0])
  return `${colli.length} colli (${colli.map(uno).join(' + ')})`
}

// LA SOMMA DEI COLLI NON DEVE SUPERARE `totale`, sommata come la somma il motore (in fila, senza
// arrotondare: lib/pricing.ts, calcolaPesoFatturato). L'eccedenza della virgola mobile si toglie
// dall'ultimo collo; quattro giri bastano, la correzione e' di qualche miliardesimo di grammo.
export function senzaEccedenza(pesi: number[], totale: number): number[] {
  const out = [...pesi]
  const n = out.length
  if (!n) return out
  for (let giro = 0; giro < 4; giro++) {
    let somma = 0
    for (const p of out) somma += p
    if (somma <= totale) break
    out[n - 1] -= somma - totale
  }
  return out
}

// I PESI SCRITTI COLLO PER COLLO nel modulo Nuova spedizione, come numeri per il motore.
// Dal 16/11/2026 il modulo non ha piu' il peso totale: ogni collo ha il suo. Ma chi scrive i pesi a
// mano scrive decimali, e in virgola mobile 0,2 + 4,4 + 0,4 fa 5,000000000000001: sopra la fascia
// "fino a 5 kg" per un niente (misurato: con tre colli succede in 2.200 somme intere su 100.000). Il
// totale vero e' la somma decimale di quanto scritto; la si ricava arrotondando al milionesimo di
// chilo, che e' molto sotto qualunque peso si scriva e molto sopra l'errore della virgola mobile.
export function pesiDelModulo(scritti: Array<string | number | undefined | null>): number[] {
  const pesi = scritti.map(s => Number(s) || 0)
  let somma = 0
  for (const p of pesi) somma += p
  return senzaEccedenza(pesi, Math.round(somma * 1e6) / 1e6)
}

// IL PESO DI UN ORDINE SCRITTO NEI SUOI COLLI, quando la matita apre il modulo con un ordine da piu'
// colli: lo stesso peso di colliDellOrdine, ma scritto come lo scriverebbe una persona, al grammo. I
// primi colli prendono la parte arrotondata per difetto, l'ultimo il resto: la somma scritta e' il peso
// dell'ordine, e chi apre il modulo vede in ogni riga un numero che puo' correggere col peso vero.
// `n` lo decide il modulo: niente tetto di MAX_COLLI_PER_RIGA, oltre il quale e' proprio la matita la
// strada per spedire l'ordine.
export function pesiDivisiScritti(peso: number, n: number): string[] {
  const grammi = Math.round((Number(peso) || 0) * 1000)
  if (grammi <= 0) return Array.from({ length: n }, () => '')
  const parte = Math.floor(grammi / n)
  return Array.from({ length: n }, (_, i) => String((i === n - 1 ? grammi - parte * (n - 1) : parte) / 1000))
}
