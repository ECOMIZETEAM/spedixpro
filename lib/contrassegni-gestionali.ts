/* DOVE VA OGNI CONTRASSEGNO COMPENSATO DA BRT. Sullo stesso conto BRT passano pacchi creati da Moove e da altri
 * gestionali, e la compensazione (lib/compensazione-brt) li porta tutti. Chi li ha creati si riconosce dal
 * riferimento mittente numerico, che mette il gestionale stesso:
 *  - Moove ne genera uno di 15 cifre e lo salva (lib/brt.ts): si cerca fra le spedizioni dei contratti BRT del
 *    detentore, e quei contrassegni vanno in Distinte contrassegni, come quelli del file del corriere;
 *  - il gestionale che usa il numero d'ordine (da 10 a 14 cifre) vuole un file col riferimento stesso,
 *    l'importo e il destinatario: si fa dal solo PDF;
 *  - il gestionale che numera da sé le spedizioni (riferimenti corti: 13614, 14166…) vuole un file con la
 *    lettera di vettura, che nel PDF non c'è: si prende dal suo export spedizioni, abbinando destinatario,
 *    importo del contrassegno e data.
 * Così sulla compensazione di Wave del 28/10/2026 (conto Clari, 22 contrassegni): 18 col numero d'ordine e 4
 * col riferimento corto, gli stessi dei due file che Wave aveva fatto a mano per i suoi due gestionali.
 *
 * Il nome dei gestionali non compare a schermo (CLAUDE.md): i file si chiamano per quello che contengono.
 * Niente database: gira nel browser, sui file che il detentore ha in mano. */
import type { RigaCompensazione } from '@/lib/compensazione-brt'
import { somiglianza, parole, type SpedizioneEsterna } from '@/lib/gestionali-esterni'

export type SpedizioneMoove = { numero: string; contrassegno: number; stato: string | null; statoContrassegno: string | null }
export type Destino = 'moove' | 'riferimento' | 'ldv' | 'sistemare'
export type EsitoContrassegno = {
  riga: RigaCompensazione
  destino: Destino
  moove?: SpedizioneMoove
  esterna?: SpedizioneEsterna
  motivo?: string               // perché è da sistemare
}

// I file da caricare negli altri gestionali, come li vogliono loro (foglio "Template", tutto testo, importo col
// punto): sono i due tracciati che Wave ha mandato il 02/11/2026.
export const FILE_CONTRASSEGNI = {
  riferimento: {
    descrizione: 'riferimento mittente, importo e destinatario',
    foglio: 'Template', colonne: ['mittente num.', 'Importo EUR', 'Destinatario'],
    riga: (e: EsitoContrassegno) => [e.riga.rifNumerico, e.riga.importo.toFixed(2), e.riga.destinatario],
  },
  ldv: {
    descrizione: 'lettera di vettura e importo',
    foglio: 'Template', colonne: ['LDV', 'ImportoCOD'],
    riga: (e: EsitoContrassegno) => [e.esterna!.ldv, e.riga.importo.toFixed(2)],
  },
}

// Giorni da una data "AAAA-MM-GG" o "GG/MM/AAAA".
const giorno = (s: string | undefined) => {
  const t = String(s || '')
  const a = t.match(/^(\d{4})-(\d{2})-(\d{2})/), b = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (a) return Date.UTC(+a[1], +a[2] - 1, +a[3]) / 864e5
  if (b) return Date.UTC(+b[3], +b[2] - 1, +b[1]) / 864e5
  return null
}
const euroTesto = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const dataTesto = (s: string) => s.split('-').reverse().join('/')

// Quanto si somigliano due nomi per intero: parole in comune su parole in tutto. `somiglianza` (parole in comune
// sulle parole del nome più corto) dice se può essere la stessa persona; questa sceglie fra due che possono.
const pariNome = (a: string, b: string) => {
  const A = parole(a), B = parole(b)
  let k = 0; for (const w of A) if (B.has(w)) k++
  return k / (A.size + B.size - k || 1)
}

// La data della compensazione è quella della spedizione BRT, cioè del ritiro. Nel gestionale la spedizione è
// stata creata quel giorno o prima: sull'export di Wave di ottobre (167 andate) da 0 a 10 giorni prima.
const FINESTRA_GIORNI = 10

export function destinaContrassegni(
  righe: RigaCompensazione[],
  moove: Record<string, SpedizioneMoove>,
  esterne: SpedizioneEsterna[],
): EsitoContrassegno[] {
  const usate = new Set<string>()
  return righe.map(riga => {
    const rif = riga.rifNumerico
    const m = rif ? moove[rif] : undefined
    if (m) return { riga, destino: 'moove' as const, moove: m }
    const cifre = /^\d+$/.test(rif) ? rif.length : 0
    if (cifre === 15) return { riga, destino: 'sistemare' as const,
      motivo: 'Il riferimento è come quelli di Moove, ma fra le spedizioni dei tuoi contratti BRT non c\'è.' }
    if (cifre >= 10) return { riga, destino: 'riferimento' as const }

    if (!esterne.length) return { riga, destino: 'sistemare' as const,
      motivo: 'Serve la lettera di vettura: carica l\'export spedizioni del gestionale che l\'ha creata.' }
    const d = giorno(riga.data)!
    const candidati = esterne.filter(s => !usate.has(s.ldv)
      && Math.abs(s.contrassegno - riga.importo) < 0.005
      && somiglianza(riga.destinatario, s.destinatario) >= 0.5
      && [s.data, s.dataRitiro].some(x => { const g = giorno(x); return g != null && g <= d && g >= d - FINESTRA_GIORNI }))
    // Fra più candidati vince il nome più uguale: sull'export di Wave di ottobre "FRANCESCA PELLICONE" trovava anche
    // Francesca Tomassini, e "LUISA PASSERO" anche Luisa Luisa, stesso importo e stesso giorno.
    const migliore = Math.max(...candidati.map(s => pariNome(riga.destinatario, s.destinatario)))
    const scelti = candidati.filter(s => pariNome(riga.destinatario, s.destinatario) >= migliore - 1e-9)
    if (scelti.length === 1) { usate.add(scelti[0].ldv); return { riga, destino: 'ldv' as const, esterna: scelti[0] } }
    // Se resta il pari sono due pacchi allo stesso destinatario con lo stesso contrassegno negli stessi giorni:
    // meglio dirlo che mettere nel file la lettera di vettura sbagliata.
    return { riga, destino: 'sistemare' as const, motivo: scelti.length > 1
      ? `Nell'export ci sono ${scelti.length} spedizioni a questo destinatario con ${euroTesto(riga.importo)} di contrassegno negli stessi giorni (${scelti.map(c => c.ldv).join(', ')}): scegli tu quale.`
      : `Nell'export non c'è una spedizione a questo destinatario con ${euroTesto(riga.importo)} di contrassegno, partita entro il ${dataTesto(riga.data)}.` }
  })
}
