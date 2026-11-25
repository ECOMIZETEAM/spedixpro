// IL CALENDARIO (Lorenzo 25/11/2026: «dentro a moove vorrei un calendario dove segnarti promemoria, eventi, riunioni,
// come Google Calendar»). Due famiglie di voci:
//  - le TUE: promemoria, eventi, riunioni. Le scrivi tu, le modifichi tu; un promemoria può essere attaccato a una
//    spedizione («ricordamelo giovedì») e da lì si torna alla spedizione con un clic;
//  - quelle AUTOMATICHE: ritiri prenotati e giacenze da gestire. Non si scrivono: si leggono dai dati veri, quindi
//    un ritiro spostato si sposta anche qui e non esistono due versioni che si contraddicono.

import type { Ricorrenza } from '@/lib/calendario-ricorrenza'
export type { Ricorrenza }

export type TipoMio = 'promemoria' | 'evento' | 'riunione'
export type TipoAuto = 'ritiro' | 'giacenza'
export type Tipo = TipoMio | TipoAuto

// a cosa è attaccato un promemoria (per ora la spedizione; poi cliente e ticket)
export type Collegamento = { tipo: 'spedizione'; id: string; etichetta: string }

export type Invitato = { utente_id: string; nome: string; ruolo: string; stato: StatoInvito }
export type StatoInvito = 'in_attesa' | 'accettato' | 'rifiutato'

// una voce del calendario di chi guarda: scritta da lui, o a cui è invitato. Per quelle che si ripetono il server
// manda una voce per occorrenza: inizio e fine sono quelli dell'occorrenza, serie_inizio e serie_fine quelli della serie
export type EventoMio = {
  id: string
  tipo: TipoMio
  titolo: string
  inizio: string            // ISO; per «tutto il giorno» è la mezzanotte del giorno, ora locale
  fine: string | null       // ISO; null = promemoria puntuale
  tutto_il_giorno: boolean
  luogo: string | null
  note: string | null
  avviso_minuti: number | null   // quanto prima avvisare; null = nessun avviso
  collegamento: Collegamento | null
  fatto: boolean
  creato_il: string
  ricorrenza?: Ricorrenza | null
  occorrenza?: string | null      // il giorno dell'occorrenza ('YYYY-MM-DD') per le voci che si ripetono
  serie_inizio?: string
  serie_fine?: string | null
  ruolo?: 'mio' | 'invitato'
  invito?: { stato: StatoInvito; organizzatore: string }   // a cui sono invitato
  invitati?: Invitato[]                                    // che ho organizzato io
}

// un ritiro prenotato, come lo mostra l'Elenco Ritiri (solo i campi che servono qui, niente importi)
export type RitiroCal = {
  id: string; giorno: string; stato: string; codice: string | null
  colli: number | null; peso: number | null
  mittente: string | null; citta: string | null; provincia: string | null
  cliente: string | null; contratto: string | null
}

// una giacenza aperta (entrata in giacenza e non ancora gestita)
export type GiacenzaCal = {
  id: string; giorno: string; numero: string | null; tracking: string | null
  destinatario: string | null; citta: string | null; provincia: string | null
  motivo: string | null; cliente: string | null; contratto: string | null
}

// la voce come la disegna il calendario: le tue e le automatiche nella stessa forma
export type Voce = {
  chiave: string
  tipo: Tipo
  titolo: string
  sotto: string | null
  inizio: Date
  fine: Date | null
  tuttoIlGiorno: boolean
  fatto: boolean
  mio: EventoMio | null          // la voce scritta da te (si modifica)
  ritiri: RitiroCal[] | null     // uno o più ritiri dello stesso giorno (raggruppati quando sono tanti)
  giacenze: GiacenzaCal[] | null
}

export const NOME_TIPO: Record<Tipo, string> = {
  promemoria: 'Promemoria', evento: 'Evento', riunione: 'Riunione', ritiro: 'Ritiro', giacenza: 'Giacenza',
}

// i filtri della barra laterale: ognuno accende o spegne una famiglia di voci
export type Filtri = { miei: boolean; ritiri: boolean; giacenze: boolean }

export const AVVISI: { v: number | null; l: string }[] = [
  { v: null, l: 'Nessun avviso' },
  { v: 0, l: 'All’ora indicata' },
  { v: 10, l: '10 minuti prima' },
  { v: 30, l: '30 minuti prima' },
  { v: 60, l: '1 ora prima' },
  { v: 60 * 24, l: 'Il giorno prima' },
]

// gli stati del ritiro con le parole dell'Elenco Ritiri (lib/ritiro-vista), senza i colori di oggi
export const STATO_RITIRO: Record<string, string> = {
  richiesto: 'Richiesto', prenotato: 'In lavorazione', confermato: 'Confermato dal corriere', rimandato: 'Rimandato',
  ritirato: 'Ritirato', annullato: 'Annullato', annullato_corriere: 'Annullato dal corriere', errore: 'Rifiutato dal corriere',
  elaborato: 'Elaborato', completato: 'Completato',
}
// per le somme di un gruppo: «36 ritirati», non «36 ritirato»
export const STATO_RITIRO_PLURALE: Record<string, string> = {
  richiesto: 'richiesti', prenotato: 'in lavorazione', confermato: 'confermati dal corriere', rimandato: 'rimandati',
  ritirato: 'ritirati', annullato: 'annullati', annullato_corriere: 'annullati dal corriere', errore: 'rifiutati dal corriere',
  elaborato: 'elaborati', completato: 'completati',
}
// l'ordine nell'elenco di un giorno: prima quelli ancora da fare, poi quelli andati male, in fondo quelli fatti
export const ORDINE_STATO_RITIRO: Record<string, number> = {
  richiesto: 0, rimandato: 1, prenotato: 2, confermato: 3, errore: 4, annullato_corriere: 5, annullato: 6, ritirato: 7, elaborato: 8, completato: 9,
}
export const RITIRO_CHIUSO = new Set(['ritirato', 'elaborato', 'completato'])
export const RITIRO_FALLITO = new Set(['annullato', 'annullato_corriere', 'errore'])
