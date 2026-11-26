import { calcolaPrezzoListino, calcolaPrezzoCorriereDettaglio } from '@/lib/pricing'
import { fontiCliente, archivioCostoPerPacco, partenzaDi, type ArchivioCoppia, type FonteCliente } from '@/lib/prezzi-archivio'
import { areaIsole } from '@/lib/agevolazione-isole'

// Da dove e' partito il pacco, SOLO per l'agevolazione isole maggiori: il ritorno di una Palermo→Catania
// agevolata resta dentro l'area e va prezzato come l'andata. Non si passa come mittente vero perche'
// accenderebbe il supplemento di partenza, che sul reso non si e' mai pagato. Si legge solo se la
// destinazione sta in un'area delle isole (altrimenti l'agevolazione non puo' valere) e se chi chiama
// non l'ha gia' nella spedizione: una lettura per chiave.
async function mittentePerAgevolazione(admin: any, sped: any, spedizioneId?: string) {
  if (!areaIsole({ provincia: sped?.dest_provincia, cap: sped?.dest_cap, paese: sped?.dest_paese })) return undefined
  if (sped?.mitt_cap || sped?.mitt_provincia) return { cap: sped.mitt_cap, provincia: sped.mitt_provincia, paese: sped.mitt_paese || 'IT' }
  const id = spedizioneId || sped?.id
  if (!id) return undefined
  const { data } = await admin.from('spedizioni').select('mitt_cap,mitt_provincia,mitt_paese').eq('id', id).maybeSingle()
  return data ? { cap: data.mitt_cap, provincia: data.mitt_provincia, paese: data.mitt_paese || 'IT' } : undefined
}

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

// I COLLI VERI: quelli RIMISURATI dal corriere, se il pacco e' stato ripesato; altrimenti quelli
// dichiarati alla partenza.
//
// E' il conto che mancava sul reso. Il ritorno il corriere lo fa pagare sul peso VERO: un pacco
// partito come 1 kg e rimisurato 5,72 torna indietro come un 5,72, e ce lo addebita 7,34 EUR.
// Noi invece calcolavamo il nolo del reso sul peso DICHIARATO e ne incassavamo 3,90: la differenza
// restava a chi detiene il contratto, su ogni singolo reso. Il caso peggiore trovato:
// 050123152870354, partita per 50 kg e rimisurata 141,2 — reso incassato 20,68 contro 41,23 di costo.
//
// Le misure del corriere viaggiano gia' con la rettifica (colli_ripesati): si prende la piu'
// recente. Vale anche se la rettifica e' ancora in attesa di conferma: il peso e' un fatto, non
// dipende da chi l'ha accettata.
export async function pacchiVeri(admin: any, sped: any): Promise<any[]> {
  const num = (v: any) => Number(v) || 0
  try {
    if (sped?.id) {
      const { data } = await admin.from('rettifiche')
        .select('colli_ripesati').eq('spedizione_id', sped.id)
        .not('colli_ripesati', 'is', null)
        .order('created_at', { ascending: false }).limit(1)
      const colli = data?.[0]?.colli_ripesati
      if (Array.isArray(colli) && colli.length && colli.some((c: any) => num(c?.weight) > 0)) {
        return colli.map((c: any) => ({
          weight: num(c?.weight), length: num(c?.length), width: num(c?.width), height: num(c?.height),
        }))
      }
    }
  } catch { /* se la lettura non riesce si resta ai colli dichiarati: meglio poco che niente */ }
  return pacchiSpedizione(sped)
}

// NOLO del cliente per quella spedizione: SOLO il prezzo di fascia/zona (col fuel, che è una
// percentuale della fascia stessa e non un servizio a parte). Niente contrassegno, niente
// assicurazione, niente sponda: il pacco torna indietro e basta, non c'è niente da incassare, da
// assicurare o da scaricare con la sponda — quei supplementi il cliente li ha già pagati all'andata.
// null se non calcolabile. `archivio`: le righe archiviate di quel listino, quando il contratto e' stato
// tolto (le sceglie lib/prezzi-archivio.ts, fontiCliente); senza, si prezza dal listino vivo.
export async function noloCliente(admin: any, sped: any, listinoId: string | null | undefined, archivio?: ArchivioCoppia | null, spedizioneId?: string): Promise<number | null> {
  if (!listinoId) return null
  const ris = await calcolaPrezzoListino(admin, {
    mittAgevolazione: await mittentePerAgevolazione(admin, sped, spedizioneId),
    listinoId,
    provincia: sped?.dest_provincia || '',
    cap: sped?.dest_cap || '',
    paese: sped?.dest_paese || 'IT',
    citta: sped?.dest_citta || '',   // CAP condivisi fra piu' comuni
    packages: await pacchiVeri(admin, sped),
    corriereId: sped?.corriere_id,
    archivio,
  })
  if (!ris || !(ris.prezzo > 0)) return null
  // Il motore somma la sponda al prezzo di fascia: si toglie quella che ha sommato lui (ris.sponda).
  // Prima la si ricalcolava qui con una formula copiata, sul peso fatturato: quando la regola e' passata
  // al peso reale (18/11/2026) la copia avrebbe tolto una sponda diversa da quella sommata.
  return Math.max(0, r2(ris.prezzo - (Number(ris.sponda) || 0))) || null
}

