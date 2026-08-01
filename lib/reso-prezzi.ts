import { calcolaPrezzoListino, calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'

// QUANTO COSTA UN RESO — una regola sola, per tutti e due i modi in cui un reso nasce.
//
// Un reso arriva in due modi: dalla GIACENZA (si sceglie "Reso al mittente" e lo svincolo lo
// addebita subito, a cascata su tutta la rete) oppure dalla SCANSIONE (il pacco torna in sede, si
// legge la LDV e si chiude in distinta, che poi scende di livello in livello). E' lo stesso
// evento: deve costare lo stesso.
//
// Nei listini il reso e' quasi sempre una PERCENTUALE del nolo — 100% vuol dire "il pacco torna
// indietro, quindi si paga un'altra spedizione" — con il valore fisso a zero. Il calcolo lato
// CLIENTE la leggeva; quello lato MASTER no: leggeva solo il valore fisso, cioe' zero. Risultato:
// il cliente pagava il reso e tutta la rete sopra di lui lo prendeva gratis. Non e' un caso di
// confine: 163 listini corrieri su 168 hanno il reso a percentuale.
//
// La BASE e' sempre il NOLO: niente commissione contrassegno e niente assicurazione. Un pacco che
// torna indietro non ha soldi da incassare alla consegna ne' merce da assicurare, e il file dei
// prezzi giacenza lo diceva gia' a parole senza che il codice lo facesse.

export type PrezzoServizio = { valore: number; perc: number }

const r2 = (n: number) => Math.round(n * 100) / 100

// I colli di una spedizione nella forma che vuole il motore prezzi.
// ATTENZIONE al peso: nel dettaglio colli sta il peso DI QUEL COLLO. Il codice dei resi assegnava
// a ogni collo il peso_reale (che e' il totale della spedizione): una spedizione da 3 colli veniva
// prezzata come se pesasse il triplo, e il reso costava molto piu' della spedizione andata.
export function pacchiSpedizione(sped: any): any[] {
  const dett = Array.isArray(sped?.colli_dettaglio) ? sped.colli_dettaglio : []
  const num = (v: any) => Number(v) || 0
  if (dett.length) {
    const pacchi = dett.map((c: any) => ({
      weight: num(c?.peso ?? c?.weight),
      length: num(c?.lunghezza ?? c?.length ?? sped?.lunghezza),
      width: num(c?.larghezza ?? c?.width ?? sped?.larghezza),
      height: num(c?.altezza ?? c?.height ?? sped?.altezza),
    }))
    // Se i pesi per collo non ci sono (spedizioni vecchie), si torna al peso totale: meglio del
    // peso zero, che farebbe cadere tutto nella fascia piu' bassa.
    const somma = pacchi.reduce((s: number, p: any) => s + p.weight, 0)
    if (somma > 0) return pacchi
    const q = pacchi.length
    const totale = num(sped?.peso_reale) || 1
    return pacchi.map((p: any) => ({ ...p, weight: totale / q }))
  }
  const n = Math.max(1, Number(sped?.colli) || 1)
  const peso = (num(sped?.peso_reale) || 1) / n
  return Array.from({ length: n }, () => ({
    weight: peso, length: num(sped?.lunghezza), width: num(sped?.larghezza), height: num(sped?.altezza),
  }))
}

// NOLO del cliente per quella spedizione (fascia + fuel + sponda, senza contrassegno/assicurazione:
// il motore del listino cliente non li calcola nemmeno). null se non calcolabile.
export async function noloCliente(admin: any, sped: any, listinoId: string | null | undefined): Promise<number | null> {
  if (!listinoId) return null
  const ris = await calcolaPrezzoListino(admin, {
    listinoId,
    provincia: sped?.dest_provincia || '',
    cap: sped?.dest_cap || '',
    paese: sped?.dest_paese || 'IT',
    citta: sped?.dest_citta || '',   // CAP condivisi fra piu' comuni
    packages: pacchiSpedizione(sped),
    corriereId: sped?.corriere_id,
  })
  return ris?.prezzo != null && ris.prezzo > 0 ? ris.prezzo : null
}

// NOLO di un MASTER per quella spedizione, dal SUO listino corrieri. Si chiama senza contrassegno
// ne' assicurazione, cosi' il totale che torna e' gia' il solo nolo. null se non calcolabile.
export async function noloMaster(admin: any, masterId: string, corriereId: string, sped: any): Promise<number | null> {
  const pacchi = pacchiSpedizione(sped)
  const pesoReale = pacchi.reduce((s: number, p: any) => s + (Number(p?.weight) || 0), 0) || 1
  const d = await calcolaPrezzoCorriereDettaglio(admin, {
    corriereId, masterId,
    provincia: sped?.dest_provincia || '',
    cap: sped?.dest_cap || '',
    paese: sped?.dest_paese || 'IT',
    citta: sped?.dest_citta || '',
    pesoReale, packages: pacchi,
  })
  return d && d.totale > 0 ? d.totale : null
}

// Riga "Reso al mittente" (o altro servizio giacenza) dal LISTINO CORRIERI di un master.
// null = non configurata, che e' diverso da configurata a zero: nel primo caso si ripiega su
// quanto il master aveva pagato, nel secondo il reso e' davvero gratis per lui.
export async function servizioMaster(admin: any, corriereId: string, operazione: string): Promise<PrezzoServizio | null> {
  // Solo i listini del master PROPRIETARIO di quella copia di contratto: esistono righe che stanno
  // nel listino di un altro master ma puntano a questo corriere, e leggendo per solo corriere_id
  // scavalcherebbero il listino configurato (stesso motivo spiegato in giacenza-cascata).
  const { data: corr } = await admin.from('corrieri').select('master_id').eq('id', corriereId).maybeSingle()
  const { data: listini } = await admin.from('listini_corrieri').select('id').eq('master_id', (corr as any)?.master_id || '')
  const ids = (listini || []).map((l: any) => l.id)
  if (!ids.length) return null
  const { data: righe } = await admin.from('listini_corrieri_supplementi')
    .select('nome,valore,descrizione').eq('corriere_id', corriereId).in('listino_id', ids).eq('tipo', 'giacenza')
    .order('id', { ascending: true })   // con righe duplicate vince sempre la prima
  for (const s of (righe || [])) {
    if (chiaveServizio(s.nome) !== operazione) continue
    let perc = 0
    try { perc = Number(JSON.parse(s.descrizione || '{}')?.perc) || 0 } catch { /* descrizione non JSON */ }
    return { valore: Number(s.valore) || 0, perc }
  }
  return null
}

// Nome del servizio giacenza -> operazione (stessa mappa di giacenza-prezzi).
export function chiaveServizio(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (n.includes('nuovo')) return 'riconsegna_nuovo'
  if (n.includes('reso')) return 'reso'
  if (n.includes('riconsegna')) return 'riconsegna'
  return null
}

export function applicaServizio(p: PrezzoServizio, nolo: number): number {
  return r2((Number(p.valore) || 0) + ((Number(p.perc) || 0) / 100) * (Number(nolo) || 0))
}

/**
 * Quanto addebitare a un MASTER per il reso di una spedizione.
 * Il suo listino corrieri comanda (fisso + percentuale sul SUO nolo); se non ha quel contratto o
 * non ha configurato il reso, si ripiega su quanto aveva pagato la spedizione andata.
 */
export async function prezzoResoMaster(
  admin: any,
  params: { masterId: string; sped: any; corriereNome?: string | null; pagato: number },
): Promise<number> {
  const pagato = Math.max(0, Number(params.pagato) || 0)
  if (!params.corriereNome) return pagato
  const corrId = await corriereDiMasterPerNome(admin, params.masterId, params.corriereNome)
  if (!corrId) return pagato
  const serv = await servizioMaster(admin, corrId, 'reso')
  if (!serv) return pagato
  if (!(serv.perc > 0)) return r2(serv.valore)          // solo prezzo fisso: niente base da calcolare
  const nolo = await noloMaster(admin, params.masterId, corrId, params.sped)
  return applicaServizio(serv, nolo != null ? nolo : pagato)
}
