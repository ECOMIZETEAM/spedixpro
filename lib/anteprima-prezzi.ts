/* ANTEPRIMA DEI PREZZI per le porte che spediscono IN MASSA: import da file e ordini dei negozi.
 *
 * COSA RISPONDE. Per ogni ordine: con quali contratti lo si puo' spedire e QUANTO VERRA' ADDEBITATO
 * con ciascuno. Con quell'elenco la pagina mostra il prezzo prima di spedire, e quando il cliente
 * passa da "prezzo minore" a "contratto X" il numero cambia senza un'altra chiamata.
 *
 * LA REGOLA CHE REGGE TUTTO: il numero mostrato e' quello che la creazione addebitera', perche'
 * esce dalle STESSE due funzioni che la creazione chiama —
 *   cittaPerLaSpedizione   (con quale citta' si prezza)
 *   prezzoClienteDaListino (quanto fa pagare il listino)
 * — con gli stessi dati in ingresso. Non dal totale del motore del preventivo: quello e' un altro
 * calcolo, che quasi sempre da' lo stesso numero e ogni tanto no (i numeri sono in
 * lib/prezzo-cliente.ts).
 *
 * Il motore del preventivo qui serve a UNA cosa sola: dire QUALI contratti sono offribili a questo
 * cliente per questa destinazione (disattivati, in pausa, sospesi a monte, fuori misura, senza
 * costo per il master, contrassegno spento...). Quei cancelli stanno li' e non si riscrivono. Le
 * due meta' servono entrambe: l'elenco dal motore, la cifra dall'addebito. Solo la cifra
 * dell'addebito senza i cancelli riproporrebbe contratti che al cliente sono stati tolti; solo il
 * motore darebbe una cifra che poi non viene addebitata.
 *
 * SOLA LETTURA: non prenota credito, non scrive sugli ordini, non chiama i corrieri. I client che
 * riceve devono essere quelli di lib/db-memoria.ts — e' cio' che rende sostenibile prezzare venti
 * righe (il listino si legge una volta) ed e' cio' che impedisce una scrittura per errore.
 *
 * NON COPRE TUTTI I RIFIUTI DELLA CREAZIONE. Un prezzo qui non garantisce che la spedizione nasca:
 * la creazione puo' ancora rifiutarla per motivi che si scoprono solo li' (credito esaurito lungo
 * la catena, telefono richiesto dal corriere, risposta del corriere). In quel caso non si addebita
 * niente e l'ordine riporta il motivo. */
import { calcolaTariffeCliente } from '@/lib/tariffe-motore'
import { cittaPerLaSpedizione } from '@/lib/citta-spedizione'
import { prezzoClienteDaListino } from '@/lib/prezzo-cliente'
import { annotaPuntoPoste, contrattiConFasceATaglia, eTariffaAUnPunto, soloCorrieriInCatena } from '@/lib/tariffe-offerte'
import { internoEsclusivoViola } from '@/lib/interno-esclusivo'

export type RigaDaPrezzare = {
  id: string
  cap: string
  citta: string
  provincia: string
  paese: string
  // UN solo collo: e' cosi' che le porte di massa spediscono. Chi ha piu' colli passa dal modulo
  // della spedizione singola, dove il prezzo si vede gia'.
  collo: { weight: number; length: number; width: number; height: number }
  contrassegno: number
  // La creazione rifiuta i servizi internazionali senza la descrizione della merce.
  haContenuto: boolean
}

// LISTA BIANCA di cio' che arriva al browser del cliente: il SUO prezzo, il nome del contratto come
// lo vede ovunque, e l'id che serve per creare. Niente tipo tecnico del contratto, niente costo del
// master, niente saldi a monte, niente chiavi che portano il nome di un fornitore.
export type TariffaAnteprima = { corriere_id: string; nome: string; prezzo: number }

