/* LA FATTURA DI BRT, riga per riga: il file "TIVAF" che BRT manda col dettaglio della fattura.
 *
 * Formato verificato su tre fatture vere di Wave (maggio, giugno, luglio 2026; 3.120 righe): CSV con `;`,
 * testo in ISO-8859-1, prima riga d'intestazione, 69 colonne. Le colonne si leggono per NOME e non per
 * posizione: se BRT ne aggiunge una in mezzo, una lettura per posizione sposterebbe il peso nel volume
 * senza dare errori.
 *
 * Ogni riga è una spedizione: IMPONIBILE IVA = PORTO (il nolo) + VARIA 1..8 + CUMULATIVO ALTRE VARIE,
 * al centesimo su tutte le 3.120 righe. Le voci extra arrivano come coppie SIGLA/importo (vedi SIGLE_BRT).
 *
 * Qui solo la lettura: niente database, così la stessa funzione gira nel browser (anteprima) e sul server
 * (abbinamento e addebito) e le due non possono leggere lo stesso file in due modi diversi. */
import Papa from 'papaparse'

// Peso volumetrico BRT: 200 kg per metro cubo (= divisore 5000 in cm). È il fattore con cui BRT tassa
// "VOLUME DA FATTURARE" e "VOLUME RILEVATO"; le fatture lo confermano (materasso 0,181 m³ → 36,2 kg).
export const KG_PER_M3_BRT = 200

// Il peso su cui BRT fa il prezzo è il più alto dei quattro, ARROTONDATO: al chilo in su fino a 100 kg, ai
// 50 kg in su oltre (106 → 150, 280 → 300). È la colonna "PESO TASS." del PDF della fattura: 11.630 righe su
// 11.630 in 24 fatture di Wave (maggio-ottobre 2026). Senza arrotondare si mandava in rettifica 7,2 kg dove
// BRT ne aveva tassati 8.
export function pesoTassatoBrt(kg: number): number {
  const x = kg - 1e-9   // 110.00000000000001 viene dal prodotto volume × 200: è 110, non 110 e un pelo
  return kg <= 100 + 1e-9 ? Math.ceil(x) : Math.ceil(x / 50) * 50
}

export type VoceFattura = { sigla: string; importo: number }

export type RigaFatturaBrt = {
  numeroFattura: string
  dataFattura: string | null       // AAAA-MM-GG
  codiceCliente: string
  tipoBolla: string                // F1 andata; A2/A3/F3 rientri e bolle accessorie
  andata: boolean
  filialePartenza: string
  numeroSerie: string
  numeroSpedizione: string
  filialeArrivo: string
  dataRitiro: string | null
  colli: number
  pesoDichiarato: number           // PESO BOLLETTATO: quello mandato in creazione
  pesoRilevato: number             // solo se BRT ha pesato il pacco
  volumeFatturare: number          // m³
  volumeRilevato: number           // m³, solo se BRT l'ha misurato
  pesoMisurato: number             // il più alto dei quattro (volumi × 200), prima dell'arrotondamento
  pesoTassato: number              // pesoMisurato arrotondato come BRT (pesoTassatoBrt): il peso su cui fa il prezzo
  rifNumerico: string              // RIFERIM.MITTENTE NUMERICO = numericSenderReference della creazione
  rifAlfabetico: string
  segnacollo: string
  cap: string
  localita: string
  provincia: string
  nazione: string
  destinatario: string
  mittente: string                 // RAGIONE SOCIALE MITTENTE (sui rientri è il destinatario dell'andata)
  capMittente: string              // sul reso è il CAP di chi ha ricevuto l'andata: serve a ritrovarla
  mittenteOriginale: string
  nolo: number                     // PORTO
  voci: VoceFattura[]
  altreVarie: number               // CUMULATIVO ALTRE VARIE
  totale: number                   // IMPONIBILE IVA
  quadra: boolean                  // totale = nolo + voci + altre varie (al centesimo)
}

export type LetturaFatturaBrt = { righe: RigaFatturaBrt[]; errori: string[] }

// Le colonne che servono. Se ne manca una, il file non è un TIVAF (o BRT l'ha cambiato): meglio fermarsi
// che leggere zeri.
const OBBLIGATORIE = [
  'NUMERO FATTURA', 'DATA FATTURA (AMG)', 'TIPO BOLLA', 'NUMERO SPED.', 'PESO BOLLETTATO IN KG.',
  'VOLUME DA FATTURARE', 'PORTO', 'IMPONIBILE IVA', 'RIFERIM.MITTENTE NUMERICO', 'CAP DESTINATARIO',
  'PROVINCIA DESTINATARIO', 'PESO RILEVATO IN KG.', 'VOLUME RILEVATO', 'SEGNAC.',
]

