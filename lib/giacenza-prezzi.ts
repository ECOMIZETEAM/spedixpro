// PREZZI DELLA GIACENZA — quanto costa al cliente lo svincolo (riconsegna / riconsegna a nuovo
// destinatario / reso).
//
// Stavano dentro app/api/giacenze/[id]/route.ts, quindi l'API pubblica non poteva usarli: la
// rotta /api/v1/stocks/[id] scriveva la richiesta con costi a ZERO fissi. Alla conferma il
// cliente non veniva addebitato (la cascata salta l'addebito se l'importo e' zero) ma il master
// e tutta la catena sopra pagavano lo stesso: riconsegne e resi gratis, a spese del master.
// Il calcolo deve essere UNO solo, per il portale e per l'API.

import { noloCliente } from '@/lib/reso-prezzi'

// Mappa i nomi dei servizi giacenza del listino sulle 3 operazioni
export function chiaveServizio(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (n.includes('nuovo')) return 'riconsegna_nuovo'
  if (n.includes('reso')) return 'reso'
  if (n.includes('riconsegna')) return 'riconsegna'
  return null
}

export const prezziVuoti = () => ({ apertura: 0, servizi: { riconsegna: { valore: 0, perc: 0 }, riconsegna_nuovo: { valore: 0, perc: 0 }, reso: { valore: 0, perc: 100 } } } as any)

// Legge i prezzi giacenza da un listino CLIENTE (o agente, che è un listino cliente assegnato).
export async function leggiPrezziDaListino(admin: any, listinoId: string | null | undefined, corriereId: string | null) {
  const out = prezziVuoti()
  if (!listinoId) return out
  let q = admin.from('listini_clienti_supplementi').select('tipo,nome,valore,descrizione,corriere_id').eq('listino_id', listinoId).in('tipo', ['giacenza', 'giacenza_apertura'])
  if (corriereId) q = q.eq('corriere_id', corriereId)
  const { data: suppl } = await q.order('id', { ascending: true })   // duplicati: vince il primo, come sopra
  let aperturaSet = false
  const servizioSet: Record<string, boolean> = {}
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aperturaSet) { out.apertura = Number(s.valore) || 0; aperturaSet = true } continue }
    const k = chiaveServizio(s.nome)
    if (!k || servizioSet[k]) continue
    let perc = 0
    try { perc = Number(JSON.parse(s.descrizione || '{}')?.perc) || 0 } catch { /* descrizione non JSON */ }
    out.servizi[k] = { valore: Number(s.valore) || 0, perc }
    servizioSet[k] = true
  }
  return out
}

// Legge i prezzi giacenza dal listino del cliente della spedizione (prezzo CLIENTE).
export async function leggiPrezzi(admin: any, sped: any) {
  const { data: cliente } = await admin.from('clienti').select('listino_cliente_id').eq('id', sped.cliente_id).maybeSingle()
  return leggiPrezziDaListino(admin, cliente?.listino_cliente_id, sped.corriere_id)
}

// Nolo base del cliente senza assicurazione (le commissioni assicurazione/contrassegno
// NON entrano nel calcolo del reso).
// RIPIEGO: il costo totale porta dentro anche la commissione contrassegno, che qui non ci va. Si
// usa solo se il nolo non e' ricalcolabile dal listino (vedi noloClienteSpedizione).
export function noloBase(sped: any) {
  return Math.max(0, (Number(sped.costo_totale) || 0) - (Number(sped.assicurazione) || 0))
}

// Nolo VERO del cliente per quella spedizione: ricalcolato dal suo listino, quindi senza
// commissione contrassegno ne' assicurazione. E' la stessa base che usa la scansione resi, cosi'
// lo stesso reso costa uguale da qualsiasi parte arrivi.
export async function noloClienteSpedizione(admin: any, sped: any): Promise<number> {
  if (!sped?.cliente_id) return noloBase(sped)
  const { data: cliente } = await admin.from('clienti').select('listino_cliente_id').eq('id', sped.cliente_id).maybeSingle()
  const n = await noloCliente(admin, sped, cliente?.listino_cliente_id)
  return n != null ? n : noloBase(sped)
}

// Costi dell'operazione di SVINCOLO = SOLO il servizio scelto (riconsegna/reso/…).
// L'apertura giacenza è addebitata a parte all'ENTRATA in giacenza (dal cron), quindi NON entra
// nel totale dell'operazione di svincolo. costo_apertura resta come info (già addebitata).
export function calcolaCosti(operazione: string, prezzi: any, sped: any, baseNolo?: number | null) {
  const base = baseNolo != null && baseNolo >= 0 ? baseNolo : noloBase(sped)
  const serv = prezzi.servizi[operazione] || { valore: 0, perc: 0 }
  const costoServizio = (Number(serv.valore) || 0) + ((Number(serv.perc) || 0) / 100) * base
  const costoApertura = operazione === 'reso' ? 0 : (Number(prezzi.apertura) || 0)
  return { costo_apertura: +costoApertura.toFixed(2), costo_servizio: +costoServizio.toFixed(2), costo_totale: +costoServizio.toFixed(2) }
}
