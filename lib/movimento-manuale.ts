// I MOVIMENTI SCRITTI A MANO DAL MASTER: CHE COSA SONO.
//
// Il modulo della scheda cliente e della scheda sotto-master chiedeva solo importo e descrizione. La descrizione
// arrivava gia' scritta («Accredito credito a scalare») e il tipo lo decideva il segno: col piu' una 'ricarica',
// col meno una 'rettifica'. Dal 27/8 al 24/11/2026 i master ne hanno scritti 14.816 e l'87% ha lasciato il testo
// precompilato, quindi di quasi tutti non si sapeva cosa fossero. E il guadagno li contava a caso. A novembre
// Wave risultava a −24.514 € perche' il calcolo prendeva per costi d'acquisto 51.554,78 € di movimenti di credito
// scritti da LOGIXIA: un saldo fattura da 30.000, il rimborso di una ricarica da 20.000, uno storno di
// contrassegni. Erano tutti salvati come 'rettifica'.
//
// Ora chi scrive il movimento sceglie la voce (Lorenzo, 24/11) e la voce resta sul movimento. E' la voce a dire
// se il movimento entra nel guadagno, in quale report finisce e se il Check Ricariche deve aspettare un bonifico.
// Le voci vengono da quello che i master scrivevano davvero in quei 90 giorni. Lo storico resta com'e', perche'
// Lorenzo ha detto: «lascerei quello che fino ad oggi hanno scritto e fatto così come è». I movimenti di prima
// non hanno voce.
//
// IL TIPO RESTA QUELLO CHE I REPORT GIA' CONOSCONO, cosi' nessuna pagina che oggi legge i movimenti cambia
// comportamento:
// - le voci su una spedizione hanno il tipo del loro report (giacenza, rettifica, reso, rimborso) e la spedizione
//   collegata, cosi' entrano nel Report Giacenze, Rettifiche o Resi, che il numero scritto nel testo non lo vedeva;
// - i costi del master (spedizione fuori dal portale, compenso agente, bonus) sono 'rettifica', che il guadagno
//   conta gia';
// - i soldi tra le parti restano 'ricarica' col piu' e 'rettifica' col meno, come prima: a toglierli dal
//   guadagno e' la voce, non il tipo.
//
// Le stesse regole valgono nella pagina (app/components/VoceMovimento.tsx) e nel server (app/api/movimenti/crea).

import type { TipoMovimento } from '@/lib/movimenti'

export type IdVoce =
  | 'ricarica' | 'fattura' | 'contrassegni' | 'trasferimento' | 'storno' | 'altro'
  | 'giacenza' | 'rettifica' | 'reso' | 'rimborso'
  | 'fuori_portale' | 'compenso_agente' | 'bonus'

export type FamigliaVoce = 'soldi' | 'pacco' | 'costo'

export type CampoVoce = {
  chiave: 'fattura' | 'distinta' | 'spedizione' | 'tracking'
  etichetta: string
  esempio: string
  obbligatorio: boolean
}

export type VoceManuale = {
  id: IdVoce
  nome: string
  famiglia: FamigliaVoce
  segno: 'piu' | 'meno' | 'entrambi'
  campo: CampoVoce | null
  testoObbligatorio: boolean
  spiega: string
  esempioTesto: string
}

export const FAMIGLIE: { id: FamigliaVoce; nome: string; guadagno: string }[] = [
  { id: 'soldi', nome: 'Soldi tra voi', guadagno: 'Non entra nel guadagno: sono soldi che passano tra voi.' },
  { id: 'pacco', nome: 'Su una spedizione del portale', guadagno: 'Entra nel guadagno e nel report della spedizione.' },
  { id: 'costo', nome: 'Altri costi e ricavi', guadagno: 'Entra nel guadagno.' },
]

const SPEDIZIONE: CampoVoce = { chiave: 'spedizione', etichetta: 'Numero spedizione', esempio: 'il numero o il tracking, es. 3UW1WLJ087911', obbligatorio: true }

