// MULTICOLLO: le misure collo per collo, e come si trasformano nei colli da riprezzare.
//
// IL GUASTO CHE QUESTO FILE RIPARA. Il fornitore tecnico, quando ripesa una spedizione di piu'
// colli, manda UNA riga sola col peso TOTALE. Finora quel totale finiva in un collo unico: il
// riprezzo perdeva il volume di tutti gli altri, e alla rete si chiedeva molto meno di quanto il
// pacco costava davvero. Misurato il 29/09/2026 su 40 spedizioni multicollo vere, conto fornitore
// 499,72 EUR: col collo unico si recuperavano 419,81 EUR (84%), collo per collo 564,16 EUR (113%,
// il 100% tolti due casi in cui il fornitore ci aveva addebitato pochissimo).
//
// Le misure vere le prende il portale filiali di Poste, una per ogni collo. Poste pero' blocca gli
// IP dei server: la lettura si fa dal Mac e finisce nella tabella misure_colli; qui c'e' solo la
// regola di come si leggono e come si usano, perche' la stessa regola serve a chi legge (il Mac) e
// a chi riprezza (il caricamento delle rettifiche).

export type MisuraCollo = { codice: string; peso: number; lunghezza: number; larghezza: number; altezza: number }
export type ColloRipesato = { peso: number; lunghezza: number; larghezza: number; altezza: number }

const num = (v: any) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

// LA LETTERA DI VETTURA DEL SINGOLO COLLO. Il fornitore la scrive attaccata a quella della madre
// ("07WFMZ88W" + "1UW07WF314421"): al portale filiali va chiesto solo il pezzo davanti, che e'
// quello che si vede nella sua colonna LV, con la madre in "LV Associata". La madre e' il pezzo
// finale che TUTTI i codici della spedizione hanno in comune — ricavarlo cosi' funziona anche
// quando in spedizioni.numero e' finito il codice composito (capita, vedi il disallineamento
// numero/tracking_number).
export function codiciColliDaFornitore(codiciGrezzi: string[]): string[] {
  const codici = (codiciGrezzi || []).map(c => String(c || '').trim()).filter(Boolean)
  if (codici.length < 2) return codici
  let madre = ''
  const primo = codici[0]
  for (let k = 1; k <= primo.length; k++) {
    const coda = primo.slice(primo.length - k)
    if (codici.every(c => c.endsWith(coda))) madre = coda
    else break
  }
  if (!madre) return codici
  // Il collo che coincide con la madre (l'ultimo dell'elenco) resta com'e': la sua LV e' la madre.
  return codici.map(c => (c.length > madre.length ? c.slice(0, c.length - madre.length) : c))
}

// LA MISURA DI UN COLLO, dalle letture delle filiali. Peso e dimensioni si prendono CIASCUNO dalla
// sua lettura migliore, e non dalla stessa riga: capita che una lettura porti le misure ma peso 0
// (il volume lo prende lo scanner del nastro, il peso no). Con la sola riga migliore quei colli
// pesavano zero.
export function misuraDaLetture(codice: string, letture: any[]): MisuraCollo {
  const conPeso = (letture || []).find(r => num(r?.peso) > 0)
  const conMisure = (letture || []).find(r => num(r?.lunghezza) > 0 && num(r?.larghezza) > 0 && num(r?.altezza) > 0)
  return {
    codice,
    peso: num(conPeso?.peso),
    lunghezza: num(conMisure?.lunghezza),
    larghezza: num(conMisure?.larghezza),
    altezza: num(conMisure?.altezza),
  }
}

// I COLLI DA RIPREZZARE. Si parte dalle misure lette e si completa col totale del fornitore:
// un collo che nessuna filiale ha pesato vale quello che manca al totale (totale - somma dei letti),
// diviso fra i colli ciechi. Senza misure non si inventa nessun volume: quel collo pesa e basta.
// Sui dati veri e' successo una volta su quaranta, e il conto tornava al chilo.
export function colliDaMisure(misure: MisuraCollo[], pesoTotaleFornitore: number): ColloRipesato[] {
  const colli: ColloRipesato[] = (misure || []).map(m => ({
    peso: num(m.peso), lunghezza: num(m.lunghezza), larghezza: num(m.larghezza), altezza: num(m.altezza),
  }))
  const senzaPeso = colli.filter(c => c.peso <= 0)
  if (senzaPeso.length) {
    const residuo = num(pesoTotaleFornitore) - colli.reduce((s, c) => s + c.peso, 0)
    if (residuo > 0) for (const c of senzaPeso) c.peso = Math.round((residuo / senzaPeso.length) * 100) / 100
  }
  return colli
}
