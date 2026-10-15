// FORMULE DEL SOTTO-COSTO SUI SERVIZI A "FISSO + % DEL NOLO" — giacenze e servizi accessori.
//
// Le usano il Check Sotto Costo (lib/sotto-costo.ts) e il rosso dell'editor del listino: devono dire
// la stessa cosa, quindi la regola sta qui una volta sola. Nessuna dipendenza dal server: gira anche
// nel browser.
//
// Perche' esiste: il Check confrontava il fisso col fisso e la percentuale con la percentuale, ognuno
// per conto suo. Wave (15/10) vendeva la Riconsegna a "0 € + 100% del nolo" e la pagava "2 € + 0%":
// segnata in rosso come perdita di 2 €, mentre il cliente pagava almeno 4,90 € (il nolo intero).
// L'addebito vero e' fisso + percentuale × nolo (lib/giacenza-prezzi.ts calcolaCosti, la catena in
// lib/giacenza-cascata.ts, il reso in fn_addebita_resi, gli accessori in lib/cascata.ts e
// lib/prezzo-cliente.ts): il confronto si fa con quella formula, fascia per fascia.

// Le operazioni di svincolo che il portale addebita. Stessa mappa di lib/giacenza-prezzi.ts e
// lib/giacenza-cascata.ts: il primo servizio del listino che ci cade dentro e' quello che si paga.
export function chiaveServizioGiacenza(nome: string): 'riconsegna' | 'riconsegna_nuovo' | 'reso' | null {
  const n = (nome || '').toLowerCase()
  if (n.includes('nuovo')) return 'riconsegna_nuovo'
  if (n.includes('reso')) return 'reso'
  if (n.includes('riconsegna')) return 'riconsegna'
  return null
}

// Quanto vale per il cliente un servizio giacenza che NON e' nel suo listino. Riconsegna e nuovo
// destinatario: zero (leggiPrezziDaListino). Reso: il predefinito e' il nolo intero (prezziVuoti e
// fn_addebita_resi: "il cliente ha sempre un predefinito" 0 € + 100%). Gli altri servizi oggi non si
// possono chiedere dal portale: se un giorno si potranno, senza riga il cliente non paga niente.
export function predefinitoGiacenzaCliente(nome: string): { valore: number; perc: number } {
  return chiaveServizioGiacenza(nome) === 'reso' ? { valore: 0, perc: 100 } : { valore: 0, perc: 0 }
}

export type Nolo = { cliente: number; costo: number; etichetta?: string }
export type Peggiore = { differenza: number; vendi: number; paghi: number; etichetta?: string }

// Il caso peggiore di un servizio "fisso + % del nolo" su tutte le fasce che cliente e master hanno
// in comune (stessa zona, stesso peso). Il nolo del cliente si prende almeno pari al costo: se una
// fascia e' gia' venduta sotto costo la segnala la fascia stessa, qui si guarda solo se il SERVIZIO,
// a nolo giusto, copre quello che paga il master. Senza fasce in comune: null (non valutabile).
export function peggioreSuNolo(
  vendita: { valore: number; perc: number },
  costo: { valore: number; perc: number },
  noli: Nolo[],
): Peggiore | null {
  let peggio: Peggiore | null = null
  for (const n of noli) {
    // 10.000 € non e' un costo: e' il segnaposto che esclude una destinazione (es. Livigno). Preso
    // come nolo, farebbe sembrare ogni servizio a percentuale una perdita enorme.
    if (!(n.costo > 0) || n.costo >= 9999) continue
    const vendi = vendita.valore + vendita.perc / 100 * Math.max(n.cliente, n.costo)
    const paghi = costo.valore + costo.perc / 100 * n.costo
    const d = vendi - paghi
    if (!peggio || d < peggio.differenza) peggio = { differenza: d, vendi, paghi, etichetta: n.etichetta }
  }
  if (!peggio) return null
  const r2 = (x: number) => Math.round(x * 100) / 100
  return { differenza: r2(peggio.differenza), vendi: r2(peggio.vendi), paghi: r2(peggio.paghi), etichetta: peggio.etichetta }
}
