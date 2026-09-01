import { clientiAgente } from '@/lib/agente'
import { creaCalcolatoreListinoCliente } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'

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
  const sped = await fetchAll(() => admin.from('spedizioni')
    .select('id,cliente_id,costo_totale,costo_spedizione,stato,corriere_id,peso_reale,peso_fatturato,colli,dest_cap,dest_provincia,dest_citta,dest_paese,colli_dettaglio,contrassegno,assicurazione,servizi_accessori,created_at')
    .in('cliente_id', clienti).gte('created_at', dal).lte('created_at', alEnd)
    .not('stato', 'in', '(annullata)')
    .order('created_at', { ascending: false }))
  const numSpedizioni = (sped || []).length
  if (!numSpedizioni) return vuoto
  const spedIds = (sped || []).map((s: any) => s.id)

  // LORDO per spedizione = quello che il cliente ha pagato DAVVERO (movimenti del cliente), come i
  // report. Segno: addebito negativo → +, rimborso positivo → − (le annullate si nettano a 0). Serve a
  // TUTTI i metodi — ora anche al FISSO — perché il margine dell'agente si calcola sempre.
  const lordoPerSped = new Map<string, number>()
  for (let i = 0; i < spedIds.length; i += 300) {
    const chunk = spedIds.slice(i, i + 300)
    const mvs = await fetchAll(() => admin.from('movimenti')
      .select('spedizione_id,importo').in('tipo', TIPI)
      .in('spedizione_id', chunk).not('cliente_id', 'is', null)
      .order('id', { ascending: true }))
    for (const mv of (mvs || [])) {
      const k = (mv as any).spedizione_id
      lordoPerSped.set(k, (lordoPerSped.get(k) || 0) + -Number((mv as any).importo || 0))
    }
  }
  let lordoTot = 0
  for (const s of (sped || [])) {
    const id = (s as any).id
    lordoTot += lordoPerSped.has(id) ? lordoPerSped.get(id)! : Number((s as any).costo_totale || 0)
  }
  lordoTot = r2(lordoTot)

  // MARGINE DELL'AGENTE (sempre, qualunque sia il metodo di compenso): lordo − costo del SUO listino.
  // È il dato che entra nel report ("Margine agente"), MAI il netto del master. Senza listino agente
  // assegnato non è calcolabile → null (il report mostra "—", non il margine del master).
  const listinoAg = agente.listino_agente_id || null
  let costoAgTot: number | null = null
  if (listinoAg) {
    const calcCosto = await creaCalcolatoreListinoCliente(admin, listinoAg)
    let t = 0
    for (const s of (sped || [])) {
      const cAg = calcCosto(s)?.totale
      t += (cAg != null) ? cAg : Number((s as any).costo_spedizione || 0)
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
    // NETTO = margine del MASTER = lordo − costo reale del master. Il costo del master per una
    // spedizione sono i suoi movimenti di COSTO (master_id = M, master_target_id = M): stessa regola
    // del Report Guadagno del master (riga "costo di M").
    const costoMasterPerSped = new Map<string, number>()
    for (let i = 0; i < spedIds.length; i += 300) {
      const chunk = spedIds.slice(i, i + 300)
      const mvs = await fetchAll(() => admin.from('movimenti')
        .select('spedizione_id,importo').in('tipo', TIPI)
        .in('spedizione_id', chunk).eq('master_id', M).eq('master_target_id', M)
        .order('id', { ascending: true }))
      for (const mv of (mvs || [])) {
        const k = (mv as any).spedizione_id
        costoMasterPerSped.set(k, (costoMasterPerSped.get(k) || 0) + -Number((mv as any).importo || 0))
      }
    }
    let nettoTot = 0
    for (const s of (sped || [])) {
      const id = (s as any).id
      const l = lordoPerSped.has(id) ? lordoPerSped.get(id)! : Number((s as any).costo_totale || 0)
      nettoTot += l - (costoMasterPerSped.get(id) || 0)
    }
    nettoTot = r2(nettoTot)
    // base = netto del MASTER (serve solo a spiegare il calcolo del %); il report però mostra margineAgente.
    return { guadagno: r2(valore / 100 * nettoTot), numSpedizioni, lordo: lordoTot, base: nettoTot, margineAgente, metodo, valore }
  }

  // LISTINO (default): il compenso È il margine dell'agente = lordo − costo del suo listino, cioè
  // esattamente margineAgente già calcolato sopra. Senza listino il guadagno non è calcolabile.
  if (costoAgTot == null || margineAgente == null) return { ...vuoto, numSpedizioni, lordo: lordoTot, senzaListino: true }
  return { guadagno: margineAgente, numSpedizioni, lordo: lordoTot, base: costoAgTot, margineAgente, metodo, valore }
}
