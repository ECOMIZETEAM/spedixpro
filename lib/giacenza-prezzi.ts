// PREZZI DELLA GIACENZA — quanto costa al cliente lo svincolo (riconsegna / riconsegna a nuovo
// destinatario / reso).
//
// Stavano dentro app/api/giacenze/[id]/route.ts, quindi l'API pubblica non poteva usarli: la
// rotta /api/v1/stocks/[id] scriveva la richiesta con costi a ZERO fissi. Alla conferma il
// cliente non veniva addebitato (la cascata salta l'addebito se l'importo e' zero) ma il master
// e tutta la catena sopra pagavano lo stesso: riconsegne e resi gratis, a spese del master.
// Il calcolo deve essere UNO solo, per il portale e per l'API.

import { noloClienteDopoPartenzaCon } from '@/lib/reso-prezzi'
import type { FonteCliente } from '@/lib/prezzi-archivio'

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
  if (!listinoId) return prezziVuoti()
  let q = admin.from('listini_clienti_supplementi').select('tipo,nome,valore,descrizione,corriere_id').eq('listino_id', listinoId).in('tipo', ['giacenza', 'giacenza_apertura'])
  if (corriereId) q = q.eq('corriere_id', corriereId)
  const { data: suppl } = await q.order('id', { ascending: true })   // duplicati: vince il primo, come sopra
  return prezziDaRighe(suppl || [])
}

