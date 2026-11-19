import { qualcunoSottoDeve, volumiDelLivello, type EsitoRipesatura, type LivelloRettifica } from '@/lib/ripesature-calcolo'
import { eSupplementoTardivo } from '@/lib/supplemento-tardivo'
import { colloDaSalvato } from '@/lib/ripesature'
import type { ContoSotto } from '@/lib/rettifiche-perche'

// ── COSA SUCCEDE A UNA RETTIFICA RICEVUTA QUANDO SI PREME «CARICA» ──
// Una regola sola, usata da «Carica» (app/api/network/rettifiche), che crea la rettifica per chi sta sotto, e dal conto
// fatto all'arrivo (lib/network-stima), che dice al master prima di caricarle quante ne recupera e quanto (Lorenzo,
// 16/11/2026: «quando arrivano, ci sia il valore che paga e il numero spedizioni, quelle che deve recuperare e il
// prezzo»). Se i due contassero in modo diverso, il riepilogo prometterebbe una cifra e «Carica» ne girerebbe un'altra.
// Solo calcolo: non legge e non scrive niente.

// Le colonne della riga ricevuta che servono qui (e al motore).
export const CAMPI_CARICA = 'id,spedizione_id,numero_spedizione,peso_iniziale,peso_reale,colli_ripesati,rif_fornitore,propagazione,fuori_sagoma,supplementi_nomi,differenza'

// Senza misure o senza spedizione il motore non si chiama nemmeno: il motivo, oppure null.
export function primaDelMotore(r: any): string | null {
  const colli = Array.isArray(r.colli_ripesati) ? r.colli_ripesati : []
  // Senza le misure si potrebbe riprezzare col solo peso, ma il supplemento lo fa il VOLUME:
  // meta' delle righe uscirebbe negativa, cioe' un rimborso al posto di un addebito. Meglio
  // dirlo che tirare a indovinare su dei soldi.
  if (!colli.length) return 'senza le misure ripesate: caricata prima che venissero conservate'
  if (!r.spedizione_id) return 'spedizione non collegata'
  return null
}

// La riga come la vuole il motore (lib/ripesature-calcolo, calcolaRipesature).
export function ingressoMotore(r: any) {
  return {
    idOrdine: r.rif_fornitore || r.id, idVerifiche: [], ldv: r.numero_spedizione,
    addebitoFornitore: 0,
    // col peso reale del fornitore, se c'era: senza, al livello sotto la sponda tornerebbe sul volumetrico
    colli: (r.colli_ripesati as any[]).map(colloDaSalvato),
    dataChiusura: '', mittente: '', destinatario: '',
  }
}

export type ExtraSalta = { chi?: string | null; cliente_id?: string | null; master_id?: string | null; serve?: number | null }
export type DecisioneCarica =
  | { tipo: 'salta'; perche: string; extra: ExtraSalta }   // non si puo' girare adesso: resta da decidere, ritentabile
  | { tipo: 'uguale'; liv: LivelloRettifica }                // sotto si paga uguale: niente da recuperare (assorbita)
  | { tipo: 'figlia'; liv: LivelloRettifica; figlio: string | null; diffFiglia: number; fs: number; soloPassaggio: boolean; penale: boolean; tardivo: boolean }

