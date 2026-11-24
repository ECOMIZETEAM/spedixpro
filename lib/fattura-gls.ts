/* LA FATTURA DI GLS, riga per riga. GLS Napoli (TEMI SPA) non manda un file come il TIVAF di BRT: manda
 * PDF, in due tracciati che si somigliano ma non sono uguali (letti su quelli di Wave, conto 280504):
 *
 *  - ALLEGATO della fattura (Allegato_NNNNN): il mese chiuso, un contratto. Ha la colonna "Info arrivo",
 *    l'ultima colonna si chiama "Serv.Agg,", sotto la riga GLS scrive il dettaglio delle varie ("Oversize
 *    15,00", "Zona ZTL 0,50", "Handling 0,14") e il carburante sta solo nel "Riepilogo servizi fatturati".
 *  - BORDERÒ settimanale (CLI_280504_BOF_…): niente Info arrivo, l'ultima colonna si chiama "Sprinter", il
 *    carburante è stampato per contratto ("Supp. Carburante"). È CUMULATIVO e RISCRITTO: quello del 23/11
 *    contiene tutte le righe di quello del 17/11 e ne cambia 336 (ripesature). Vale sempre l'ultimo.
 *
 * La colonna "Sprinter" del borderò e la "Serv.Agg," dell'allegato sono la STESSA colonna: i servizi
 * aggiuntivi. 1,00 € è l'Exchange (novembre: 55 spedizioni Moove su 55 con 1 € hanno l'Exchange chiesto);
 * 12/22/32/42 € li ha messi su 16 contrassegni senza servizi chiesti, e GLS non dice cosa sono.
 * "Sprinter" nella colonna Servizio è un'altra cosa: una classe interna di GLS, che sullo stesso contratto
 * cambia giorno per giorno e non cambia il prezzo.
 *
 * Wave paga GLS a CREDITO PREPAGATO: il totale del borderò è al centesimo quello che GLS scala dal credito
 * ("Spedizioni da addebitare" dell'avviso: 14.775,94 € il 23/11). Il borderò non è una bozza, sono soldi.
 *
 * Qui niente PDF e niente database: tipi, voci e la conversione nella riga del controllo fattura, così la
 * pagina (nel browser) e il controllo (sul server) leggono le righe allo stesso modo. Il PDF lo legge
 * lib/fattura-gls-pdf, solo sul server. */
import type { RigaFatturaBrt, SiglaBrt } from '@/lib/fattura-brt'

export type DettaglioGls = { nome: string; importo: number }

export type RigaGls = {
  contratto: string                 // codice contratto GLS (6160, 4724…)
  filiale: string                   // sigla della sede: è anche il prefisso del tracking (NI665645497)
  tipo: string                      // Partenze · Arrivo · Addebito (resi al mittente)
  servizio: string                  // Standard · Sprinter · Parcel
  data: string | null               // AAAA-MM-GG
  spedizione: string                // numero GLS nudo, 9 cifre
  tracking: string                  // filiale + numero: come lo salva Moove
  infoArrivo: string                // solo nell'allegato
  bda: string                       // il riferimento del mittente
  destinatario: string
  mittente: string
  localita: string                  // solo la località: GLS non stampa CAP né provincia
  colli: number
  pesoReale: number
  pesoVolume: number
  nolo: number
  assicurazione: number
  contrassegno: number
  varie: number
  servizi: number                   // "Serv.Agg," nell'allegato, "Sprinter" nel borderò
  dettagli: DettaglioGls[]          // le righe sotto la spedizione (solo allegato): cosa sono le varie
}

export type TotaliGls = { righe: number; colli: number; nolo: number; assicurazione: number; contrassegno: number; varie: number; servizi: number }

export type ContrattoGls = TotaliGls & {
  codice: string
  carburante: number | null             // stampato: "Supp. Carburante" (borderò) o "FUEL" del riepilogo (allegato)
  percentualeCarburante: number | null  // carburante / nolo, in percento (2,97 · 11,99)
  stampato: TotaliGls | null            // la riga "Totali Contratto" del PDF
  quadra: boolean                       // le righe lette sommano quanto stampato, voce per voce
}

export type LetturaGls = {
  tracciato: 'bordero' | 'allegato'
  cliente: string | null
  dal: string | null
  al: string | null
  contratti: ContrattoGls[]
  righe: RigaGls[]
  totaleCliente: number | null          // "Totali Cliente" del borderò, carburante compreso: quanto si scala dal credito
  errori: string[]
}

// La riga del controllo fattura: la stessa forma di quella BRT (la pagina, lo storico e la Rettifica la
// leggono così), più quello che serve solo a GLS.
export type RigaFatturaGls = RigaFatturaBrt & {
  corriere: 'gls'
  contratto: string
  servizio: string
  pesoVolume: number
  dettagli: DettaglioGls[]
  varie: number                         // anche fra le voci ("gls:varie"): qui a parte, per leggerle senza cercarle
  percentualeCarburante: number         // del contratto, dal PDF: la riga non lo stampa
}

