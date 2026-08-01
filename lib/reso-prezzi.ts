import { calcolaPrezzoListino, calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'

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

// NOLO del cliente per quella spedizione: SOLO il prezzo di fascia/zona (col fuel, che è una
// percentuale della fascia stessa e non un servizio a parte). Niente contrassegno, niente
// assicurazione, niente sponda: il pacco torna indietro e basta, non c'è niente da incassare, da
// assicurare o da scaricare con la sponda — quei supplementi il cliente li ha già pagati all'andata.
// null se non calcolabile.
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
  if (!ris || !(ris.prezzo > 0)) return null
  // Il motore somma la sponda al prezzo di fascia: qui si riscorpora e si toglie.
  const sponda = await spondaListinoCliente(admin, listinoId, ris.corriere_id, ris.peso_fatturato)
  return Math.max(0, r2(ris.prezzo - sponda)) || null
}

// Sponda idraulica del listino cliente: sopra la soglia, tot € per ogni kg fatturato.
// Serve solo per RIMUOVERLA dalla base del reso (stessa formula del motore prezzi).
async function spondaListinoCliente(admin: any, listinoId: string, corriereId: string | null, pesoFatturato: number): Promise<number> {
  if (!corriereId) return 0
  try {
    const { data: sp } = await admin.from('listini_clienti_supplementi')
      .select('descrizione,valore').eq('listino_id', listinoId).eq('corriere_id', corriereId).eq('tipo', 'sponda').maybeSingle()
    if (!sp) return 0
    let d: any = null; try { d = JSON.parse(sp.descrizione) } catch { /* descrizione non JSON */ }
    const soglia = Number(d?.soglia_kg) || 0
    const prezzoKg = Number(sp.valore) || 0
    return soglia > 0 && prezzoKg > 0 && pesoFatturato >= soglia ? r2(pesoFatturato * prezzoKg) : 0
  } catch { return 0 }
}

// NOLO di un MASTER per quella spedizione, dal SUO listino corrieri: fascia + fuel, e nient'altro.
// Stessa regola del cliente — sul ritorno non si paga ne' contrassegno ne' assicurazione ne'
// sponda. null se non calcolabile.
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
  if (!d) return null
  const nolo = r2((Number(d.nolo) || 0) + (Number(d.fuel) || 0))   // niente sponda, niente commissioni
  return nolo > 0 ? nolo : null
}

export function applicaServizio(p: PrezzoServizio, nolo: number): number {
  return r2((Number(p.valore) || 0) + ((Number(p.perc) || 0) / 100) * (Number(nolo) || 0))
}

// ── L'ADDEBITO DEL RESO LO FA IL DATABASE ─────────────────────────────────────────────────────
//
// Qui si calcola solo il NOLO (il motore tariffe vive in questa parte). La REGOLA — quale
// percentuale si applica, cosa fare se il listino non ha la riga, come impedire il doppio
// addebito — sta in fn_addebita_resi, cosi' esiste in un posto solo e non puo' piu' essere
// scritta in tre modi diversi da tre rotte diverse. E quella funzione scrive tutte le voci in
// UNA transazione: una distinta da cento lettere di vettura non puo' piu' restare addebitata a
// meta' se qualcosa va storto per strada.

export type RigaReso = {
  spedizione_id: string
  cliente_id?: string | null          // addebito al cliente...
  master_target_id?: string | null    // ...oppure a un master
  master_owner_id: string             // chi lo addebita
  corriere_id?: string | null         // la copia di contratto DI QUEL soggetto
  nolo: number
  pagato?: number                     // ripiego se il reso non e' configurato nel suo listino
  da_giacenza?: boolean               // e' lo svincolo stesso a chiamare: la guardia non si applica
}

export type EsitoReso = {
  spedizione_id: string
  esito: 'addebitato' | 'gia_addebitato' | 'zero' | 'inesistente'
  importo?: number
  cliente_id?: string | null
  master_target_id?: string | null
}

export async function addebitaResi(admin: any, righe: RigaReso[], createdBy?: string | null): Promise<EsitoReso[]> {
  const utili = (righe || []).filter(r => r && r.spedizione_id && (r.cliente_id || r.master_target_id))
  if (!utili.length) return []
  const { data, error } = await admin.rpc('fn_addebita_resi', {
    p_righe: utili,
    p_created_by: createdBy ?? null,
  })
  if (error) throw new Error('Addebito reso non riuscito: ' + error.message)
  return (Array.isArray(data) ? data : []) as EsitoReso[]
}

// Quanto quel soggetto aveva pagato la spedizione andata: e' il ripiego quando nel suo listino la
// riga del reso non c'e' proprio (diverso da configurata a zero, che vuol dire reso gratis).
export async function pagatoDaMaster(admin: any, spedizioneId: string, masterId: string): Promise<number> {
  const { data } = await admin.from('movimenti')
    .select('importo').eq('spedizione_id', spedizioneId).eq('master_target_id', masterId)
    .in('tipo', ['spedizione', 'rettifica'])
  return Math.abs((data || []).reduce((a: number, m: any) => a + (Number(m.importo) || 0), 0))
}
