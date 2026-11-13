// COSA HA SPESO UN CLIENTE: la voce di ogni movimento. Un punto solo, per la proforma e per il
// Report Fatture (decisione di Lorenzo, 13/11/2026: "stessa regola", due pagine non devono dare due
// totali diversi per lo stesso cliente e lo stesso periodo).
//
// Si leggono i MOVIMENTI della gamba del cliente (master_target_id nullo): le righe fra master sono
// soldi della rete, non quello che il cliente deve al suo master. Il giorno di un movimento e' quello
// in cui e' stato REGISTRATO: una rettifica di un pacco di ottobre registrata il 4 novembre conta a
// novembre, e un rimborso di un annullo e' una riga in meno nel giorno in cui arriva.
//
// Gli importi dei movimenti sono IVA esclusa e l'addebito e' negativo: la spesa e' -importo.

export type Voce = { chiave: string; descrizione: string; uno: string; tanti: string }

// L'ordine e' quello delle righe nel riepilogo.
export const VOCI_SPESA: Voce[] = [
  { chiave: 'spedizione', descrizione: 'Spedizioni', uno: 'spedizione', tanti: 'spedizioni' },
  { chiave: 'rettifica', descrizione: 'Rettifiche di peso e misure', uno: 'rettifica', tanti: 'rettifiche' },
  { chiave: 'giacenza', descrizione: 'Giacenze', uno: 'giacenza', tanti: 'giacenze' },
  { chiave: 'reso', descrizione: 'Resi al mittente', uno: 'reso', tanti: 'resi' },
  { chiave: 'logistica', descrizione: 'Servizi di magazzino', uno: 'voce', tanti: 'voci' },
  { chiave: 'consumabile', descrizione: 'Servizi aggiuntivi', uno: 'voce', tanti: 'voci' },
  // Le rettifiche SENZA spedizione le scrive a mano il master, e sotto quel nome c'e' di tutto:
  // servizi veri ("rettifiche portale vecchio", "ritiro vivian"), ma anche correzioni di una ricarica.
  // Lorenzo (13/11/2026): dentro il totale, in una riga a parte e ben visibile, cosi' il master le vede
  // e se una e' sbagliata la toglie dai movimenti. (Nella fattura vera restano fuori: lib/fatture/calcolo.)
  { chiave: 'a_mano', descrizione: 'Voci registrate a mano', uno: 'voce', tanti: 'voci' },
  // Un tipo di movimento nato dopo questa lista non sparisce in silenzio: finisce qui, con la sua descrizione.
  { chiave: 'altro', descrizione: 'Altre voci', uno: 'voce', tanti: 'voci' },
  { chiave: 'rimborso', descrizione: 'Rimborsi e storni', uno: 'rimborso', tanti: 'rimborsi' },
]

// Movimenti che NON sono una spesa: le ricariche sono pagamenti, i contrassegni sono soldi dei
// destinatari del cliente che passano dal portale. Caso vero, VPERFUME (GTS EXPRESS) a ottobre 2026:
// 458,41 € di servizi, ma anche +225,00 € di ricariche e +184,49 € di contrassegni compensati.
// Sommando tutto, la proforma sarebbe uscita da 48,92 € invece che da 458,41 €.
export const TIPI_NON_SPESA = ['ricarica', 'contrassegno'] as const

const NOTE = new Set(VOCI_SPESA.map(v => v.chiave))

// La voce di un movimento, o null se non e' una spesa.
export function voceSpesa(tipo: string, conSpedizione: boolean): string | null {
  if ((TIPI_NON_SPESA as readonly string[]).includes(tipo)) return null
  if (tipo === 'rettifica' && !conSpedizione) return 'a_mano'
  return NOTE.has(tipo) && tipo !== 'a_mano' && tipo !== 'altro' ? tipo : 'altro'
}

export type RigaVoce = { voce: string; descrizione: string; quantita: number; importo: number }

const cent = (x: number) => Math.round((Number(x) || 0) * 100) / 100

// Dai movimenti (o dai loro aggregati) alle righe del riepilogo. `importo` e' quello del movimento
// (addebito negativo). Una voce che somma a zero non diventa riga.
export function righeSpesa(elenco: { tipo: string; con_spedizione: boolean; n: number; importo: number }[]): { righe: RigaVoce[]; imponibile: number } {
  const perVoce = new Map<string, { n: number; importo: number }>()
  for (const r of elenco) {
    const k = voceSpesa(r.tipo, r.con_spedizione)
    if (!k) continue
    const v = perVoce.get(k) || { n: 0, importo: 0 }
    v.n += Number(r.n) || 0
    v.importo += Number(r.importo) || 0
    perVoce.set(k, v)
  }
  const righe: RigaVoce[] = []
  for (const voce of VOCI_SPESA) {
    const v = perVoce.get(voce.chiave)
    if (!v) continue
    const importo = cent(-v.importo)
    if (importo === 0) continue
    righe.push({ voce: voce.chiave, descrizione: voce.descrizione, quantita: v.n, importo })
  }
  // Il totale e' la somma delle righe GIA' arrotondate: e' la cifra che si legge sommando il riepilogo.
  return { righe, imponibile: cent(righe.reduce((t, r) => t + r.importo, 0)) }
}

export function unitaVoce(chiave: string, n: number): string {
  const v = VOCI_SPESA.find(x => x.chiave === chiave)
  return n === 1 ? (v?.uno || 'voce') : (v?.tanti || 'voci')
}