export const eGls = (r: any): r is RigaFatturaGls => r?.corriere === 'gls'

// Le voci della riga GLS nel formato del controllo (sigla → nome). Le sigle BRT sono di un carattere: con il
// prefisso "gls:" non si possono confondere.
export const VOCI_GLS: Record<string, SiglaBrt> = {
  'gls:carburante': { nome: 'Carburante', categoria: 'carburante', certa: true },
  'gls:contrassegno': { nome: 'Diritto contrassegno', categoria: 'contrassegno', certa: true },
  'gls:assicurazione': { nome: 'Diritto assicurativo', categoria: 'servizio', certa: true },
  'gls:varie': { nome: 'Varie', categoria: 'altro', certa: false },
  'gls:servizi': { nome: 'Servizi aggiuntivi', categoria: 'servizio', certa: false },
}

const r2 = (n: number) => Math.round(n * 100) / 100
const it = (iso: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''

// Il numero con cui il documento va nello storico. Il borderò non ha numero: lo distingue la data di fine,
// e quello nuovo sostituisce il vecchio (è cumulativo). L'allegato è di un mese e di un contratto.
export function numeroDocumentoGls(l: Pick<LetturaGls, 'tracciato' | 'al' | 'contratti'>): string {
  const codici = l.contratti.map(c => c.codice).filter(Boolean).join('+')
  return `${l.tracciato === 'bordero' ? 'Borderò' : 'Allegato'} ${codici || 'GLS'} al ${it(l.al) || '?'}`
}

export const titoloDocumentoGls = (l: Pick<LetturaGls, 'tracciato' | 'dal' | 'al'>) =>
  `${l.tracciato === 'bordero' ? 'Borderò GLS' : 'Allegato fattura GLS'}${l.dal ? ` dal ${it(l.dal)}` : ''}${l.al ? ` al ${it(l.al)}` : ''}`

// Le righe viaggiano dal server al browser senza i campi vuoti: un borderò di fine mese (~6.000 righe) nel
// formato del controllo pesava 860 byte a riga, oltre i 4,5 MB che Vercel lascia a una risposta. Compatte
// sono ~300 byte; il browser le riallarga e le converte con righeControlloGls, la stessa funzione.
export const compattaRigheGls = (righe: RigaGls[]) => righe.map(r =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v !== 0 && v !== null && !(Array.isArray(v) && !v.length))) as Partial<RigaGls>)
export const espandiRigaGls = (x: Partial<RigaGls>): RigaGls => ({
  contratto: '', filiale: '', tipo: '', servizio: '', data: null, spedizione: '', tracking: '', infoArrivo: '', bda: '',
  destinatario: '', mittente: '', localita: '', colli: 0, pesoReale: 0, pesoVolume: 0,
  nolo: 0, assicurazione: 0, contrassegno: 0, varie: 0, servizi: 0, dettagli: [], ...x,
})

// Le righe del PDF come righe del controllo. Il carburante non è sulla riga: è una percentuale del nolo
// stampata per contratto, e qui si ripartisce sul nolo di ogni riga con quella percentuale.
export function righeControlloGls(l: Pick<LetturaGls, 'al' | 'cliente' | 'righe'> & { contratti: { codice: string; percentualeCarburante: number | null }[] }, numero: string): RigaFatturaGls[] {
  const pct = new Map(l.contratti.map(c => [c.codice, c.percentualeCarburante ?? 0]))
  return l.righe.map(r => {
    const p = pct.get(r.contratto) ?? 0
    // A quattro decimali, non al centesimo: arrotondata riga per riga, su 3.482 righe da 3,50 € la somma
    // perdeva 10 € rispetto al carburante stampato.
    const carburante = Math.round(r.nolo * p * 100) / 10000
    const voci = [
      { sigla: 'gls:carburante', importo: carburante },
      { sigla: 'gls:assicurazione', importo: r.assicurazione },
      { sigla: 'gls:contrassegno', importo: r.contrassegno },
      { sigla: 'gls:varie', importo: r.varie },
      { sigla: 'gls:servizi', importo: r.servizi },
    ].filter(v => Math.abs(v.importo) >= 0.005)
    const peso = Math.max(r.pesoReale, r.pesoVolume)
    return {
      corriere: 'gls' as const, contratto: r.contratto, servizio: r.servizio, pesoVolume: r.pesoVolume, dettagli: r.dettagli, varie: r.varie, percentualeCarburante: p,
      numeroFattura: numero, dataFattura: l.al, codiceCliente: l.cliente || '',
      tipoBolla: r.tipo,
      // Le partenze sono le andate. Arrivo (pacchi che arrivano al cliente, es. resi dai destinatari) e
      // Addebito (rientri al mittente) non si confrontano col nolo dell'andata.
      andata: r.tipo === 'Partenze',
      filialePartenza: r.filiale, numeroSerie: '', numeroSpedizione: r.spedizione, filialeArrivo: '',
      dataRitiro: r.data, colli: Math.max(1, r.colli),
      // GLS stampa il peso reale e quello volumetrico, e fa il prezzo sul maggiore (NI665712663: 1,4 kg
      // reali, 30,6 di volume, fascia fino a 35 kg). Niente arrotondamento come BRT: la fascia lo assorbe.
      pesoDichiarato: 0, pesoRilevato: r.pesoReale, volumeFatturare: 0, volumeRilevato: 0,
      pesoMisurato: peso, pesoTassato: peso,
      rifNumerico: '', rifAlfabetico: r.bda, segnacollo: r.tracking,
      cap: '', localita: r.localita, provincia: '', nazione: '',
      destinatario: r.destinatario, mittente: r.mittente, capMittente: '', mittenteOriginale: '',
      nolo: r.nolo, voci, altreVarie: 0,
      totale: Math.round((r.nolo + voci.reduce((s, v) => s + v.importo, 0)) * 10000) / 10000,
      quadra: true,
    }
  })
}