// Numeri all'italiana ("13,700"). Vuoto = 0.
const num = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}
const amg = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}

// Il file arriva in ISO-8859-1: chi lo legge dal disco deve decodificarlo così (TextDecoder('latin1') nel
// browser, Buffer.toString('latin1') sul server), altrimenti le accentate dei destinatari si rompono.
export function leggiFatturaBrt(testo: string): LetturaFatturaBrt {
  const errori: string[] = []
  const p = Papa.parse<string[]>(testo.replace(/^﻿/, ''), { delimiter: ';', skipEmptyLines: true })
  const tabella = (p.data || []) as string[][]
  if (tabella.length < 2) return { righe: [], errori: ['Il file è vuoto o non ha righe di spedizione.'] }
  const intest = tabella[0].map(h => String(h || '').trim().toUpperCase())
  const mancanti = OBBLIGATORIE.filter(c => !intest.includes(c))
  if (mancanti.length) return { righe: [], errori: [`Non sembra una fattura BRT (TIVAF): mancano le colonne ${mancanti.join(', ')}.`] }
  const idx = new Map(intest.map((h, i) => [h, i] as const))
  const righe: RigaFatturaBrt[] = []
  for (let r = 1; r < tabella.length; r++) {
    const cella = tabella[r]
    if (!cella || cella.length < OBBLIGATORIE.length) continue
    const v = (nome: string) => { const i = idx.get(nome); return i === undefined ? '' : String(cella[i] ?? '').trim() }
    const voci: VoceFattura[] = []
    for (let k = 1; k <= 8; k++) {
      const sigla = v(`SIGLA VARIA ${k}`)
      const importo = num(v(`VARIA ${k}`))
      if (sigla || importo) voci.push({ sigla, importo })
    }
    const pesoDichiarato = num(v('PESO BOLLETTATO IN KG.'))
    const pesoRilevato = num(v('PESO RILEVATO IN KG.'))
    const volumeFatturare = num(v('VOLUME DA FATTURARE'))
    const volumeRilevato = num(v('VOLUME RILEVATO'))
    const nolo = num(v('PORTO'))
    const altreVarie = num(v('CUMULATIVO ALTRE VARIE'))
    const totale = num(v('IMPONIBILE IVA'))
    const tipoBolla = v('TIPO BOLLA').toUpperCase()
    righe.push({
      numeroFattura: v('NUMERO FATTURA'),
      dataFattura: amg(v('DATA FATTURA (AMG)')),
      codiceCliente: v('CODICE CLIENTE'),
      tipoBolla,
      // F1 è la bolla di andata. A2 (e A3) sono i rientri al mittente, F3 bolle accessorie della filiale:
      // nelle fatture vere hanno porto 0 o voci proprie, e non vanno confrontate col listino dell'andata.
      andata: tipoBolla === 'F1',
      filialePartenza: v('FIL. PARTENZA'),
      numeroSerie: v('NUMERO SERIE'),
      numeroSpedizione: v('NUMERO SPED.'),
      filialeArrivo: v('FIL. ARRIVO'),
      dataRitiro: amg(v('DATA RITIRO (AMG)')),
      colli: Math.max(1, Math.round(num(v('NUMERO COLLI')))),
      pesoDichiarato, pesoRilevato, volumeFatturare, volumeRilevato,
      pesoMisurato: Math.max(pesoDichiarato, pesoRilevato, volumeFatturare * KG_PER_M3_BRT, volumeRilevato * KG_PER_M3_BRT),
      pesoTassato: pesoTassatoBrt(Math.max(pesoDichiarato, pesoRilevato, volumeFatturare * KG_PER_M3_BRT, volumeRilevato * KG_PER_M3_BRT)),
      rifNumerico: v('RIFERIM.MITTENTE NUMERICO').replace(/^0+(?=\d)/, ''),
      rifAlfabetico: v('RIFERIM.MITTENTE ALFABETICO'),
      segnacollo: v('SEGNAC.'),
      cap: v('CAP DESTINATARIO'),
      localita: v('LOCALITA DESTINATARIO'),
      provincia: v('PROVINCIA DESTINATARIO').toUpperCase(),
      nazione: v('NAZIONE DESTINATARIO').toUpperCase() || 'IT',
      destinatario: v('RAGIONE SOCIALE DESTINAT.'),
      mittente: v('RAGIONE SOCIALE MITTENTE'),
      capMittente: v('CAP MITTENTE'),
      mittenteOriginale: v('RAG.SOC. MITTENTE ORIGINALE'),
      nolo, voci, altreVarie, totale,
      // BRT scrive le voci a tre decimali (0,665): si confronta la somma esatta, non i due importi già
      // arrotondati al centesimo, che su 14,445 contro 14,44499… davano un centesimo di differenza finto.
      quadra: Math.abs(nolo + voci.reduce((s, x) => s + x.importo, 0) + altreVarie - totale) < 0.005,
    })
  }
  const storte = righe.filter(x => !x.quadra).length
  if (storte) errori.push(`${storte} righe non quadrano (nolo + voci ≠ imponibile): controllale prima di addebitare.`)
  return { righe, errori }
}