export const VOCI_MANUALI: VoceManuale[] = [
  { id: 'ricarica', nome: 'Ricarica', famiglia: 'soldi', segno: 'piu', campo: null, testoObbligatorio: false,
    spiega: 'Ti ha dato dei soldi: bonifico, contanti, carta. Per togliere una ricarica sbagliata scegli «Storno o correzione».',
    esempioTesto: 'es. bonifico del 3/11' },
  { id: 'fattura', nome: 'Pagamento fattura', famiglia: 'soldi', segno: 'entrambi',
    campo: { chiave: 'fattura', etichetta: 'Numero fattura', esempio: 'es. 1479 o 12/FE', obbligatorio: true }, testoObbligatorio: false,
    spiega: 'Il saldo di una fattura: col più se te la paga, col meno se la scali dal suo credito.',
    esempioTesto: 'es. saldo di ottobre' },
  { id: 'contrassegni', nome: 'Contrassegni', famiglia: 'soldi', segno: 'entrambi',
    campo: { chiave: 'distinta', etichetta: 'Numero distinta', esempio: 'se c\'è, es. 1875', obbligatorio: false }, testoObbligatorio: false,
    spiega: 'Contrassegni compensati sul credito, o lo storno di una distinta già accreditata.',
    esempioTesto: 'es. compensazione contrassegni di novembre' },
  { id: 'trasferimento', nome: 'Credito trasferito', famiglia: 'soldi', segno: 'entrambi', campo: null, testoObbligatorio: false,
    spiega: 'Credito spostato da o verso un altro profilo o un\'altra piattaforma.',
    esempioTesto: 'es. dalla vecchia piattaforma' },
  { id: 'storno', nome: 'Storno o correzione', famiglia: 'soldi', segno: 'entrambi', campo: null, testoObbligatorio: true,
    spiega: 'Annulla un movimento sbagliato, per esempio una ricarica doppia o un importo errato. Scrivi quale correggi.',
    esempioTesto: 'es. ricarica del 12/11 registrata due volte' },
  { id: 'altro', nome: 'Altro', famiglia: 'soldi', segno: 'entrambi', campo: null, testoObbligatorio: true,
    spiega: 'Quello che non sta in nessuna voce. Scrivi di cosa si tratta.',
    esempioTesto: 'es. IVA' },

  { id: 'giacenza', nome: 'Giacenza', famiglia: 'pacco', segno: 'entrambi', campo: SPEDIZIONE, testoObbligatorio: false,
    spiega: 'Svincolo, riconsegna, nuovo indirizzo. Finisce nel Report Giacenze.',
    esempioTesto: 'es. svincolo con nuovo indirizzo' },
  { id: 'rettifica', nome: 'Rettifica', famiglia: 'pacco', segno: 'entrambi', campo: SPEDIZIONE, testoObbligatorio: false,
    spiega: 'Peso, misure o supplemento (pallet, LDV rifatta, POD, sabato). Finisce nel Report Rettifiche.',
    esempioTesto: 'es. da 90 a 102,8 kg' },
  { id: 'reso', nome: 'Reso al mittente', famiglia: 'pacco', segno: 'meno', campo: SPEDIZIONE, testoObbligatorio: false,
    spiega: 'Il costo del ritorno al mittente. Finisce nel Report Resi.',
    esempioTesto: 'es. destinatario assente' },
  { id: 'rimborso', nome: 'Rimborso', famiglia: 'pacco', segno: 'piu', campo: SPEDIZIONE, testoObbligatorio: false,
    spiega: 'Spedizione bloccata, smarrita o danneggiata, o un errore di prezzo.',
    esempioTesto: 'es. smarrimento' },

  { id: 'fuori_portale', nome: 'Spedizione fatta fuori dal portale', famiglia: 'costo', segno: 'entrambi',
    campo: { chiave: 'tracking', etichetta: 'Numero o tracking', esempio: 'se c\'è, es. 1ZGE70566800017309', obbligatorio: false }, testoObbligatorio: false,
    spiega: 'Una spedizione che sul portale non c\'è e che addebiti a mano. Se è sul portale, scegli una voce della spedizione.',
    esempioTesto: 'es. 3 spedizioni da 5 kg' },
  { id: 'compenso_agente', nome: 'Compenso agente', famiglia: 'costo', segno: 'entrambi', campo: null, testoObbligatorio: false,
    spiega: 'Il compenso che riconosci a un agente sul suo credito.',
    esempioTesto: 'es. compenso di ottobre' },
  { id: 'bonus', nome: 'Bonus o cashback', famiglia: 'costo', segno: 'entrambi', campo: null, testoObbligatorio: false,
    spiega: 'Un omaggio: bonus, cashback, promozione. Per te è un costo.',
    esempioTesto: 'es. cashback 3%' },
]

export function voceManuale(id: unknown): VoceManuale | null {
  return VOCI_MANUALI.find((v) => v.id === id) || null
}