export type RigaPrezzata = {
  id: string
  // Dal piu' economico. A parita' di prezzo resta l'ordine del motore.
  tariffe: TariffaAnteprima[]
  // Presente quando NESSUN contratto e' disponibile: il motivo, in parole per il cliente. Viene dal
  // motore del preventivo; solo per la citta' e' lo stesso identico testo della creazione.
  errore?: string
  // true = non e' un rifiuto, e' un inciampo tecnico: la pagina puo' richiedere di nuovo la riga.
  riprova?: true
}

export type ContestoAnteprima = {
  dbUtente: any     // client di sessione del cliente, con memoria (lib/db-memoria)
  dbAdmin: any      // client di servizio, con memoria
  clienteId: string
  cliente: { master_id: string; listino_cliente_id: string | null; impostazioni?: any }
  mittente: { cap: string; provincia: string }
}

const NESSUN_CORRIERE = 'Nessun corriere disponibile per questa spedizione.'

// Alcuni testi del motore parlano a chi CONFIGURA il listino ("configura la tariffa contrassegno
// sul listino, tab Contrassegni"): il cliente quel listino non lo vede e non lo puo' toccare.
function perIlCliente(messaggio: string): string {
  if (/contrassegno richiesto/i.test(messaggio)) return 'Nessun corriere disponibile con questo importo di contrassegno.'
  if (/assicurazione richiesta/i.test(messaggio)) return 'Nessun corriere disponibile con questa assicurazione.'
  if (/listino vuoto|nessun contratto attivo/i.test(messaggio)) return 'Nessun contratto attivo: contatta il tuo referente.'
  return messaggio
}

async function prezzaRiga(ctx: ContestoAnteprima, riga: RigaDaPrezzare, aTaglia: Set<string>): Promise<RigaPrezzata> {
  const senza = (errore: string): RigaPrezzata => ({ id: riga.id, tariffe: [], errore })

  // La creazione rifiuta la consegna a domicilio senza provincia: non si mostra un prezzo per una
  // spedizione che non nascera' (il motore, da solo, la prezzerebbe per CAP).
  if (!riga.provincia.trim()) return senza('Manca la provincia del destinatario.')

  // 1) LA CITTA': la stessa decisione della creazione, PRIMA di qualunque prezzo.
  const cd = await cittaPerLaSpedizione({ cap: riga.cap, citta: riga.citta, paese: riga.paese, daImport: true })
  if (!cd.ok) return senza(cd.errore)

  const packages = [riga.collo]
  const shipTo = { state: riga.provincia, postalCode: riga.cap, city: cd.citta, country: riga.paese }
  const shipFrom = { postalCode: ctx.mittente.cap, state: ctx.mittente.provincia }

  // 2) QUALI CONTRATTI: i cancelli del motore, con la citta' gia' corretta.
  const esito = await calcolaTariffeCliente(
    ctx.dbUtente,
    { cliente: ctx.cliente, clienteId: ctx.clienteId, subMatch: null, admin: ctx.dbAdmin },
    { packages, shipFrom, shipTo, codValue: riga.contrassegno, insuranceValue: 0 },
  )
  if (esito.errore) {
    // Un errore TECNICO del motore (non e' riuscito a leggere le fasce) non e' un "nessun corriere":
    // si solleva, cosi' la riga esce come inciampo riprovabile. Trattato come un motivo qualsiasi
    // resterebbe fisso sulla riga senza modo di riprovare, e al clic l'ordine finirebbe in errore.
    if (esito.stato >= 500) throw new Error(esito.errore)
    return senza(perIlCliente(esito.errore))
  }

  let offerte = await soloCorrieriInCatena(ctx.dbAdmin, esito.risultati || [], ctx.cliente.master_id)
  // Niente try/catch attorno ai flag "a un punto": nella rotta del preventivo se la lettura fallisce
  // si mostra tutto lo stesso (li' il punto lo sceglie una persona). Qui la scelta e' automatica:
  // se annotaPuntoPoste solleva, la riga resta senza prezzo.
  await annotaPuntoPoste(ctx.dbAdmin, offerte)
  offerte = offerte.filter((r: any) => !eTariffaAUnPunto(r) && !aTaglia.has(r._corriere_id))

  // 3) QUANTO: per ogni contratto offribile, il calcolo dell'addebito.
  const tariffe: TariffaAnteprima[] = []
  for (const r of offerte) {
    const corriereId: string | undefined = r._corriere_id
    if (!corriereId) continue
    const nome = String(r.corriere_nome || 'Corriere')
    // Stessi rifiuti della creazione, per cio' che si puo' sapere prima:
    if (/international/i.test(nome) && !riga.haContenuto) continue           // serve la descrizione della merce
    if (riga.contrassegno > 0 && r._corriere_tipo === 'inpost') continue     // InPost non gestisce il contrassegno
    if (await internoEsclusivoViola(ctx.dbAdmin, {
      cliente: ctx.cliente, corriereSceltoTipo: r._corriere_tipo,
      provincia: riga.provincia, cap: riga.cap, citta: cd.citta, paese: riga.paese || 'IT', packages,
    })) continue

    const pz = await prezzoClienteDaListino(ctx.dbAdmin, {
      listinoId: ctx.cliente.listino_cliente_id as string, corriereId,
      provincia: riga.provincia, cap: riga.cap, paese: riga.paese, citta: cd.citta, packages,
      mittCap: ctx.mittente.cap, mittProvincia: ctx.mittente.provincia,
      contrassegno: riga.contrassegno, assicurazione: 0, valoreMerce: 0,
    })
    // Il listino non la prezza con questo contratto, o non prevede quel contrassegno: la creazione
    // la rifiuterebbe. Un prezzo a zero non e' un prezzo: non si offre.
    if (!pz.ok || !pz.supplementiDisponibili || !(pz.prezzo > 0)) continue
    tariffe.push({ corriere_id: corriereId, nome, prezzo: pz.prezzo })
  }
  if (!tariffe.length) return senza(NESSUN_CORRIERE)

  // Dal piu' economico SUL PREZZO DELL'ADDEBITO (l'ordine del motore e' fatto sul suo totale, che
  // puo' differire). L'ordinamento e' stabile: a parita' resta l'ordine del motore.
  tariffe.sort((a, b) => a.prezzo - b.prezzo)
  return { id: riga.id, tariffe }
}