// Le righe giacenza di un listino (vive o archiviate), gia' in ordine di id, nei prezzi delle 3 operazioni.
function prezziDaRighe(suppl: any[]) {
  const out = prezziVuoti()
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

// LA FONTE DEI PREZZI DI GIACENZA DEL CLIENTE, una per pacco: la stessa da cui viene il nolo.
// Il servizio e' "fisso + percentuale × nolo": fisso, percentuale e nolo devono venire dallo stesso
// listino. Prima i servizi si leggevano dal primo listino che aveva ancora il contratto e il nolo dal
// primo che prezzava il pacco: col cliente spostato da A a B e B che non copre la destinazione, il
// riquadro mostrava il nolo di A per la percentuale di B, e il reso addebitato (percentuale di A) era
// un altro numero (revisione 26/11). Le fonti e il loro ordine li decide lib/prezzi-archivio.ts.
async function fonteGiacenza(admin: any, sped: any): Promise<{ nolo: number | null; fonte: FonteCliente | null; oggi: string | null }> {
  if (!sped?.cliente_id) return { nolo: null, fonte: null, oggi: null }
  // Lettura fallita: nessun listino di oggi, come prima (mai un errore a meta' di uno svincolo).
  const { data: cliente } = await admin.from('clienti').select('listino_cliente_id').eq('id', sped.cliente_id).maybeSingle()
  const oggi = cliente?.listino_cliente_id || null
  const n = await noloClienteDopoPartenzaCon(admin, sped, oggi)
  return { nolo: n.nolo, fonte: n.fonte, oggi }
}

// I prezzi giacenza di una fonte: le righe vive del listino, o quelle archiviate se il listino non ha piu'
// supplementi di quel contratto (stessa precedenza di fn_reso_perc_cliente: vince il vivo).
async function prezziDaFonte(admin: any, f: FonteCliente, corriereId: string | null) {
  if (f.archivio?.supplementi) {
    return prezziDaRighe(f.archivio.supplementi.filter((s: any) => s.tipo === 'giacenza' || s.tipo === 'giacenza_apertura'))
  }
  return leggiPrezziDaListino(admin, f.listinoId, corriereId)
}

// Legge i prezzi giacenza del cliente della spedizione (prezzo CLIENTE), dalla stessa fonte del nolo.
// Se nessun listino prezza piu' il pacco, come prima: quello che c'e' nel listino di oggi.
export async function leggiPrezzi(admin: any, sped: any) {
  const { fonte, oggi } = await fonteGiacenza(admin, sped)
  if (fonte) return prezziDaFonte(admin, fonte, sped.corriere_id)
  return leggiPrezziDaListino(admin, oggi, sped.corriere_id)
}

// RIPIEGO per le spedizioni SENZA cliente (del master stesso): quanto era costata l'andata. Per un
// cliente non si usa piu': il nolo viene dal suo listino, anche a contratto tolto (noloClienteSpedizione).
//
// ATTENZIONE — qui c'era una trappola di unita' di misura. `spedizioni.assicurazione` NON e' la
// commissione dell'assicurazione: e' il VALORE dichiarato della merce (lo stesso numero che parte
// verso il corriere come importo assicurato). Sottrarlo dal costo faceva crollare la base a zero:
// in archivio, su 22 spedizioni assicurate, TUTTE hanno il valore assicurato piu' alto del costo
// di trasporto — 500 EUR di merce contro 9,75 di nolo. E uno zero qui non e' innocuo: il cliente
// non pagava niente e la rete sopra di lui veniva addebitata lo stesso.
// Il costo totale porta dentro le commissioni, quindi questo ripiego sovrastima di poco: e' il
// verso giusto in cui sbagliare.
export function noloBase(sped: any) {
  return Math.max(0, Number(sped.costo_totale) || 0)
}

// Nolo VERO del cliente per quella spedizione: ricalcolato dal suo listino, quindi senza
// commissione contrassegno ne' assicurazione. E' la stessa base che usa la scansione resi, cosi'
// lo stesso reso costa uguale da qualsiasi parte arrivi.
export async function noloClienteSpedizione(admin: any, sped: any): Promise<number> {
  if (!sped?.cliente_id) return noloBase(sped)
  // Dal listino, anche a contratto tolto o listino cambiato (fonteGiacenza, la stessa dei prezzi); mai il
  // ripiego sul prezzo pieno, che ha dentro le commissioni. Senza cliente (spedizione del master) resta il
  // ripiego sopra. Se nessun listino prezza piu' il pacco la base e' 0, come prima: la parte fissa del
  // servizio si paga, la percentuale no.
  return (await fonteGiacenza(admin, sped)).nolo ?? 0
}

// Costi dell'operazione di SVINCOLO = SOLO il servizio scelto (riconsegna/reso/…).
// L'apertura giacenza è addebitata a parte all'ENTRATA in giacenza (dal cron), quindi NON entra
// nel totale dell'operazione di svincolo. costo_apertura resta come info (già addebitata).
//
// LA % SI APPLICA SEMPRE SUL NOLO (fascia/zona + fuel), per TUTTE le operazioni — riconsegna, nuovo
// destinatario e reso — e UGUALE per il cliente e per la catena dei master (Lorenzo 11/09: "si paga
// sul nolo fascia/zona + fuel come il reso"). Prima solo il reso usava il nolo; riconsegna/nuovo
// usavano costo_totale (col contrassegno/assicurazione/sponda dentro), così il CLIENTE pagava la %
// su costo_totale mentre i MASTER a monte (addebitaGiacenzaCatena → noloMaster) la pagavano sul nolo
// fascia/zona: stessa operazione, due basi diverse. `baseNolo` è il nolo fascia/zona già calcolato da
// chi chiama (noloClienteSpedizione); il ripiego a costo_totale vale solo senza cliente.
export function calcolaCosti(operazione: string, prezzi: any, sped: any, baseNolo?: number | null) {
  const base = baseNolo != null && baseNolo >= 0 ? baseNolo : noloBase(sped)
  const serv = prezzi.servizi[operazione] || { valore: 0, perc: 0 }
  const costoServizio = (Number(serv.valore) || 0) + ((Number(serv.perc) || 0) / 100) * base
  const costoApertura = operazione === 'reso' ? 0 : (Number(prezzi.apertura) || 0)
  return { costo_apertura: +costoApertura.toFixed(2), costo_servizio: +costoServizio.toFixed(2), costo_totale: +costoServizio.toFixed(2) }
}
