/* IL PREZZO CHE IL CLIENTE PAGA PER UNA SPEDIZIONE, DAL SUO LISTINO.
 *
 * E' il calcolo dell'ADDEBITO delle spedizioni create dal portale. Stava scritto dentro la creazione
 * (app/api/spedizioni/crea), ed era giusto che l'addebito lo decidesse il server. Ma fuori di li'
 * non lo poteva chiamare nessuno (l'API pubblica se n'era fatta una copia, vedi sotto): chi
 * voleva sapere "quanto paghero'" prima di spedire passava da un ALTRO calcolo, quello del
 * preventivo (lib/tariffe-motore.ts), scritto a parte: arrotonda in un altro modo, decide a modo suo
 * su quale peso si tassa, calcola la sponda su un peso diverso, non conosce le fasce a taglia.
 *
 * QUANTO DIVERGONO DAVVERO (misurato il 13/10/2026 su 185 spedizioni vere nate da import e
 * negozi): preventivo uguale al pagato su 184, 1 diversa di un centesimo. Quasi sempre coincidono.
 * Ma quando non coincidono il cliente paga il numero di QUESTA funzione, non quello che il
 * preventivo gli avrebbe mostrato — e nei log di produzione ci sono anche scarti di euro, non solo
 * di centesimi (caso vero del 13/10/2026: citta' scritta diversa dal nome ufficiale su un CAP con
 * zona speciale, 6,12 calcolati dal preventivo contro 13,65 addebitati; vedi lib/citta-spedizione.ts).
 * Un'anteprima non puo' essere "quasi sempre" il prezzo giusto.
 *
 * Ora il calcolo sta qui e lo chiamano in due:
 *   - la CREAZIONE dal portale (che serve anche import e negozi), per decidere quanto addebitare;
 *   - l'ANTEPRIMA dei prezzi di import e ordini dei negozi, per mostrarlo PRIMA.
 * Stessa funzione, stessi dati in ingresso → stesso numero. Chi la modifica cambia l'addebito di
 * quelle spedizioni: va rieseguita sui dati veri prima e dopo (vedi REGOLE.md).
 * L'API PUBBLICA HA ANCORA LA SUA COPIA della stessa somma, senza servizi accessori
 * (app/api/v1/shipments per l'addebito, app/api/v1/rates per il preventivo): chi cambia la formula
 * qui deve allinearla li', altrimenti lo stesso pacco costa una cifra dal portale e un'altra via API.
 *
 * NON decide se il contratto e' OFFRIBILE a quel cliente (disattivato, in pausa, a un punto, fuori
 * catena...): quelli sono cancelli del motore del preventivo e della creazione. Qui si risponde a
 * una domanda sola: con QUESTO contratto, per QUESTA spedizione, il listino quanto fa pagare. */
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'

export type EsitoPrezzoCliente =
  | {
      ok: true
      // Totale addebitato: trasporto (nolo + fuel + sponda + supplemento origine) + commissione
      // contrassegno + assicurazione + servizi accessori.
      prezzo: number
      // Solo il trasporto: e' la base su cui si calcolano gli accessori a percentuale.
      trasporto: number
      zona: string
      // false = contrassegno o assicurazione richiesti ma non previsti dal listino per quell'importo.
      // Il numero in `prezzo` in quel caso NON li contiene: chi chiama deve trattare il contratto come
      // non disponibile (la creazione lo rifiuta prima di arrivare qui).
      supplementiDisponibili: boolean
      // Gli accessori richiesti, con l'importo AUTOREVOLE riletto dal listino (uno non a listino → 0).
      // null se non ne sono stati chiesti.
      accessori: { nome: string; importo: number }[] | null
    }
  // Il listino non prezza questa destinazione con questo contratto (zona non coperta, zona speciale
  // senza fascia, origine non prezzata, peso oltre l'ultima fascia): non vendibile.
  | { ok: false }