/* LE SIGLE DELLE VOCI EXTRA. Il file non le spiega, il PDF della fattura sì: in fondo all'ultima pagina BRT
 * stampa la legenda delle sigle usate in quella fattura ("I=SP.GIACENZ f=FUEL SURCH G=COMP.ASSEG…"). Qui c'è
 * l'unione delle legende di 26 fatture di Wave (maggio-ottobre 2026, conti 2802246 e 677742), con accanto
 * quello che i numeri confermano. Una legenda trovata in rete (28/10) dava "f = fuori misura" e "i = giacenza":
 * era sbagliata, e anche la nostra prima lettura della "i" (ingombro) lo era.
 * Le minuscole e le maiuscole sono sigle DIVERSE (g ≠ G, i ≠ I). */
export type CategoriaVoce = 'carburante' | 'contrassegno' | 'isole' | 'ingombro' | 'servizio' | 'rientro' | 'altro'
// `voceListino`: la voce dei supplementi del corriere (lib/supplementi-corriere) che la rappresenta nel
// listino del detentore. Se lì c'è un prezzo, la voce è prevista e va girata al cliente; se no, manca.
export type SiglaBrt = { nome: string; categoria: CategoriaVoce; certa: boolean; voceListino?: string }
export const SIGLE_BRT: Record<string, SiglaBrt> = {
  // FUEL SURCH. Una percentuale fissa (8% a giugno, 12,5% a ottobre) del nolo e dei supplementi, mai del contrassegno.
  f: { nome: 'Carburante', categoria: 'carburante', certa: true },
  // COMP.ASSEG. Max(1,29 €; 1,5% dell'incassato): 86 righe su 86 (importi incassati dall'export del gestionale).
  G: { nome: 'Contrassegno', categoria: 'contrassegno', certa: true },
  // TRAGHETTI. Solo Sicilia e Sardegna, su un conto (2802246); sull'altro (677742) le isole stanno nel nolo.
  g: { nome: 'Traghetti (Sicilia e Sardegna)', categoria: 'isole', certa: true },
  // ISOLA. Solo dove BRT segna TIPO INOLTRO "I": isole minori, Venezia.
  J: { nome: 'Isole minori', categoria: 'isole', certa: true },
  // COLLI INCO: colli INCOMPATIBILI con lo smistamento automatico (guida BRT "Fuori misura e incompatibili":
  // buste, sacchi, cilindri, forme irregolari), spostati a mano. Sui materassi 6,90 €, su buste da 1 kg 2,90 €.
  i: { nome: 'Colli incompatibili', categoria: 'ingombro', certa: true, voceListino: 'Incompatibile' },
  // FUORI MISU. Il fuori misura vero (per BRT un lato oltre 300 cm): 40 €, su colli da 0,7 a 1,2 m³.
  F: { nome: 'Fuori misura', categoria: 'ingombro', certa: true, voceListino: 'Fuori misura' },
  // SP.GIACENZ. Solo su resi (A2) e bolle accessorie (F3) di pacchi andati in giacenza.
  I: { nome: 'Spese di giacenza', categoria: 'rientro', certa: true },
  // ZTL. Solo dove BRT segna TIPO INOLTRO "T" o "Z" (38 righe su 38).
  Q: { nome: 'ZTL', categoria: 'altro', certa: true },
  // APPUNTAMEN. 3% del nolo; ha il codice "A" in 1 CONSEGNA PARTICOLARE: è un servizio chiesto in creazione.
  A: { nome: 'Consegna su appuntamento', categoria: 'servizio', certa: true },
  // SUPER./GDO. 10 €; codice "S" in 1 CONSEGNA PARTICOLARE: anche questo un servizio con codice.
  S: { nome: 'Consegna GDO', categoria: 'servizio', certa: true },
  // A.C. PLUS. Solo con IMPORTO DA ASSICURARE: 0,6% del valore, minimo 2 € (700 → 4,20; 169 → 2,00).
  R: { nome: 'Assicurazione', categoria: 'servizio', certa: true },
  // RITIRO.
  U: { nome: 'Ritiro', categoria: 'servizio', certa: true },
  // DIROTTAM.T. 4 € su bolle A3.
  '*': { nome: 'Dirottamento', categoria: 'altro', certa: true },
}

export function descriviVoce(sigla: string): SiglaBrt {
  return SIGLE_BRT[sigla] || { nome: `Voce "${sigla}" sconosciuta`, categoria: 'altro', certa: false }
}
