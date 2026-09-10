// Mapping/parse del tracking POSTE (usato sia dal ripiego pubblico bonifica-poste sia dal backfill
// OneTracking dell'harvester tracking). Un posto solo: la regola che decide lo stato non va duplicata.
import { testoIndicaReso } from '@/lib/spedisci'
import { istanteDaTesto } from '@/lib/tracking-eventi'

// Frase Poste → stato interno. Ordine importante: 'mancata/non consegnata' prima di 'consegnata',
// e la regola RESO è quella blindata (testoIndicaReso), per non prendere per reso una consegna.
export function mappaStatoPoste(testo: string): string | null {
  const t = (testo || '').toLowerCase()
  if (!t) return null
  if (t.includes('non consegnat') || t.includes('mancata') || t.includes('tentativo di consegna')) return 'non_consegnato'
  if (t.includes('consegnat')) return 'consegnata'
  if (t.includes('giacenz')) return 'in_giacenza'
  if (testoIndicaReso(t)) return 'reso_mittente'
  if (t.includes('in consegna')) return 'in_consegna'
  if (t.includes('transito') || t.includes('arrivat') || t.includes('partit') || t.includes('smistament') || t.includes('in lavorazione')) return 'in_transito'
  if (t.includes('presa in carico') || t.includes('preso in caric') || t.includes('accettat') || t.includes('spedit')) return 'spedita'
  return null
}

