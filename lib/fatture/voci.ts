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

import { regimeDi, type RegimeIva } from '@/lib/iva-calcolo'

export type Voce = { chiave: string; descrizione: string; uno: string; tanti: string }

// L'ordine e' quello delle righe nel riepilogo.
export const VOCI_SPESA: Voce[] = [
  { chiave: 'spedizione', descrizione: 'Spedizioni', uno: 'spedizione', tanti: 'spedizioni' },
  { chiave: 'rettifica', descrizione: 'Rettifiche di peso e misure', uno: 'rettifica', tanti: 'rettifiche' },
  { chiave: 'giacenza', descrizione: 'Giacenze', uno: 'giacenza', tanti: 'giacenze' },
  { chiave: 'reso', descrizione: 'Resi al mittente', uno: 'reso', tanti: 'resi' },
  { chiave: 'logistica', descrizione: 'Servizi di magazzino', uno: 'voce', tanti: 'voci' },
  { chiave: 'consumabile', descrizione: 'Servizi aggiuntivi', uno: 'voce', tanti: 'voci' },
  // Le rettifiche SENZA spedizione le scrive a mano il master, e sotto quel nome ci sono soprattutto
  // correzioni del credito, non servizi. Ottobre 2026, tutti i master: 190 righe per 30.203,64 €, di cui
  // ~24.500 € "Accredito credito a scalare - storno distinta / errore ricarica / spostamento master",
  // "ERRATO ACCREDITO" 1.000 € (NUOVAPOSTA, GTS), "STORNO ACCREDITO - BONIFICO NON PERVENUTO"; solo
  // ~5.600 € sono servizi veri (col numero di spedizione nella descrizione). Lorenzo (13/11/2026): non
  // entrano da sole. Nella proforma il master le vede una per una e spunta quelle che sono servizi; nel
  // Report Fatture stanno in una colonna a parte, fuori dall'imponibile.
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

// `esente`: la riga raccoglie i movimenti venduti ESENTI IVA (21/11/2026): fuori dall'imponibile, senza IVA.
export type RigaVoce = { voce: string; descrizione: string; quantita: number; importo: number; esente?: true }

const cent = (x: number) => Math.round((Number(x) || 0) * 100) / 100

// Dai movimenti (o dai loro aggregati) alle righe del riepilogo. `importo` e' quello del movimento
// (addebito negativo). Una voce che somma a zero non diventa riga.
// Le voci scritte a mano entrano nelle righe solo con `conAMano` (la proforma ci passa soltanto quelle
// spuntate dal master); altrimenti restano fuori e si contano a parte in `aMano` (spesa: + = addebito).
//
// IVA INCLUSA (Lorenzo, 20/11/2026): i movimenti di una spedizione che il master ha venduto IVA
// inclusa (`iva_inclusa`, deciso dal database) contengono gia' l'IVA. Nella voce entrano AL NETTO,
// scorporati con l'aliquota del cliente, e la loro IVA torna nel totale IVA che il chiamante calcola
// sull'imponibile. Senza movimenti IVA inclusa le righe sono quelle di sempre, al centesimo.
// `inclusa` dice quanto di quei movimenti e' uscito dal credito (lordo) e quanta IVA c'era dentro.
//
// SPESE CON L'IVA GIA' DENTRO (Lorenzo, 20/11/2026): in "Aggiungi spesa" il master sceglie l'IVA e il credito
// scala prezzo + IVA. Quei movimenti portano `aliquota_compresa` (tabella movimenti_iva_compresa): entrano
// nella voce AL NETTO con la LORO aliquota, e la loro IVA torna nel totale IVA del documento. Prima l'IVA si
// contava due volte (QUICK → MOI CHERI, 30/10: 240,01 scalati, 292,81 in proforma).
// `inclusa` somma entrambi i casi: quanto e' uscito dal credito con l'IVA dentro, e quanta IVA conteneva.
//
// ESENTE IVA (Lorenzo, 21/11/2026): i movimenti di una spedizione venduta esente (`regime` 'esente', deciso
// dal database) non hanno IVA, nemmeno se il cliente ha il 22%. Fanno righe loro, «… — esente IVA», dopo le
// altre, e stanno FUORI dall'imponibile: in `esente`. Il chiamante calcola l'IVA sull'imponibile e il totale
// e' imponibile + IVA + esente. Senza movimenti esenti righe e imponibile sono quelli di prima, al centesimo.
export function righeSpesa(
  elenco: { tipo: string; con_spedizione: boolean; n: number; importo: number; regime?: RegimeIva; iva_inclusa?: boolean; aliquota_compresa?: number | null }[],
  conAMano = false,
  aliquota = 22,
): { righe: RigaVoce[]; imponibile: number; esente: number; aMano: { n: number; importo: number }; inclusa: { lordo: number; iva: number } } {
  const perVoce = new Map<string, { n: number; importo: number; inclusa: number; compresa: Map<number, number> }>()
  const perVoceEsente = new Map<string, { n: number; importo: number }>()
  const aMano = { n: 0, importo: 0 }
  let lordoInclusa = 0
  const compresaTot = new Map<number, number>()
  for (const r of elenco) {
    const k = voceSpesa(r.tipo, r.con_spedizione)
    if (!k) continue
    if (k === 'a_mano' && !conAMano) { aMano.n += Number(r.n) || 0; aMano.importo -= Number(r.importo) || 0; continue }
    const regime = regimeDi(r.regime ?? r.iva_inclusa)
    if (regime === 'esente' && !(Number(r.aliquota_compresa) > 0)) {
      const e = perVoceEsente.get(k) || { n: 0, importo: 0 }
      e.n += Number(r.n) || 0
      e.importo += Number(r.importo) || 0
      perVoceEsente.set(k, e)
      continue
    }
    const v = perVoce.get(k) || { n: 0, importo: 0, inclusa: 0, compresa: new Map<number, number>() }
    v.n += Number(r.n) || 0
    const ac = Number(r.aliquota_compresa) || 0
    if (ac > 0) {
      v.compresa.set(ac, (v.compresa.get(ac) || 0) + (Number(r.importo) || 0))
      compresaTot.set(ac, (compresaTot.get(ac) || 0) + (Number(r.importo) || 0))
    } else if (regime === 'inclusa') { v.inclusa += Number(r.importo) || 0; lordoInclusa += Number(r.importo) || 0 }
    else v.importo += Number(r.importo) || 0
    perVoce.set(k, v)
  }
  const scorporo = 1 + (Number(aliquota) || 0) / 100
  const nettoCompresa = (m: Map<number, number>) => { let t = 0; for (const [a, x] of m) t += x / (1 + a / 100); return t }
  const righe: RigaVoce[] = []
  for (const voce of VOCI_SPESA) {
    const v = perVoce.get(voce.chiave)
    if (!v) continue
    const importo = cent(-(v.importo + v.inclusa / scorporo + nettoCompresa(v.compresa)))
    if (importo === 0) continue
    righe.push({ voce: voce.chiave, descrizione: voce.descrizione, quantita: v.n, importo })
  }
  // L'imponibile e' la somma delle righe soggette, prima di aggiungere quelle esenti.
  const imponibile = cent(righe.reduce((t, r) => t + r.importo, 0))
  for (const voce of VOCI_SPESA) {
    const e = perVoceEsente.get(voce.chiave)
    if (!e) continue
    const importo = cent(-e.importo)
    if (importo === 0) continue
    righe.push({ voce: voce.chiave, descrizione: `${voce.descrizione} — esente IVA`, quantita: e.n, importo, esente: true })
  }
  let lordoCompresa = 0
  for (const x of compresaTot.values()) lordoCompresa += x
  // L'IVA dei listini venduti IVA inclusa si calcola come nella versione gia' rilasciata (sul lordo arrotondato);
  // quella delle spese si aggiunge. Senza spese segnate il numero e' identico a prima.
  const lordoListini = cent(-lordoInclusa)
  const ivaListini = lordoListini - lordoListini / scorporo
  const ivaSpese = -lordoCompresa + nettoCompresa(compresaTot)
  // Il totale e' la somma delle righe GIA' arrotondate: e' la cifra che si legge sommando il riepilogo.
  return {
    righe, imponibile, esente: cent(righe.reduce((t, r) => t + (r.esente ? r.importo : 0), 0)), aMano: { n: aMano.n, importo: cent(aMano.importo) },
    inclusa: { lordo: cent(-(lordoInclusa + lordoCompresa)), iva: cent(ivaListini + ivaSpese) },
  }
}

export function unitaVoce(chiave: string, n: number): string {
  const v = VOCI_SPESA.find(x => x.chiave === chiave)
  return n === 1 ? (v?.uno || 'voce') : (v?.tanti || 'voci')
}
