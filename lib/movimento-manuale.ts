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
  // «Usa la voce del pacco» (Lorenzo, 25/11): il 25/11 Ecomize Solution ha restituito come storno due giacenze
  // (C&D EXPRESS +20,40 «riconsegna da non pagare», PANDORA +6 «giacenza e riconsegna da non pagare»): il report
  // Giacenze mostrava ancora l'addebito e il guadagno contava l'addebito senza la restituzione. Il reso invece si
  // addebita una volta sola per pacco (uniq_mov_reso_*): per restituirlo si usa «Rimborso».
  { id: 'storno', nome: 'Storno o correzione', famiglia: 'soldi', segno: 'entrambi', campo: null, testoObbligatorio: true,
    spiega: 'Annulla un movimento sbagliato, per esempio una ricarica doppia o un importo errato. Scrivi quale correggi. Per restituire una giacenza o una rettifica su un pacco usa la sua voce col più; per un reso usa «Rimborso» sulla stessa spedizione.',
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

// SOLDI CHE ARRIVANO DAVVERO. Fra gli accrediti a mano (tipo 'ricarica'), solo la ricarica e il pagamento di una
// fattura sono soldi entrati: sono quelli che la Salute del conto cerca in banca (lo Storico Ricariche invece chiama
// ricarica solo la ricarica, e mostra ogni altro accredito col suo nome). Contrassegni compensati, credito trasferito e correzioni muovono il credito senza che entri un euro: il 17/09
// Ecomize Solution ha accreditato a Ecomize LL 2.303,70 € di contrassegni («rimb cod»), e la Salute del conto lo
// contava fra i bonifici girati. I movimenti senza voce (lo storico, prima del 24/11/2026) restano contati come prima.
export const VOCI_SOLDI_ARRIVATI: IdVoce[] = ['ricarica', 'fattura']
// Lo stesso filtro per PostgREST (`.or(...)` su movimenti).
export const FILTRO_SOLDI_ARRIVATI = `voce.is.null,voce.in.(${VOCI_SOLDI_ARRIVATI.join(',')})`

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

// STORNO DI UNA RICARICA (Lorenzo, 25/11). Il 25/11 QUICK ha ricaricato 500 € ad APRO SRL per sbaglio e un minuto
// dopo li ha tolti con «Storno · ERRATA RICARICA»: il credito tornava, ma nel Check Ricariche la riga di APRO restava
// «bonifico fatto», e dopo 4 giorni avrebbe chiesto di verificare un incasso che non esiste. Chi toglie credito con uno
// storno ora dice quale ricarica corregge (o che non e' una ricarica), e la riga di quella ricarica si chiude.
export const NON_E_UNA_RICARICA = 'nessuna'
export function chiedeRicaricaDaStornare(v: VoceManuale | null, importo: number): boolean {
  return !!v && v.id === 'storno' && importo < 0
}
// Le ricariche che si possono stornare: gli accrediti a mano senza pacco degli ultimi giorni, con la voce dei soldi
// che arrivano (o senza voce, quelli di prima del 24/11/2026).
export const GIORNI_RICARICHE_DA_STORNARE = 60
export type RicaricaDaStornare = { id: string, quando: string, importo: number, voce: string | null, descrizione: string | null }
// Con l'ora: MULTIEXPRESS il 25/11 ha caricato a Velox due volte 5.000 € nello stesso giorno.
const dataBreve = (iso: string) => {
  const d = new Date(iso)
  const giorno = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
  return `${giorno} alle ${ora}`
}
export const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true } as Intl.NumberFormatOptions)
export function nomeRicarica(r: RicaricaDaStornare): string {
  return `${r.voce === 'fattura' ? 'pagamento fattura' : 'ricarica'} del ${dataBreve(r.quando)} di ${euro(r.importo)} €`
}
// Il testo dello storno nomina la ricarica che corregge: si legge nella Lista Movimenti, da tutte e due le parti.
export function testoDelloStorno(r: RicaricaDaStornare | null, testo: string): string {
  const t = pulisciTesto(testo)
  return r ? pulisciTesto(`${nomeRicarica(r)}${t ? ` · ${t}` : ''}`) : t
}
// Un testo che parla di un pacco su una voce dei soldi: lo si fa notare, senza bloccare (i due storni del 25/11
// dicevano «riconsegna» e «giacenza»).
export function sembraUnPacco(v: VoceManuale | null, testo: string): boolean {
  return !!v && v.famiglia === 'soldi' && /giacenz|riconsegn|svincol|rettific|ripes|\breso\b|\bpod\b|\bldv\b/i.test(testo)
}

// FATTURA N° 1 (Lorenzo, 25/11): il primo giorno due pagamenti di fattura su tre portavano il numero «1» (Wave
// 3.106,60 €, Ecomize Solution 63.333,69 €), che non permette di ritrovare la fattura. Un numero di una cifra si
// registra solo dopo una conferma esplicita.
export function numeroFatturaDaConfermare(v: VoceManuale | null, numero: string): boolean {
  return !!v && v.id === 'fattura' && /^\d$/.test(String(numero || '').trim())
}

// SPEDIZIONE FUORI DAL PORTALE (Lorenzo, 25/11): addebitata al cliente entrava nel guadagno per intero, perche' il
// costo pagato al corriere sul portale non c'e' (Ecomize Solution → PANDORA, −540 €: +540 € di guadagno). Chi la
// addebita dice quanto l'ha pagata: il costo resta in costi_fuori_portale, che vede solo il server, e il guadagno
// conta la differenza.
export function chiedeCosto(v: VoceManuale | null, importo: number): boolean {
  return !!v && v.id === 'fuori_portale' && importo < 0
}
export function costoLetto(x: unknown): number | null {
  const s = String(x ?? '').trim().replace(/\s|€/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null
}

// Quello che la voce chiede oltre a importo, numero e testo. Sul server arriva dal corpo della richiesta.
export type ExtraVoce = { storna?: unknown, costo?: unknown, numeroConfermato?: unknown }

// L'errore da mostrare, o null se il movimento si puo' registrare.
export function erroreVoce(v: VoceManuale | null, importo: number, numero: string, testo: string, extra: ExtraVoce = {}): string | null {
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
  if (numeroFatturaDaConfermare(v, n) && extra.numeroConfermato !== true) {
    return `Conferma il numero della fattura: è davvero la n° ${n}?`
  }
  if (chiedeRicaricaDaStornare(v, importo) && !String(extra.storna ?? '').trim()) {
    return 'Scegli quale ricarica correggi, oppure «Non è una ricarica».'
  }
  if (chiedeCosto(v, importo)) {
    if (!String(extra.costo ?? '').trim()) return 'Scrivi quanto hai pagato tu questa spedizione (anche 0).'
    if (costoLetto(extra.costo) === null) return 'Il costo che hai pagato non è valido: scrivi un importo, es. 450 o 12,50.'
  }
  return null
}