// "27/07/2026 15:45" (ora italiana) → istante vero. La conversione la fa la regola condivisa, che
// guarda l'ISTANTE e non il mese: l'ultima domenica di ottobre l'offset cambia a metà giornata e una
// tabella per mesi sbaglierebbe di un'ora tutti gli eventi di quella settimana.
export function parseDataPoste(s: string): string {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  if (!m) return new Date().toISOString()
  return istanteDaTesto(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`) || new Date().toISOString()
}

export interface EventoTracking { stato: string | null; descrizione: string; luogo: string | null; data_evento: string }

// ═══════════════════════════════════════════════════════════════════════════════════════
// ONETRACKING: LA DESCRIZIONE NON ARRIVA PRONTA, VA SCRITTA QUI
//
// Il full-tracking non porta la frase per il cliente: su tutte le LDV PDB `descrCodice`,
// `descStatoSintesi` e `note` arrivano a "-". Leggendo quei campi il backfill del 9-10/09/2026 ha
// scritto 26.000 eventi con descrizione "-": è esattamente quello che il destinatario si è trovato
// nel popup del tracking e nel link pubblico. La frase VERA è l'etichetta in `stato` (MAIUSCOLO,
// gergo di filiale) — qui la si traduce in italiano leggibile, una volta sola per tutte le porte.
// ═══════════════════════════════════════════════════════════════════════════════════════

const valore = (v: any): string => {
  const s = String(v ?? '').trim()
  // OneTracking riempie i campi vuoti con "-": è un segnaposto, non un contenuto.
  return (!s || s === '-' || s === '--' || s.toUpperCase() === 'N/D') ? '' : s
}
const chiave = (v: any): string => valore(v).toUpperCase().replace(/\s+/g, ' ')

// MAIUSCOLO di filiale → frase leggibile. Ripiego per le etichette non ancora viste: minuscolo con
// l'iniziale grande ("AFFIDATA AL CORRIERE" → "Affidata al corriere"), che resta preciso perché è
// comunque la parola di Poste — mai una frase inventata.
function frasePulita(s: string): string {
  const t = valore(s).toLowerCase().replace(/\s+/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

const FRASI: Record<string, string> = {
  'RITIRATA PRESSO MITTENTE': 'Ritirata presso il mittente',
  'ACCETTATA PRESSO FILIALE': 'Accettata in filiale',
  'ARRIVATA AL CENTRO DI SMISTAMENTO': 'Arrivata al centro di smistamento',
  'PARTENZA SPEDIZIONE DA CENTRO DI SMISTAMENTO': 'Partita dal centro di smistamento',
  'IN LAVORAZIONE SU CENTRO DI SMISTAMENTO': 'In lavorazione al centro di smistamento',
  'NUOVA REGISTRAZIONE SU CENTRO DI SMISTAMENTO': 'Registrata al centro di smistamento',
  'INOLTRATA AL CENTRO DI SMISTAMENTO': 'Inoltrata al centro di smistamento',
  'SMISTATA HUB ED INOLTRATA': 'Smistata e inoltrata verso la destinazione',
  'REGISTRATA HUB AUTOMATICO': 'Registrata allo smistamento automatico',
  'PARTITA': 'Partita verso la destinazione',
  'PARTITA VIRTUALE': 'Partenza registrata (movimentazione interna)',
  'ARRIVATA NON A GIRO': 'Arrivata in filiale, non ancora affidata al corriere',
  'PROCESSATA PRESSO FILIALE DI CONSEGNA': 'In lavorazione presso la filiale di consegna',
  'AFFIDATA AL CORRIERE LA MATTINA': 'Affidata al corriere per la consegna (mattina)',
  'AFFIDATA AL CORRIERE NEL POMERIGGIO': 'Affidata al corriere per la consegna (pomeriggio)',
  'CONSEGNATA': 'Consegnata',
  'NON CONSEGNATA DESTINATARIO ASSENTE': 'Consegna non riuscita: destinatario assente',
  'NON CONSEGNATA INDIRIZZO ERRATO/INCOMPLETO': 'Consegna non riuscita: indirizzo errato o incompleto',
  'NON CONSEGNATA CHIUSURA SETTIMANALE': 'Consegna non effettuata: destinatario chiuso',
  'RIFIUTATA DAL DESTINATARIO': 'Rifiutata dal destinatario',
  'INIZIO GIACENZA': 'Entrata in giacenza',
  'DISPONIBILE AL RITIRO PRESSO FERMO DEPOSITO': 'Disponibile per il ritiro presso il punto di giacenza',
  'GIACENZA SEZIONE ABBANDONATI': 'In giacenza da tempo: in attesa di istruzioni',
  'SPEDIZIONE ABBANDONATA': 'Spedizione ferma in deposito: in attesa di istruzioni',
  'ATTESA AZIONE DI SVINCOLO': 'In attesa di istruzioni per lo svincolo',
  'SVINCOLATA': 'Svincolata: rimessa in consegna',
  'BLOCCO SERVIZIO': 'Spedizione temporaneamente bloccata',
  'SMALTITA': 'Spedizione smaltita',
  'MULTICOLLO IN ATTESA DI COMPLETAMENTO': 'Multicollo: in attesa degli altri colli',
  'NON USCITA': 'Non uscita in consegna',
  'LETTERA VETTURA ERRATA IN FASE DI SMISTAMENTO': 'Etichetta illeggibile o errata in smistamento',
  'ANNULLA STATUS PRECEDENTE': 'Annullato l\'aggiornamento precedente',
  'TENTATIVO TELEFONATA': 'Tentativo di contatto telefonico',
  'RESA AL MITTENTE': 'Resa al mittente',
}

// Le righe "FULL TRACKING" sono le letture automatiche dell'impianto: l'etichetta è sempre uguale e
// non dice niente, la cosa avvenuta sta in `azione`.
const FRASI_AZIONE: Record<string, string> = {
  'RICEZIONE': 'Ricevuta nell\'impianto di smistamento',
  'AVVIAMENTO': 'Avviata verso la destinazione',
  'ASSOCIAZIONE': 'Caricata sull\'unità di trasporto',
  'BLOCCO SERVIZI': 'Blocco servizi registrato',
  'SBLOCCO SERVIZI': 'Sblocco servizi registrato',
}

// L'evento di OneTracking → la frase che legge il destinatario.
export function descrizioneEventoOT(e: any): string {
  const etichetta = chiave(e?.stato)
  const azione = valore(e?.azione)
  let frase = ''
  if (etichetta && etichetta !== 'FULL TRACKING') frase = FRASI[etichetta] || frasePulita(etichetta)
  if (!frase && azione) frase = FRASI_AZIONE[chiave(azione)] || frasePulita(azione)
  // Ultime spiagge: il campo descrittivo (di norma vuoto) e il "box", il raggruppamento di Poste.
  if (!frase) frase = frasePulita(valore(e?.descrCodice) || valore(e?.descStatoSintesi) || valore(e?.box))
  if (!frase) return ''
  // La firma sulla consegna è il dato che chiude ogni contestazione: va nella riga, non persa.
  const firma = valore(e?.firma)
  if (firma && /consegnat/i.test(frase)) frase += ` (firma: ${frasePulita(firma)})`
  // Le note sono quasi sempre id interni di lavorazione (solo cifre): si tiene solo quella che parla.
  const nota = valore(e?.note)
  if (nota && /[a-z]/i.test(nota) && nota.length <= 60) frase += ` — ${nota}`
  return frase.slice(0, 300)
}

// Il raggruppamento che Poste stessa mostra in testa alla riga: è la fonte più affidabile quando
// l'etichetta è gergo puro ("AFFIDATA AL CORRIERE LA MATTINA" non contiene "in consegna").
const STATO_DA_BOX: Record<string, string | null> = {
  'CONSEGNATA': 'consegnata',
  'RESA AL MITTENTE': 'reso_mittente',
  'IN CONSEGNA': 'in_consegna',
  'IN TRANSITO': 'in_transito',
  'PRESA IN CARICO': 'spedita',
  'GIACENZA': 'in_giacenza',
  'INTERNA': null,     // movimentazioni di impianto: raccontano, non fanno avanzare
}

// Codici che il testo non saprebbe leggere: 007 è il rifiuto del destinatario (Poste lo lascia nel
// box "IN TRANSITO", ma per noi è una consegna non riuscita — è quella che apre il reso).
const STATO_DA_ID: Record<string, string> = { '007': 'non_consegnato' }

export function statoDaEventoOT(e: any): string | null {
  const id = chiave(e?.idStatus)
  if (STATO_DA_ID[id]) return STATO_DA_ID[id]
  // Le `note` restano FUORI dal testo che decide lo stato: contengono LDV e id di lavorazione, e una
  // parola letta lì dentro sposterebbe uno stato per sbaglio.
  const daTesto = mappaStatoPoste([valore(e?.stato), valore(e?.descrCodice), valore(e?.descStatoSintesi)].filter(Boolean).join(' '))
  if (daTesto) return daTesto
  const box = chiave(e?.box)
  return box in STATO_DA_BOX ? STATO_DA_BOX[box] : null
}

// "00898 Torino 2" → "Torino 2": il codice della filiale è gergo interno, al destinatario serve il posto.
function luogoEvento(v: any): string | null {
  const s = valore(v).replace(/^\d{3,6}\s+/, '').trim()
  return s ? s.slice(0, 200) : null
}

// Array `tracking` del full-tracking OneTracking → eventi normalizzati per tracking_events.
export function eventiDaFullTracking(tracking: any[]): EventoTracking[] {
  const visti = new Set<string>()
  const eventi: EventoTracking[] = []
  for (const e of (Array.isArray(tracking) ? tracking : [])) {
    const descrizione = descrizioneEventoOT(e)
    if (!descrizione) continue
    const luogo = luogoEvento(e?.filialeResp)
    const data_evento = parseDataPoste(e?.data)
    // OneTracking ripete la stessa riga quando il collo passa due volte sotto lo stesso lettore:
    // nel popup del cliente diventerebbero due eventi identici allo stesso minuto.
    const id = `${data_evento}|${descrizione}|${luogo || ''}`
    if (visti.has(id)) continue
    visti.add(id)
    eventi.push({ stato: statoDaEventoOT(e), descrizione, luogo, data_evento })
  }
  return eventi
}
