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
 * (app/cliente/spedizioni/nuova/page.tsx: il precompilato da' le misure solo al primo collo,
 * buildPackages divide il peso e mette 20×15×10 dove le misure mancano). Se un giorno i colli
 * devono prendere tutti le misure del pacco, va cambiato qui E nel modulo, insieme. */

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
  // Diviso senza arrotondare, come il modulo ((+peso || 0) / n): 20 kg in 3 colli sono 6,666… a collo.
  const pesi = Array.from({ length: n }, () => totale / n)
  // MA LA SOMMA NON DEVE SUPERARE IL PESO DELL'ORDINE. In virgola mobile 100/7 sommato sette volte fa
  // 100,00000000000001: il motore somma i colli senza arrotondare (lib/pricing.ts,
  // calcolaPesoFatturato), confronta con le fasce (peso <= peso_max) e oltre l'ultima conta i blocchi
  // arrotondando per eccesso. Caso vero: ordine TUTTO CASA 120725, 100 kg in 7 colli su SDA EXPRESS L,
  // 22 € col peso intero e 44 € diviso — un blocco "oltre" in piu' per un centomillesimo di
  // miliardesimo di chilo (l'operatore, dalla matita, aveva scritto 99 kg). Succede in 81 casi su 900
  // (pesi interi da 1 a 100 kg, da 2 a 10 colli), e fa danno quando il totale cade su un limite di
  // fascia. L'eccedenza si toglie dall'ultimo collo, sommando nello stesso ordine del motore: la somma
  // torna il peso dell'ordine, o un'inezia sotto, e la fascia e' quella del peso vero. La matita
  // divide allo stesso modo e il difetto ce l'ha ancora (vedi REGOLE.md).
  for (let giro = 0; giro < 4; giro++) {
    let somma = 0
    for (const p of pesi) somma += p
    if (somma <= totale) break
    pesi[n - 1] -= somma - totale
  }
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