export async function prezzoClienteDaListino(
  db: any,
  p: {
    listinoId: string
    corriereId: string
    provincia: string
    cap: string
    paese?: string | null
    citta?: string | null
    packages: any[]
    mittCap?: string | null
    mittProvincia?: string | null
    contrassegno?: number | string | null
    assicurazione?: number | string | null
    valoreMerce?: number | string | null
    serviziAccessori?: { nome: string; importo?: number }[] | null
  },
): Promise<EsitoPrezzoCliente> {
  // Peso reale = SOMMA di tutti i colli: e' la banda di peso su cui si sceglie lo scaglione del
  // contrassegno (la commissione di alcuni corrieri dipende dal peso).
  const pesoReale = (Array.isArray(p.packages) ? p.packages : []).reduce((s: number, c: any) => s + (parseFloat(c?.weight) || 0), 0) || 1

  const risPrezzo = await calcolaPrezzoListino(db, {
    listinoId: p.listinoId, corriereId: p.corriereId,
    provincia: p.provincia, cap: p.cap,
    paese: p.paese || 'IT', citta: p.citta as any, packages: p.packages,
    mittCap: p.mittCap as any, mittProvincia: p.mittProvincia as any, mittPaese: 'IT',
  })
  if (!risPrezzo) return { ok: false }

  const suppPrezzo = await calcolaSupplementiCliente(db, {
    listinoId: p.listinoId, corriereId: p.corriereId,
    contrassegno: Number(p.contrassegno || 0), assicurazione: Number(p.assicurazione || 0),
    valoreMerce: Number(p.valoreMerce || 0), nolo: risPrezzo.prezzo, pesoReale,
  })

  // Servizi accessori RICALCOLATI lato SERVER: non fidarsi dell'importo mandato dal browser. Rileggo le
  // righe accessorie del listino cliente per QUESTO corriere e riapplico prezzo + perc% del NOLO
  // (risPrezzo.prezzo = nolo+fuel+sponda, la stessa base del frontend). Un accessorio non a listino → 0.
  // Cosi' il prezzo server include gli accessori reali: "pago meno sull'extra" o "extra inventato" non passano.
  let accessori: { nome: string; importo: number }[] | null = null
  let accessoriServer = 0
  if (p.serviziAccessori && p.serviziAccessori.length) {
    const { data: accRows } = await db.from('listini_clienti_supplementi')
      .select('nome,descrizione,valore').eq('listino_id', p.listinoId)
      .eq('corriere_id', p.corriereId).eq('tipo', 'accessorio')
    const mappaAcc = new Map<string, { prezzo: number; perc: number }>()
    for (const s of (accRows || [])) {
      let d: any = null; try { d = JSON.parse((s as any).descrizione) } catch {}
      const nome = String((s as any).nome || d?.nome || '').trim().toLowerCase()
      if (nome) mappaAcc.set(nome, { prezzo: Number(d?.prezzo ?? (s as any).valore ?? 0) || 0, perc: Number(d?.perc ?? 0) || 0 })
    }
    // Riscrivo gli importi con quelli AUTOREVOLI (base nolo): cosi' anche lo storico non e' del browser.
    accessori = p.serviziAccessori.map((v: any) => {
      const m = mappaAcc.get(String(v.nome || '').trim().toLowerCase())
      const importo = m ? Math.round((m.prezzo + (m.perc / 100) * risPrezzo.prezzo) * 100) / 100 : 0
      return { nome: v.nome, importo }
    })
    accessoriServer = accessori.reduce((s: number, v: any) => s + (Number(v.importo) || 0), 0)
  }

  return {
    ok: true,
    prezzo: Math.round((risPrezzo.prezzo + suppPrezzo.contrassegno + suppPrezzo.assicurazione + accessoriServer) * 100) / 100,
    trasporto: risPrezzo.prezzo,
    zona: risPrezzo.zona,
    supplementiDisponibili: suppPrezzo.disponibile,
    accessori,
  }
}