export function famigliaDi(v: VoceManuale) {
  return FAMIGLIE.find((f) => f.id === v.famiglia)!
}

export function tipoDiVoce(v: VoceManuale, importo: number): TipoMovimento {
  if (v.famiglia === 'pacco') return v.id as TipoMovimento
  if (v.famiglia === 'costo') return 'rettifica'
  return importo > 0 ? 'ricarica' : 'rettifica'
}

// Il Check Ricariche aspetta un bonifico solo da chi paga davvero: una ricarica o il saldo di una fattura.
// Gli altri accrediti senza spedizione ci entrano lo stesso, perche' ogni credito aggiunto a mano resta sotto
// controllo, ma con il loro metodo, cosi' non risultano mai «in attesa di bonifico». In 90 giorni 803 accrediti
// per 312.201 € (compensazioni di contrassegni, rimborsi, trasferimenti) aspettavano un bonifico che non sarebbe
// mai arrivato.
export function chiedeBonifico(v: VoceManuale | null, importo: number): boolean {
  return !!v && importo > 0 && (v.id === 'ricarica' || v.id === 'fattura')
}
export function metodoNelCheck(v: VoceManuale): 'cod_compensati' | 'altro' {
  return v.id === 'contrassegni' ? 'cod_compensati' : 'altro'
}

// Il numero si cerca fra `numero` e `tracking_number`: solo lettere, cifre e pochi separatori, perche' finisce
// dentro un filtro PostgREST.
export function numeroSpedizionePulito(v: unknown): string | null {
  const s = String(v ?? '').trim().toUpperCase()
  return /^[A-Z0-9._-]{4,40}$/.test(s) ? s : null
}

const MAX_TESTO = 200
export function pulisciTesto(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TESTO)
}

// Quello che si legge nella Lista Movimenti, da tutte e due le parti: chi scrive e chi riceve. Comincia sempre
// con la voce, cosi' anche le pagine e gli export che mostrano solo la descrizione dicono che cos'e'.
export function descrizioneMovimento(v: VoceManuale, numero: string, testo: string): string {
  const n = String(numero || '').trim()
  const testa = v.id === 'fattura' ? `Pagamento fattura${n ? ` n° ${n}` : ''}`
    : v.id === 'contrassegni' ? `Contrassegni${n ? ` distinta n° ${n}` : ''}`
    : `${v.nome}${n ? ` ${n}` : ''}`
  const t = pulisciTesto(testo)
  return t ? `${testa} · ${t}` : testa
}

export function suggerimentoSegno(v: VoceManuale | null): string {
  if (!v) return 'Scrivi 200 per accreditare, -200 per togliere credito.'
  if (v.segno === 'piu') return `«${v.nome}» aggiunge credito: scrivi l'importo senza il meno.`
  if (v.segno === 'meno') return `«${v.nome}» è un addebito: scrivi l'importo col meno, es. -5,50.`
  return 'Scrivi 200 per accreditare, -200 per togliere credito.'
}

// L'errore da mostrare, o null se il movimento si puo' registrare.
export function erroreVoce(v: VoceManuale | null, importo: number, numero: string, testo: string): string | null {
  if (!v) return 'Scegli che movimento è.'
  if (!isFinite(importo) || importo === 0) return 'Inserisci un importo diverso da 0.'
  if (v.segno === 'piu' && importo < 0) {
    return `«${v.nome}» aggiunge credito: scrivi l'importo senza il meno.${v.id === 'ricarica' ? ' Per togliere una ricarica sbagliata scegli «Storno o correzione».' : ''}`
  }
  if (v.segno === 'meno' && importo > 0) return `«${v.nome}» è un addebito: scrivi l'importo col meno, es. -5,50.`
  const n = String(numero || '').trim()
  if (v.campo?.obbligatorio && !n) return `Scrivi il ${v.campo.etichetta.toLowerCase()}.`
  if (v.campo?.chiave === 'spedizione' && !numeroSpedizionePulito(n)) {
    return 'Il numero della spedizione non è valido: copialo dall\'Elenco spedizioni o dal tracking.'
  }
  if (n.length > 60) return `Il ${v.campo?.etichetta.toLowerCase() || 'numero'} è troppo lungo.`
  if (v.testoObbligatorio && !pulisciTesto(testo)) return `Per «${v.nome}» scrivi nel testo di cosa si tratta.`
  return null
}
