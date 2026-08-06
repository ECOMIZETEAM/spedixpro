// QUANDO DUE ORDINI VANNO ALLA STESSA PERSONA.
//
// Serve a unire piu' ordini in un pacco solo. La regola l'ha data chi paga, ed e' stretta:
// **si uniscono solo se i dati del destinatario sono IDENTICI, altrimenti niente**. Non si
// indovina, non ci si accontenta di "sembra lo stesso": due indirizzi diversi sono due pacchi, e
// sbagliare vuol dire spedire la merce di qualcuno a casa di qualcun altro.
//
// L'unica tolleranza e' su come e' SCRITTO lo stesso dato: maiuscole, accenti, spazi doppi e
// punteggiatura non cambiano dove va il pacco — "Via Roma, 12" e "VIA ROMA 12" sono lo stesso
// posto. Tutto il resto deve combaciare carattere per carattere.
//
// I due elenchi ordini hanno forme diverse — quelli dei negozi tengono il destinatario dentro un
// oggetto, quelli importati da file lo hanno in colonne separate — ma la domanda "e' la stessa
// persona?" e' una sola, e va risposta in un posto solo: se ognuno se la scrivesse per conto suo,
// i due elenchi unirebbero cose diverse.

const nrm = (v: any) => String(v ?? '')
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // via gli accenti
  .replace(/[^A-Z0-9]+/g, ' ')                         // punteggiatura e simboli = spazio
  .trim()

// Il CAP e il telefono si confrontano a sole cifre: "20 121" e "20121" sono lo stesso CAP, e
// "+39 333 1234567" e "3331234567" lo stesso numero.
const soleCifre = (v: any) => String(v ?? '').replace(/\D+/g, '')

export type Destinatario = {
  nome?: any; indirizzo?: any; civico?: any; cap?: any; citta?: any
  provincia?: any; paese?: any; telefono?: any; email?: any
}

/** Il destinatario di un ordine di negozio, che lo tiene dentro un oggetto con nomi in inglese. */
export function destinatarioDaEcommerce(o: any): Destinatario {
  const d = o?.destinatario || {}
  return {
    nome: d.nome ?? d.name ?? d.first_name ? `${d.first_name || ''} ${d.last_name || ''}` : (d.nome ?? d.name),
    indirizzo: [d.indirizzo ?? d.address1 ?? d.address_1 ?? d.street1, d.address2 ?? d.address_2 ?? d.street2].filter(Boolean).join(' '),
    cap: d.cap ?? d.zip ?? d.postcode ?? d.postalCode,
    citta: d.citta ?? d.city,
    provincia: d.provincia ?? d.province ?? d.state ?? d.province_code,
    paese: d.paese ?? d.country_code ?? d.country ?? 'IT',
    telefono: d.telefono ?? d.phone,
    email: d.email,
  }
}

/** Il destinatario di un ordine importato da file, che lo tiene in colonne separate. */
export function destinatarioDaImportato(o: any): Destinatario {
  return {
    nome: o?.destinatario, indirizzo: o?.indirizzo, cap: o?.cap, citta: o?.localita,
    provincia: o?.provincia, paese: o?.country || 'IT', telefono: o?.telefono, email: o?.email_destinatario,
  }
}

/**
 * La chiave con cui due destinatari si confrontano. Uguale = stesso posto, stessa persona.
 * Il paese non entra quando manca da tutte e due le parti (i file italiani spesso non lo scrivono);
 * l'email e il telefono invece contano, perche' due omonimi allo stesso indirizzo esistono.
 */
export function chiaveDestinatario(d: Destinatario): string {
  return [
    nrm(d.nome),
    nrm(d.indirizzo),
    soleCifre(d.cap),
    nrm(d.citta),
    nrm(d.provincia),
    nrm(d.paese || 'IT'),
    soleCifre(d.telefono),
    nrm(d.email),
  ].join('|')
}

/** Tutti gli ordini vanno alla stessa persona? Con meno di due, non c'e' niente da unire. */
export function stessoDestinatario(chiavi: string[]): boolean {
  if (chiavi.length < 2) return false
  return chiavi.every(k => k === chiavi[0]) && chiavi[0].replace(/\|/g, '').trim().length > 0
}
