import { livelloResi, GRAVITA, type LivelloResi } from '@/lib/resi-percentuale'

// L'ANALISI RESI DI UNA RETE: i clienti diretti del master e i suoi sotto-master, ciascuno coi propri
// clienti e i propri sotto-master, a qualunque profondita'. Ogni nodo porta spedizioni partite, resi e
// colore (lib/resi-percentuale); un sotto-master porta il totale della sua rete e quanti clienti colorati
// ci sono dentro, cosi' un problema in fondo alla rete si vede gia' dalla prima riga.
// I numeri li conta il database (resi_per_cliente_v2); qui si mettono solo in fila. Un reso conta nel giorno
// in cui rientra (24/10/2026): un cliente che nel periodo non ha spedito ma ha avuto rientri resta, con 0
// partite — e' proprio il caso da vedere, un cliente che smette di spedire mentre i pacchi gli tornano indietro.

export type NodoResi = {
  tipo: 'cliente' | 'master'
  id: string
  nome: string
  partite: number
  resi: number
  pct: number
  livello: LivelloResi
  allarmi: { giallo: number; arancione: number; rosso: number }
  gravita: number            // per ordinare: il caso peggiore dentro il nodo
  figli?: NodoResi[]
}

export type AnalisiResi = {
  giorni: number
  totale: { partite: number; resi: number; pct: number; livello: LivelloResi }
  allarmi: { giallo: number; arancione: number; rosso: number }
  peggiori: { id: string; nome: string; master: string; partite: number; resi: number; pct: number; livello: LivelloResi }[]
  nodi: NodoResi[]
}

// Prima i casi peggiori: per un sotto-master conta quanti clienti rossi, poi arancioni, poi gialli ha dentro
// (non la percentuale della sua rete, che una rete grande e sana abbassa); a pari merito la percentuale.
const ordina = (a: NodoResi, b: NodoResi) =>
  b.gravita - a.gravita || b.allarmi.rosso - a.allarmi.rosso || b.allarmi.arancione - a.allarmi.arancione
  || b.allarmi.giallo - a.allarmi.giallo || b.pct - a.pct || b.partite - a.partite

export async function analisiResiRete(
  admin: any, masterId: string, giorni: number, opz: { soloClienti?: string[] } = {},
): Promise<AnalisiResi> {
  const dal = new Date(Date.now() - giorni * 864e5).toISOString()
  // Un solo valore json, non una riga per cliente: le risposte si fermano a 1.000 righe (vedi lo script SQL).
  const { data: righe, error } = await admin.rpc('resi_per_cliente_v2', { p_master: masterId, p_dal: dal })
  if (error) throw new Error('Analisi resi non riuscita: ' + error.message)
  let rr: { master_id: string; cliente_id: string; partite: number; resi: number }[] =
    (Array.isArray(righe) ? righe : []).map((r: any) => ({ ...r, partite: Number(r.partite) || 0, resi: Number(r.resi) || 0 })).filter((r: any) => r.partite > 0 || r.resi > 0)
  if (opz.soloClienti) { const ok = new Set(opz.soloClienti); rr = rr.filter(r => ok.has(r.cliente_id)) }

  const { data: ms } = await admin.from('masters').select('id,nome,parent_master_id')
  const nomeMaster = new Map<string, string>((ms || []).map((m: any) => [m.id, m.nome]))
  const figliMaster = new Map<string, string[]>()
  for (const m of (ms || [])) if (m.parent_master_id) figliMaster.set(m.parent_master_id, [...(figliMaster.get(m.parent_master_id) || []), m.id])

  const idsClienti = [...new Set(rr.map(r => r.cliente_id))]
  const nomeCliente = new Map<string, string>()
  for (let i = 0; i < idsClienti.length; i += 300) {
    const { data } = await admin.from('clienti').select('id,ragione_sociale').in('id', idsClienti.slice(i, i + 300))
    for (const c of (data || [])) nomeCliente.set(c.id, c.ragione_sociale || 'Cliente')
  }

  // Righe per master della spedizione (un cliente, di norma, sta sotto un master solo).
  const perMaster = new Map<string, typeof rr>()
  for (const r of rr) perMaster.set(r.master_id, [...(perMaster.get(r.master_id) || []), r])

  const peggiori: AnalisiResi['peggiori'] = []
  const nodoMaster = (id: string, visti: Set<string>): NodoResi => {
    visti.add(id)
    const figli: NodoResi[] = []
    const perCliente = new Map<string, { partite: number; resi: number }>()
    for (const r of (perMaster.get(id) || [])) {
      const a = perCliente.get(r.cliente_id) || { partite: 0, resi: 0 }
      a.partite += r.partite; a.resi += r.resi; perCliente.set(r.cliente_id, a)
    }
    for (const [cid, a] of perCliente) {
      const { pct, livello } = livelloResi(a.partite, a.resi)
      const allarmi = { giallo: 0, arancione: 0, rosso: 0 }
      if (livello === 'giallo' || livello === 'arancione' || livello === 'rosso') allarmi[livello]++
      const nome = nomeCliente.get(cid) || 'Cliente'
      figli.push({ tipo: 'cliente', id: cid, nome, partite: a.partite, resi: a.resi, pct, livello, allarmi, gravita: GRAVITA[livello] })
      if (livello !== 'ok' && livello !== 'pochi') peggiori.push({ id: cid, nome, master: nomeMaster.get(id) || '', partite: a.partite, resi: a.resi, pct, livello })
    }
    for (const sub of (figliMaster.get(id) || [])) {
      if (visti.has(sub)) continue
      const n = nodoMaster(sub, visti)
      if (n.partite > 0 || n.resi > 0) figli.push(n)
    }
    figli.sort(ordina)
    const partite = figli.reduce((s, f) => s + f.partite, 0)
    const resi = figli.reduce((s, f) => s + f.resi, 0)
    const { pct, livello } = livelloResi(partite, resi)
    const allarmi = figli.reduce((s, f) => ({ giallo: s.giallo + f.allarmi.giallo, arancione: s.arancione + f.allarmi.arancione, rosso: s.rosso + f.allarmi.rosso }), { giallo: 0, arancione: 0, rosso: 0 })
    return { tipo: 'master', id, nome: nomeMaster.get(id) || 'Master', partite, resi, pct, livello, allarmi, gravita: Math.max(0, ...figli.map(f => f.gravita)), figli }
  }

  const radice = nodoMaster(masterId, new Set())
  peggiori.sort((a, b) => GRAVITA[b.livello] - GRAVITA[a.livello] || b.pct - a.pct)
  return {
    giorni,
    totale: { partite: radice.partite, resi: radice.resi, pct: radice.pct, livello: radice.livello },
    allarmi: radice.allarmi,
    peggiori,
    nodi: radice.figli || [],
  }
}

// La percentuale di UN cliente (il suo portale).
export async function percentualeResiCliente(admin: any, clienteId: string, giorni: number) {
  const dal = new Date(Date.now() - giorni * 864e5).toISOString()
  const { data, error } = await admin.rpc('resi_per_cliente_v2', { p_master: null, p_dal: dal, p_cliente: clienteId })
  if (error) throw new Error('Percentuale resi non riuscita: ' + error.message)
  const righe: any[] = Array.isArray(data) ? data : []
  const partite = righe.reduce((s: number, r: any) => s + (Number(r.partite) || 0), 0)
  const resi = righe.reduce((s: number, r: any) => s + (Number(r.resi) || 0), 0)
  return { giorni, partite, resi, ...livelloResi(partite, resi) }
}