// IL NOLO DEL CLIENTE PER CIO' CHE SUCCEDE DOPO LA PARTENZA (reso, riconsegna, nuovo destinatario).
//
// Regola di Lorenzo del 25/11/2026: dopo la partenza SI PAGA SEMPRE, anche se il master ha tolto il
// contratto dal listino del cliente o l'ha spostato su un altro listino. Le fonti, e il loro ordine, le
// decide lib/prezzi-archivio.ts (fontiCliente): prezzi vivi di oggi, vivi del listino di partenza,
// archiviati del listino di partenza; vale la prima che prezza il pacco.
//
// Sostituisce la regola del 18/09 ("contratto tolto = al cliente niente, lo assorbe il master"),
// nata da un caso vero che resta valido: NN668406880, il 17/09 il master aveva tolto il contratto
// dal listino del cliente e il reso del giorno dopo, non trovando fasce, ripiego' su quanto pagato
// all'andata (costo_totale) e gli addebito' 17,41 EUR — nolo PIU' commissione su 407 EUR di
// contrassegno. Il ripiego sull'andata resta vietato: si prezza dal listino, con le sue fasce.
// Se nessuna fonte prezza piu' il pacco, `nolo` e' null e chi chiama NON scrive la riga del cliente:
// scriverla a 0 la chiuderebbe per sempre (l'indice unico dei resi vieta il secondo addebito) e la
// renderebbe invisibile. Senza riga, il pacco finisce nella sentinella "pacchi a reso senza addebito al
// cliente" (controllo_giornaliero_4) e si addebita a mano. La catena dei master paga comunque.
//
// `listinoId` dice da quale listino viene il nolo: fn_addebita_resi ne legge la percentuale del reso,
// che deve venire dallo stesso listino.
// `opz.spedizioneId`: per chi ha letto la spedizione senza il suo id (resi/distinte) e trovarne comunque
// il listino di partenza, senza cambiare i colli su cui si calcola il nolo (pacchiVeri guarda sped.id).
export async function noloClienteDopoPartenzaCon(
  admin: any, sped: any, listinoOggi: string | null | undefined, opz?: { spedizioneId?: string },
): Promise<{ nolo: number | null; listinoId: string | null; fonte: FonteCliente | null }> {
  const fonti = await fontiCliente(admin, opz?.spedizioneId ? { ...sped, id: opz.spedizioneId } : sped, listinoOggi)
  for (const f of fonti) {
    const n = await noloCliente(admin, sped, f.listinoId, f.archivio, opz?.spedizioneId)
    if (n != null) return { nolo: n, listinoId: f.listinoId, fonte: f }
  }
  return { nolo: null, listinoId: null, fonte: null }
}


// NOLO di un MASTER per quella spedizione, dal SUO listino corrieri: fascia + fuel, e nient'altro.
// Stessa regola del cliente — sul ritorno non si paga ne' contrassegno ne' assicurazione ne'
// sponda. null se non calcolabile.
// Dopo la partenza si paga sempre (25-26/11/2026): se i prezzi di costo del contratto sono stati
// cancellati DOPO la partenza del pacco, si prezza con quelli archiviati (lib/prezzi-archivio.ts). Prima
// usciva null e il reso del master ripiegava su quanto aveva pagato all'andata, contrassegno compreso.
// `opz.spedizioneId`: per chi ha letto la spedizione senza id (resi/distinte), per trovarne la partenza.
export async function noloMaster(admin: any, masterId: string, corriereId: string, sped: any, opz?: { spedizioneId?: string }): Promise<number | null> {
  const archivio = await archivioCostoPerPacco(admin, masterId, corriereId,
    await partenzaDi(admin, opz?.spedizioneId ? { ...sped, id: opz.spedizioneId } : sped))
  const pacchi = await pacchiVeri(admin, sped)
  const pesoReale = pacchi.reduce((s: number, p: any) => s + (Number(p?.weight) || 0), 0) || 1
  const d = await calcolaPrezzoCorriereDettaglio(admin, {
    corriereId, masterId,
    mittAgevolazione: await mittentePerAgevolazione(admin, sped, opz?.spedizioneId),
    provincia: sped?.dest_provincia || '',
    cap: sped?.dest_cap || '',
    paese: sped?.dest_paese || 'IT',
    citta: sped?.dest_citta || '',
    pesoReale, packages: pacchi,
    archivio,
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
  listino_id?: string | null          // SOLO riga cliente: il listino da cui viene il nolo, e quindi la percentuale
}

// 'costo_fornitore_gia_registrato': la riga del titolare non si scrive perche' il corriere gli ha gia'
// addebitato il reso e il conto l'ha registrato (scripts/reso-titolare-costo-fornitore.sql). Per chi
// chiama vale come pagato: il titolare il reso l'ha pagato, al corriere.
export type EsitoReso = {
  spedizione_id: string
  esito: 'addebitato' | 'gia_addebitato' | 'costo_fornitore_gia_registrato' | 'zero' | 'inesistente'
  importo?: number
  cliente_id?: string | null
  master_target_id?: string | null
}

// Qualcuno ha pagato quel reso (adesso, prima, o direttamente al corriere): il pacco puo' uscire dalla coda.
export function resoPagato(esiti: EsitoReso[]): boolean {
  return esiti.some(e => e.esito === 'addebitato' || e.esito === 'gia_addebitato' || e.esito === 'costo_fornitore_gia_registrato')
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
// La POD (riferimento POD-, dal 04/11/2026) non e' andata: un reso su un pacco con la POD pagata
// costerebbe la POD in piu'.
export async function pagatoDaMaster(admin: any, spedizioneId: string, masterId: string): Promise<number> {
  const { data } = await admin.from('movimenti')
    .select('importo,riferimento').eq('spedizione_id', spedizioneId).eq('master_target_id', masterId)
    .in('tipo', ['spedizione', 'rettifica'])
  return Math.abs((data || []).filter((m: any) => !/^POD-/.test(String(m.riferimento || '')))
    .reduce((a: number, m: any) => a + (Number(m.importo) || 0), 0))
}
