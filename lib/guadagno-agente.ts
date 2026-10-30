import { clientiAgente } from '@/lib/agente'
import { creaCalcolatoreListinoCliente } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'
import { spedizioniConColliLeggeri } from '@/lib/colli-senza-etichette'

// GUADAGNO DI UN AGENTE nel periodo, secondo il metodo di compenso che il master gli ha assegnato.
// Quattro strade esclusive:
//  - 'listino'    : margine = quello che il cliente paga − il costo dal LISTINO AGENTE (come oggi).
//  - 'perc_lordo' : valore% × il LORDO (quello che il cliente paga, il fatturato).
//  - 'perc_netto' : valore% × il NETTO = margine del MASTER (cliente paga − costo reale del master).
//  - 'fisso'      : valore € × numero di spedizioni.
// I clienti dell'agente sono agganciati per nome (clienti.agente). Tutto sui movimenti reali, come i
// report del master, così i numeri combaciano (rettifiche/resi/giacenze compresi).
const TIPI = ['spedizione', 'rimborso', 'rettifica', 'reso', 'giacenza']
const r2 = (x: number) => Math.round(x * 100) / 100

// Una pagina che non si legge fa fallire il calcolo: fetchAll la saltava in silenzio, e il compenso
// usciva calcolato su una parte delle spedizioni senza che nessuno lo sapesse.
function leggiTutto(build: () => any): Promise<any[]> {
  return fetchAll(() => {
    const q = build()
    return { range: (a: number, b: number) => q.range(a, b).then((r: any) => { if (r.error) throw new Error(r.error.message); return r }) }
  })
}
// Liste di id a blocchi di 200: oltre ~25 KB di indirizzo PostgREST risponde 400.
async function perBlocchi<T>(ids: string[], fn: (blocco: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  const blocchi: string[][] = []
  for (let i = 0; i < ids.length; i += 200) blocchi.push(ids.slice(i, i + 200))
  for (let i = 0; i < blocchi.length; i += 6) {
    for (const parte of await Promise.all(blocchi.slice(i, i + 6).map(fn))) out.push(...parte)
  }
  return out
}

export type CompensoAgente = {
  master_id: string
  nome?: string | null
  cognome?: string | null
  agente_metodo?: string | null
  agente_valore?: number | null
  listino_agente_id?: string | null
}

export type EsitoGuadagnoAgente = {
  guadagno: number
  numSpedizioni: number
  lordo: number          // quello che i clienti dell'agente hanno pagato
  base: number           // la base su cui è calcolato il compenso (margine, lordo, o n. sped)
  // MARGINE DELL'AGENTE sui suoi clienti = lordo − costo del SUO listino. SEMPRE (qualunque metodo di
  // compenso): è il dato che il master vuole nel report, MAI il netto del master (che è il margine di M).
  // null se l'agente non ha un listino assegnato → non calcolabile.
  margineAgente: number | null
  metodo: string
  valore: number
  senzaListino?: boolean  // metodo 'listino' ma senza listino assegnato → guadagno non calcolabile
}

export async function calcolaGuadagnoAgente(
  admin: any,
  agente: CompensoAgente,
  dal: string,
  alEnd: string,
): Promise<EsitoGuadagnoAgente> {
  const M = agente.master_id
  const metodo = (agente.agente_metodo || 'listino')
  const valore = Number(agente.agente_valore) || 0
  const vuoto: EsitoGuadagnoAgente = { guadagno: 0, numSpedizioni: 0, lordo: 0, base: 0, margineAgente: null, metodo, valore }

  const clienti = await clientiAgente(admin, agente as any)
  if (!clienti.length) return vuoto

  // Spedizioni dei suoi clienti nel periodo (le annullate non contano).
  // NIENTE colli_dettaglio: contiene le etichette in base64 (3,73 GB per i clienti degli agenti di
  // spedizioni 2000 in due settimane), e il report andava in errore per memoria a 2,2 GB. Il calcolatore
  // del listino agente tassa sul peso_fatturato salvato (gia' collo per collo) e, senza dettaglio, sulle
  // misure della spedizione: sono le stesse colonne che usano il Report Spedizioni e la dashboard
  // dell'agente. Provato su un mese di spedizioni vere degli agenti con listino, multicollo compresi:
  // stesso costo agente su ogni spedizione (vedi rapporto del 15/10/2026).
  // Ordine stabile (data + id): con la sola data le righe con lo stesso istante (import in blocco)
  // potevano cambiare pagina fra una lettura e l'altra, e finire contate due volte o perse.
  const sped = await perBlocchi(clienti, b => leggiTutto(() => admin.from('spedizioni')
    .select('id,cliente_id,costo_totale,stato,corriere_id,peso_reale,peso_fatturato,colli,lunghezza,larghezza,altezza,dest_cap,dest_provincia,dest_citta,dest_paese,contrassegno,assicurazione,servizi_accessori,created_at')
    .in('cliente_id', b).gte('created_at', dal).lte('created_at', alEnd)
    .not('stato', 'in', '(annullata)')
    .order('created_at', { ascending: false }).order('id', { ascending: false })))
  const numSpedizioni = sped.length
  if (!numSpedizioni) return vuoto
  const spedIds = sped.map((s: any) => s.id)
  const clienteDi = new Map<string, string>(sped.map((s: any) => [s.id, s.cliente_id]))

  // Movimenti delle spedizioni, letti una volta sola: servono sia al lordo sia al costo del master.
  const mvs = await perBlocchi(spedIds, b => leggiTutto(() => admin.from('movimenti')
    .select('id,spedizione_id,cliente_id,master_target_id,importo').in('tipo', TIPI)
    .in('spedizione_id', b).order('spedizione_id', { ascending: true }).order('id', { ascending: true })))

  // LORDO per spedizione = quello che il cliente ha pagato DAVVERO (movimenti del cliente), come i
  // report. Segno: addebito negativo → +, rimborso positivo → − (le annullate si nettano a 0). Serve a
  // TUTTI i metodi — ora anche al FISSO — perché il margine dell'agente si calcola sempre.
  // SOLO i movimenti del cliente della spedizione: giacenze, resi e rettifiche dei conti "(ingrosso)"
  // dei contratti condivisi stanno sulla stessa spedizione d'origine, e contati qui gonfiavano il
  // lordo (agenti di spedizioni 2000, 1-14/10/2026: +1.819,20 €).
  const lordoPerSped = new Map<string, number>()
  // COSTO DEL MASTER per spedizione = tutto quello che gli viene addebitato su quella spedizione:
  // movimenti con master_target_id = M e senza cliente, da chiunque arrivino. Contare solo quelli che
  // M scrive a se stesso (master_id = M, il conto 'proprio') ignorava cio' che gli addebita il PADRE,
  // cioe' quasi tutto: spedizioni 2000, 1-14/10/2026, compenso 3.576,49 € invece di ~804.
  const costoMasterPerSped = new Map<string, number>()
  for (const mv of mvs) {
    const k = mv.spedizione_id
    const imp = -Number(mv.importo || 0)
    if (mv.cliente_id) {
      if (mv.cliente_id === clienteDi.get(k)) lordoPerSped.set(k, (lordoPerSped.get(k) || 0) + imp)
    } else if (mv.master_target_id === M) {
      costoMasterPerSped.set(k, (costoMasterPerSped.get(k) || 0) + imp)
    }
  }
  const lordoDi = (s: any) => lordoPerSped.has(s.id) ? lordoPerSped.get(s.id)! : Number(s.costo_totale || 0)
  const lordoTot = r2(sped.reduce((t: number, s: any) => t + lordoDi(s), 0))

  // MARGINE DELL'AGENTE (sempre, qualunque sia il metodo di compenso): lordo − costo del SUO listino.
  // È il dato che entra nel report ("Margine agente"), MAI il netto del master. Senza listino agente
  // assegnato non è calcolabile → null (il report mostra "—", non il margine del master).
  // Spedizione su un contratto che il suo listino NON copre: margine 0 (costo = lordo), come nella
  // dashboard dell'agente. Il ripiego di prima su costo_spedizione usava il costo di chi sta SOPRA.
  const listinoAg = agente.listino_agente_id || null
  let costoAgTot: number | null = null
  if (listinoAg) {
    const calcCosto = await creaCalcolatoreListinoCliente(admin, listinoAg)
    // Il listino prezza collo per collo (peso e lati di ognuno): si attaccano alle righe i colli SENZA
    // etichette, gli stessi oggetti di prima per tutto cio' che il calcolo legge.
    const colli = await spedizioniConColliLeggeri(admin, spedIds, '')
    for (const s of (sped || [])) (s as any).colli_dettaglio = colli.get((s as any).id)?.colli_dettaglio ?? []
    let t = 0
    for (const s of sped) {
      const cAg = calcCosto(s)?.totale
      t += (cAg != null) ? cAg : lordoDi(s)
    }
    costoAgTot = r2(t)
  }
  const margineAgente = costoAgTot != null ? r2(lordoTot - costoAgTot) : null

  // FISSO: compenso fisso per spedizione (il margine agente resta quello calcolato sopra).
  if (metodo === 'fisso') {
    return { guadagno: r2(valore * numSpedizioni), numSpedizioni, lordo: lordoTot, base: numSpedizioni, margineAgente, metodo, valore }
  }
  if (metodo === 'perc_lordo') {
    return { guadagno: r2(valore / 100 * lordoTot), numSpedizioni, lordo: lordoTot, base: lordoTot, margineAgente, metodo, valore }
  }

  if (metodo === 'perc_netto') {
    // NETTO = margine del MASTER = lordo − costo reale del master (sopra).
    // Una spedizione senza costo del master leggibile qui vale netto 0, non il lordo intero: succede se
    // il master la paga SOLO sul suo conto "(ingrosso)" presso chi gli vende il contratto (cliente_id
    // valorizzato, quindi fuori dalla somma). Al 15/10/2026 non ce n'e' nessuna (spedizioni 2000:
    // costo trovato su tutte le 14.201 di ottobre dei clienti degli agenti), ma contarla a lordo
    // pieno farebbe pagare all'agente la percentuale sull'intero prezzo.
    let nettoTot = 0
    for (const s of sped) nettoTot += costoMasterPerSped.has(s.id) ? lordoDi(s) - costoMasterPerSped.get(s.id)! : 0
    nettoTot = r2(nettoTot)
    // base = netto del MASTER (serve solo a spiegare il calcolo del %); il report però mostra margineAgente.
    return { guadagno: r2(valore / 100 * nettoTot), numSpedizioni, lordo: lordoTot, base: nettoTot, margineAgente, metodo, valore }
  }

  // LISTINO (default): il compenso È il margine dell'agente = lordo − costo del suo listino, cioè
  // esattamente margineAgente già calcolato sopra. Senza listino il guadagno non è calcolabile.
  if (costoAgTot == null || margineAgente == null) return { ...vuoto, numSpedizioni, lordo: lordoTot, senzaListino: true }
  return { guadagno: margineAgente, numSpedizioni, lordo: lordoTot, base: costoAgTot, margineAgente, metodo, valore }
}