/* COSA È UNA VOCE GLS, e cosa farne. GLS sulla riga stampa solo l'importo: il nome c'è solo nell'allegato,
 * nelle righe di dettaglio. Quello che non si sa non si indovina: va "da chiarire con GLS", con l'elenco.
 *   clienti  → voce vera di GLS che in creazione non si sapeva: va girata a chi ha spedito
 *   chiarire → GLS non dice cos'è: Wave la chiede a GLS prima di pagarla o girarla
 *   listino  → il servizio c'è anche in Moove, ma con un costo diverso */
export type GruppoVoceGls = 'clienti' | 'chiarire' | 'listino'
export type VoceGls = { chiave: string; nome: string; gruppo: GruppoVoceGls; nota: string }

const euroIt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export function descriviVoceGls(colonna: 'varie' | 'servizi', importo: number, dettagli: DettaglioGls[], conExchange: boolean): VoceGls {
  if (colonna === 'servizi') {
    if (Math.abs(importo - 1) < 0.005 && conExchange) return { chiave: 'servizi:exchange', nome: 'Exchange (1,00 €)', gruppo: 'listino', nota: 'Exchange chiesto in Moove: GLS lo fa pagare 1,00 €.' }
    return { chiave: `servizi:${importo.toFixed(2)}`, nome: `Servizi aggiuntivi ${euroIt(importo)}`, gruppo: 'chiarire',
      nota: conExchange ? 'Exchange chiesto in Moove, ma GLS non chiede 1,00 €.' : 'Nessun servizio chiesto in Moove e GLS non dice cos\'è.' }
  }
  // Varie: il nome dal dettaglio dell'allegato, se c'è.
  const conNome = dettagli.filter(d => d.nome && Math.abs(d.importo) >= 0.005)
  if (conNome.length) {
    const nome = conNome.map(d => d.nome).join(' + ')
    const handling = conNome.every(d => /handling/i.test(d.nome))
    return { chiave: `varie:${nome.toLowerCase()}`, nome, gruppo: handling ? 'chiarire' : 'clienti',
      nota: handling ? 'GLS la chiama Handling: chiedere a cosa si riferisce.' : 'Voce scritta da GLS nel dettaglio della fattura: in creazione non si sapeva, va girata a chi ha spedito.' }
  }
  // La Zona ZTL è l'unica varia che l'allegato di ottobre nomina con quell'importo (0,50 €).
  if (Math.abs(importo - 0.5) < 0.005) return { chiave: 'varie:0.50', nome: 'Varie 0,50 € (Zona ZTL)', gruppo: 'clienti', nota: 'Nell\'allegato di ottobre GLS chiama "Zona ZTL" le varie da 0,50 €.' }
  // Le piccole (0,10-0,30 €) secondo Wave sono SMS al destinatario, ma GLS non lo scrive (24/11).
  if (importo < 0.5) return { chiave: `varie:${importo.toFixed(2)}`, nome: `Varie ${euroIt(importo)}`, gruppo: 'chiarire', nota: 'Forse avvisi SMS, ma GLS non lo scrive: chiedi quali sono SMS e quali altro.' }
  return { chiave: `varie:${importo.toFixed(2)}`, nome: `Varie ${euroIt(importo)}`, gruppo: 'chiarire', nota: 'GLS non dice cos\'è: guarda le località.' }
}