export function decidiCarica(r: any, esito: EsitoRipesatura | undefined, mio: string): DecisioneCarica {
  const salta = (perche: string, extra: ExtraSalta = {}): DecisioneCarica => ({ tipo: 'salta', perche, extra })
  if (!esito?.trovata) return salta(esito?.motivo || 'spedizione non trovata')
  if (esito.catenaCompleta === false) return salta('catena dei listini incompleta')

  // A CHI: il mio figlio DIRETTO, quello subito prima di me nella catena. Se sotto di me non c'e'
  // nessun master, il destinatario e' il cliente. "Non sono nella catena" (indice -1) non e' "sono
  // l'ultimo": in quel caso non si scrive niente, altrimenti la rettifica cadrebbe addosso al
  // cliente finale di un ramo che non e' mio.
  const cat = esito.catenaDalBasso || []
  const idx = cat.indexOf(mio)
  if (idx < 0) return salta('non sei nella catena di questa spedizione')
  const figlio = idx > 0 ? cat[idx - 1] : null
  const liv = figlio
    ? esito.livelli.find(l => l.masterId === figlio)
    : esito.livelli.find(l => l.clienteId)
  const fs = Number(r.fuori_sagoma) || 0
  // Senza il livello del figlio non c'e' nulla su cui costruire la figlia (ne' costo ne' il cliente
  // destinatario): resta da decidere, ritentabile.
  if (!liv) return salta('catena/listino del livello sotto non ricostruito: riprova quando sara\' disponibile', { master_id: figlio })
  // SOLO RECUPERI, MAI RIMBORSI: la RIPESATURA si gira solo se il listino del figlio prezza il collo
  // (dovuto non null) e c'e' qualcosa da recuperare (differenza >= 0.01). Il FUORI SAGOMA invece e'
  // un importo FISSO che per regola scende INVARIATO a prescindere dal listino: se c'e', la figlia
  // si crea COMUNQUE — anche quando il collo ripesato e' oltre la fascia massima del figlio — con la
  // sola parte ripesatura a zero, altrimenti il supplemento si fermerebbe a questo livello.
  // LA PENALE BRT NON E' UN CAMBIO DI PESO (regola di Lorenzo, 7/10): scende soltanto lei, invariata,
  // fino al cliente che ha sforato. Qui pero' il motore riprezzava anche i chili col listino del figlio
  // e li sommava alla penale: l'8/10 BL SISTEMI ha pagato 18,60 di penale + 3,90 di peso
  // (050187292960523), e il 30/10, sulle penali messe per errore, SENDGO ha pagato 5,39 di peso
  // + 3,53 di "penale" per gli stessi chili (050026152906222).
  const penale = String(r.supplementi_nomi || '').toLowerCase().includes('penale')
  // IL SUPPLEMENTO ARRIVATO DOPO I CHILI (lib/supplemento-tardivo) scende come la penale: solo lui, invariato. I chili
  // di quel pacco sono gia' stati chiesti, e riprezzarli qui li chiederebbe una seconda volta.
  const tardivo = eSupplementoTardivo(r)
  const reweighGirabile = !penale && !tardivo && liv.differenza != null && liv.differenza >= 0.01
  if (!reweighGirabile && fs === 0) {
    // Niente supplemento e niente ripesatura da girare: se il listino non copre proprio il collo
    // (differenza null) e' ritentabile; se lo copre ma esce <= 0 e' una scelta presa (assorbita).
    if (liv.differenza == null) {
      // Il listino del cliente non arriva a questo peso (ultima fascia superata, nessuna regola
      // "oltre") o a questa zona. NON è un vicolo cieco: il master alza la fascia sul listino del
      // suo cliente e RIPREME Accetta — allora prezza e passa. Il messaggio glielo dice, col peso
      // vero, invece di suggerire di assorbire (che sarebbe farsi carico di un costo del cliente).
      // IL PESO SI SCRIVE PER INTERO, con il decimale. Arrotondato faceva impazzire chi leggeva:
      // un collo da 5,34 kg usciva come «non copre 5 kg» su un listino che la fascia 0–5 ce l'ha
      // eccome — sembrava un guasto nostro, ed era solo il collo che la supera di tre etti
      // (visto il 12/09/2026 su BRILLITALIA, Epos Caffè, FEDEL FARMA).
      const pesoFatt = Math.max(Number(esito.pesoDopo) || 0, Number(volumiDelLivello(esito, liv).peso_volume_reale) || 0)
      const quanto = pesoFatt ? pesoFatt.toFixed(1).replace('.', ',') + ' kg' : 'questo peso'
      // Il motore lascia il dovuto vuoto anche quando il listino del cliente non prezza contrassegno o assicurazione su
      // quel contratto (lib/ripesature-calcolo): li' «alza l'ultima fascia» manderebbe a cercare un problema che non c'e'.
      const accessori = /contrassegno|assicurazione/i.test(String((esito as any).motivo || ''))
      return salta(accessori
        ? `il listino di ${liv.chi || 'questo cliente'} non prezza contrassegno o assicurazione su questo contratto → aggiungi il prezzo sul suo listino e ripremi Carica.`
        : `il listino di ${liv.chi || 'questo cliente'} si ferma prima di ${quanto}: il collo ripesato lo supera (o la sua zona non è prevista) → alza l'ultima fascia sul suo listino e ripremi Carica, passerà.`,
        { chi: liv.chi || null, cliente_id: figlio ? null : (liv.clienteId || null), master_id: figlio, serve: pesoFatt || null })
    }
    // Il listino del figlio prezza il collo (differenza != null) ma riprezzando esce <= 0: stesso
    // scaglione dell'addebito, il cliente pagherebbe uguale. Niente da recuperare → SCARTO pulito
    // (assorbita), non un avviso: non ha senso dire "alza la fascia" (la fascia c'è, è la stessa).
    // TRANNE se sotto il figlio qualcuno deve ancora pagare: allora la figlia nasce A ZERO, cosi' la
    // catena prosegue (vedi qualcunoSottoDeve). Il 15/10 Wave ne aveva scartate 2 cosi', e Velox e i
    // suoi clienti non potevano piu' essere rettificati.
    if (!qualcunoSottoDeve(esito, figlio)) return { tipo: 'uguale', liv }
  }
  const soloPassaggio = !reweighGirabile && fs === 0
  // reweighGirabile garantisce già differenza != null, ma TS non lo propaga: fisso a numero.
  const diffFiglia = reweighGirabile && liv.differenza != null ? liv.differenza : 0
  return { tipo: 'figlia', liv, figlio, diffFiglia, fs, soloPassaggio, penale, tardivo }
}

// Il conto di chi sta sotto, per la frase di Rettifica Costi: il suo listino sul collo ripesato (prima del limite dei
// chili, vedi dovutoListino in lib/ripesature-calcolo) e sul dichiarato, e i chili su cui paga quando si sanno.
export function contoDelLivello(liv: LivelloRettifica): ContoSotto {
  return {
    chi: String(liv.chi || '').trim() || null, pagato: liv.pagato, dovuto: liv.dovutoListino ?? liv.dovuto,
    dovuto_dich: liv.dovutoDichiarato ?? null, zona: liv.zona ?? null,
    peso_prima: liv.pesoFatturatoPrima ?? null, peso_dopo: liv.pesoFatturato ?? null,
  }
}
