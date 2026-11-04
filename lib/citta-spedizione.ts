/* CON QUALE CITTA' SI PREZZA UNA SPEDIZIONE.
 *
 * Le zone speciali (disagiate, isole) nel database sono scritte col nome UFFICIALE del comune. Se
 * la citta' della spedizione e' un'altra scrittura ("Aprigliano cs" per "Aprigliano"), la riga
 * speciale non aggancia e la destinazione cade sul jolly "Italia": venduta a prezzo di pianura,
 * pagata a prezzo di zona disagiata.
 *
 * Questa decisione stava scritta dentro la creazione del portale (app/api/spedizioni/crea) e, in
 * una copia sua, nell'API pubblica (app/api/v1/shipments: blocca sempre, non normalizza mai). Il
 * preventivo non la faceva: per lo stesso ordine prezzava con la citta' grezza, la creazione con
 * quella corretta. Caso vero del 13/10/2026, import da file, CAP 87051: calcolato 6,12 prima di
 * spedire, addebitato 13,65. Il cliente pagava un prezzo che nessuno gli aveva mostrato.
 *
 * Ora la decisione sta qui, e la chiamano la creazione del portale e l'anteprima dei prezzi: chi
 * la modifica cambia ENTRAMBE, ed e' il punto — un prezzo mostrato e uno addebitato che partono da
 * due citta' diverse non possono coincidere.
 * L'API PUBBLICA HA ANCORA LA SUA COPIA (il suo messaggio d'errore nomina il campo shipTo.city, e
 * cambiarlo cambierebbe la risposta a chi integra): chi cambia QUANDO si blocca deve allinearla a
 * mano.
 *
 * LIMITE NOTO: "questo CAP ha una zona speciale" lo dice lib/cap-speciali.ts, che tiene l'elenco in
 * memoria per istanza del server (dieci minuti) e lo carica con letture senza paginazione, quindi
 * INCOMPLETO (misurato il 13/10/2026: 1.223 CAP su 1.868; vedi REGOLE.md). Vale identico per
 * creazione e anteprima — la funzione e' una — ma su un CAP rimasto fuori dall'elenco la citta'
 * non viene ne' corretta ne' bloccata, e due istanze possono avere in memoria elenchi diversi. */
import { validaCittaCap, normalizzaCittaUfficiale, localitaItalianaFuoriPaese } from '@/lib/valida-citta'
import { capHaZonaSpeciale } from '@/lib/cap-speciali'
import { PAESI_MONDO } from '@/lib/paesi-elenco'
import { normalizzaPaese } from '@/lib/paesi'

// Indirizzo italiano col paese di un altro (regola e caso vero in lib/valida-citta.ts). Esportata
// perche' la usano anche chi non passa da cittaPerLaSpedizione: il preventivo del portale, cosi' il
// prezzo per la Romania non compare nemmeno, e l'API pubblica, che ha la sua creazione.
export function erroreIndirizzoItaliano(p: { cap: unknown; citta: unknown; paese?: unknown }): string | null {
  const paese = normalizzaPaese(p.paese)
  const loc = localitaItalianaFuoriPaese(String(p.cap ?? ''), String(p.citta ?? ''), paese)
  if (!loc) return null
  const nome = PAESI_MONDO.find(x => x.code === paese)?.nome || paese
  return `${String(p.cap).trim()} ${loc} è in Italia, ma come paese è scelto ${nome}: se il pacco va in Italia scegli Italia come paese, altrimenti correggi città e CAP.`
}

export type EsitoCitta =
  // `normalizzata` = la citta' e' stata SOSTITUITA col nome ufficiale; altrimenti e' quella ricevuta,
  // intatta (spazi compresi: non si ritocca cio' che non serve ritoccare).
  | { ok: true; citta: string; normalizzata: boolean }
  | { ok: false; errore: string }

export async function cittaPerLaSpedizione(p: {
  cap: string | null | undefined
  citta: string | null | undefined
  paese?: string | null
  // IMPORT (file o negozio): la citta' non l'ha scritta a mano chi spedisce e non la puo'
  // "selezionare dall'elenco" → dove non c'e' ambiguita' la si corregge da soli.
  // Inserimento manuale: non si corregge mai, si chiede a chi scrive di sistemarla.
  daImport: boolean
}): Promise<EsitoCitta> {
  // Prima di tutto il paese: un indirizzo italiano non si prezza ne' si spedisce come estero.
  const fuoriPaese = erroreIndirizzoItaliano(p)
  if (fuoriPaese) return { ok: false, errore: fuoriPaese }
  const vc = validaCittaCap(p.cap, p.citta, p.paese)
  // Blocco MIRATO: solo se la citta' NON e' un nome noto per quel CAP (archivio comuni+frazioni) E
  // quel CAP ha davvero una zona speciale — cosi' una frazione valida o una citta' su CAP normale
  // (che comunque prezza Italia, senza perdita) NON viene fermata. Solo Italia: l'estero non si valida.
  if (vc.validabile && !vc.ok && await capHaZonaSpeciale(p.cap)) {
    // Si NORMALIZZA al nome ufficiale quando il CAP e' di UN SOLO comune (senza ambiguita'). Se il CAP
    // e' condiviso e la citta' non combacia con nessuno, non si puo' decidere → ci si ferma.
    const norm = p.daImport ? normalizzaCittaUfficiale(p.cap, p.citta, p.paese) : null
    if (norm) return { ok: true, citta: norm, normalizzata: true }
    const suggeriti = vc.noti.slice(0, 6).join(', ')
    return {
      ok: false,
      errore: `Città "${String(p.citta).trim()}" non riconosciuta per il CAP ${String(p.cap).trim()}. Selezionala dall'elenco o scrivila correttamente${suggeriti ? ` (per questo CAP: ${suggeriti})` : ''}. È una zona con tariffa speciale: un nome errato la farebbe prezzare come destinazione normale.`,
    }
  }
  return { ok: true, citta: p.citta as string, normalizzata: false }
}