// Quante righe si lavorano insieme dentro una richiesta. Le letture uguali si condividono anche
// mentre sono in corso, quindi il parallelismo non le moltiplica; resta basso per non caricare il
// database con le letture che dipendono dalla singola destinazione.
const RIGHE_INSIEME = 4

export async function prezziPerRighe(ctx: ContestoAnteprima, righe: RigaDaPrezzare[]): Promise<RigaPrezzata[]> {
  if (!ctx.cliente.listino_cliente_id) {
    return righe.map(r => ({ id: r.id, tariffe: [], errore: 'Nessun contratto attivo: contatta il tuo referente.' }))
  }
  const aTaglia = await contrattiConFasceATaglia(ctx.dbAdmin, ctx.cliente.listino_cliente_id)

  const esiti: RigaPrezzata[] = new Array(righe.length)
  let prossima = 0
  const operaio = async () => {
    for (;;) {
      const k = prossima++
      if (k >= righe.length) return
      try {
        esiti[k] = await prezzaRiga(ctx, righe[k], aTaglia)
      } catch (e: any) {
        // Una riga che non si riesce a prezzare non deve far perdere le altre del blocco.
        console.error('[ANTEPRIMA] riga non prezzata', { cliente: ctx.clienteId, cap: righe[k].cap, errore: e?.message || String(e) })
        esiti[k] = { id: righe[k].id, tariffe: [], errore: 'Prezzo non calcolato per un errore tecnico: riprova tra poco.', riprova: true }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RIGHE_INSIEME, righe.length) }, operaio))
  return esiti
}
