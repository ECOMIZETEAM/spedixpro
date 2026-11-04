/* Integrazione "moovexpress": un master RIVENDE il contratto di un altro master (vedi
 * CONDIVISIONE-CONTRATTI.md). Quando il COMPRATORE spedisce su un corriere tipo='moovexpress', questo
 * client chiama l'`/api/v1` del VENDITORE con la api_key del collegamento (nasce quando il venditore gli
 * condivide il contratto, sta dentro corrieri.credenziali):
 * il venditore crea la spedizione VERA sul suo contratto (smistando al fornitore reale — spedisci/brt/…)
 * e torna numero + etichetta + prezzo. Il `prezzo` è ciò che il venditore addebita al compratore-ledger
 * = il COSTO per il compratore (W). È lo stesso schema degli altri provider (lib/spedisci, lib/brt…), ma
 * il "fornitore" è un altro portale MoovExpress raggiunto via HTTP — così il confine è già un'API il
 * giorno che i portali diventeranno domìni separati.
 *
 * NON tocca la contabilità: qui si parla solo con l'API. Il costo/ricavo lo registra il flusso di
 * creazione del compratore (addebitaCatena col prezzo tornato qui), come per ogni altro provider.
 */

export type MoovexpressCred = {
  api_key: string
  base_url?: string           // API del venditore; oggi lo stesso portale, domani un dominio suo
  fornitore_master_id?: string
  corriere_origine_id?: string
}

// Base dell'API del venditore. Oggi loopback sullo stesso portale; si può fissare per-contratto
// (cred.base_url) o via env, con default al dominio di produzione.
function baseUrl(cred: MoovexpressCred): string {
  const b = cred.base_url || process.env.MOOVEXPRESS_API_BASE || process.env.APP_URL || 'https://moovexpress.com'
  return b.replace(/\/+$/, '')
}

export type MoovexpressPacco = { weight: number; length?: number; width?: number; height?: number }
export type MoovexpressCreaInput = {
  packages: MoovexpressPacco[]
  shipFrom: Record<string, any>
  shipTo: Record<string, any>
  codValue?: number
  insuranceValue?: number
  notes?: string
  contenuto?: string
  // Riferimento ordine e valore merce: il VENDITORE li usa come un'integrazione qualsiasi (numRif,
  // supplemento contrassegno/assicurazione dal suo listino). Passarli = il prezzo W torna completo.
  rifOrdine?: string
  valoreMerce?: number
  pickup?: { requested: boolean; date?: string; time?: string }
}
export type MoovexpressCreaResult = {
  id: string           // id della spedizione DAL LATO VENDITORE (per scaricare l'etichetta)
  tracking: string
  prezzo: number       // W: quanto il venditore addebita al compratore (= costo per il compratore)
  label_url: string    // relativo: /api/v1/shipments/<id>/label
  ritiro?: any
}

export type MoovexpressQuotaInput = {
  packages: MoovexpressPacco[]
  shipTo: Record<string, any>
  codValue?: number
  insuranceValue?: number
}
export type MoovexpressQuota = {
  contratto: string | null
  zona: any
  peso_fatturato: number
  nolo: number
  prezzo: number       // W: il costo per il compratore
  valuta: string
  [k: string]: any
}

// PREVENTIVO (a costo zero, nessuna spedizione creata): chiede al venditore la tariffa del contratto
// per una destinazione. Serve a verificare il ponte (la key funziona, torna W) senza spendere
// un'etichetta, e più avanti a quotare/costruire il prezzo di vendita del compratore.
export async function quotaMoovexpress(cred: MoovexpressCred, dati: MoovexpressQuotaInput): Promise<MoovexpressQuota> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/rates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.api_key}` },
      body: JSON.stringify(dati),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  return j as MoovexpressQuota
}

// Crea la spedizione sul contratto del venditore. Lancia un Error col messaggio del fornitore su fallita.
export async function creaSpedizioneMoovexpress(cred: MoovexpressCred, dati: MoovexpressCreaInput): Promise<MoovexpressCreaResult> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.api_key}` },
      body: JSON.stringify(dati),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  if (!j?.tracking) throw new Error('Il fornitore non ha restituito un numero di spedizione.')
  return { id: String(j.id || ''), tracking: String(j.tracking), prezzo: Number(j.prezzo) || 0, label_url: String(j.label_url || ''), ritiro: j.ritiro }
}

// Scarica l'etichetta dal venditore. `labelUrl` è quello tornato dalla create (relativo o assoluto).
//
// Torna anche il TIPO del file, perché non è sempre un PDF: UPS (Europa e Italia) dà un'immagine GIF.
// Chi salvava scriveva sempre `data:application/pdf`: il 20/10 le due UPS Europa di Atlantik srl (prime
// UPS passate da un ponte) sono finite su Storage come sped.pdf con dentro una GIF, e al download il
// cliente riceveva un "PDF" che non si apriva. Il tipo si legge dai BYTE, non dall'intestazione: la riga
// del venditore può essere a sua volta un ponte con lo stesso errore, e l'intestazione lo ripeterebbe.
export async function etichettaMoovexpress(cred: MoovexpressCred, labelUrl: string): Promise<{ buffer: Buffer; mime: string }> {
  if (!labelUrl) throw new Error('Nessuna etichetta da scaricare.')
  const url = /^https?:\/\//i.test(labelUrl) ? labelUrl : `${baseUrl(cred)}${labelUrl}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${cred.api_key}` } })
  if (!r.ok) throw new Error(`Etichetta non disponibile dal fornitore (${r.status})`)
  const buffer = Buffer.from(await r.arrayBuffer())
  const dichiarato = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  return { buffer, mime: mimeDaiByte(buffer) || dichiarato || 'application/pdf' }
}

function mimeDaiByte(b: Buffer): string | null {
  if (b.length < 4) return null
  const testa = b.subarray(0, 8).toString('latin1')
  if (testa.startsWith('%PDF')) return 'application/pdf'
  if (testa.startsWith('GIF8')) return 'image/gif'
  if (testa.startsWith('\x89PNG')) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (testa.startsWith('PK\x03\x04')) return 'application/zip'
  return null
}

export type MoovexpressTracking = {
  // Lo stato arriva GIA' nel nostro vocabolario (il venditore l'ha già mappato dal corriere reale
  // quando il suo giro di tracking ha aggiornato la sua spedizione): si usa tale e quale.
  stato: string | null
  consegnata: boolean
  eventi: { data: string; descrizione: string; luogo: string }[]
}

// TRACKING: chiede al venditore lo stato della spedizione (GET /api/v1/tracking/<numero>). Il venditore
// risponde con lo stato della SUA spedizione (già nostro enum) + la cronologia del corriere reale. A più
// salti la catena resta fresca: ogni livello interroga quello sotto (il cron gira su tutte le spedizioni).
// Best-effort: su errore LANCIA (il chiamante, cron o /api/v1, non declassa lo stato se non arriva nulla).
export async function trackingMoovexpress(cred: MoovexpressCred, tracking: string): Promise<MoovexpressTracking> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  if (!tracking) return { stato: null, consegnata: false, eventi: [] }
  let r: Response
  try {
    r = await fetch(`${baseUrl(cred)}/api/v1/tracking/${encodeURIComponent(tracking)}`, {
      headers: { Authorization: `Bearer ${cred.api_key}` },
      // Senza tempo massimo una risposta che non arriva tiene fermo chi chiede: il 04/11/2026 due di
      // queste sono rimaste appese 300 s e il giro del tracking e' morto con loro.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e: any) {
    throw new Error('Fornitore non raggiungibile: ' + (e?.message || 'rete'))
  }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `Errore dal fornitore (${r.status})`)
  const stato = typeof j?.status === 'string' && j.status ? j.status : null
  const eventi = Array.isArray(j?.events) ? j.events.map((e: any) => ({
    data: String(e?.timestamp || ''),
    descrizione: String(e?.status || ''),
    luogo: String(e?.location || ''),
  })) : []
  return { stato, consegnata: stato === 'consegnata', eventi }
}

// Il venditore sta su QUESTO portale: nessun base_url sul contratto e nessun indirizzo fissato per tutti.
// Al 04/11/2026 vale per tutti i 53 contratti condivisi.
export function venditoreSuQuestoPortale(cred: MoovexpressCred): boolean {
  return !cred?.base_url && !process.env.MOOVEXPRESS_API_BASE
}

// TRACKING DAL DATABASE, quando il venditore sta su questo portale: la sua spedizione e' una riga della
// nostra tabella, e chiederla alla nostra stessa /api/v1/tracking via HTTP costava un'altra funzione e una
// dozzina di letture per ogni pacco (il giro ne fa decine di migliaia). Risponde come quella rotta: stessa
// chiave, stesso blocco per chi non paga, stessa spedizione (del cliente della chiave, per LDV o numero),
// stesso stato, cronologia salvata; e se anche il venditore ha comprato il contratto da un altro, si sale
// la catena come fa la rotta, un salto alla volta, fino a chi spedisce davvero (provato il 04/11 su 300
// spedizioni attive contro la rotta vera: senza salire, 27 catene a due salti leggevano l'anello di mezzo
// rimasto indietro). Non chiama il corriere del venditore: la sua spedizione e' anch'essa nel giro e si
// aggiorna da se'. Il freno di frequenza della chiave qui non conta: protegge le API dagli integratori, e
// questa lettura non passa dalle API.
// `memo`: una verifica per chiave e una risoluzione per contratto a giro, non una per pacco.
export type MemoTrackingLocale = {
  accessi: Map<string, Promise<any>>
  chiaveDi: (masterId: string, nomeContratto: string) => Promise<MoovexpressCred | null>
}
export async function trackingMoovexpressLocale(
  admin: any, cred: MoovexpressCred, tracking: string, memo: MemoTrackingLocale, salto = 1,
): Promise<MoovexpressTracking> {
  if (!cred?.api_key) throw new Error('Contratto senza chiave: rifare la condivisione.')
  if (!tracking) return { stato: null, consegnata: false, eventi: [] }
  if (!memo.accessi.has(cred.api_key)) {
    const { autenticaApiKey } = await import('@/lib/api-auth')
    memo.accessi.set(cred.api_key, autenticaApiKey(new Request('https://interno/api/v1/tracking', {
      headers: { authorization: `Bearer ${cred.api_key}` },
    })))
  }
  const ctx = await memo.accessi.get(cred.api_key)
  if (!ctx) throw new Error('API key non valida o mancante')
  if (ctx.blocco) throw new Error(`API del venditore ferme per il cliente (${ctx.blocco.motivo})`)
  const trk = String(tracking).trim().replace(/[^A-Za-z0-9._-]/g, '')
  if (!trk) throw new Error('Numero di tracking mancante o non valido')
  const { data: sped } = await admin.from('spedizioni')
    .select('id,stato,numero,tracking_number,master_id,corrieri(tipo,nome_contratto)')
    .eq('cliente_id', ctx.clienteId)
    .or(`tracking_number.eq.${trk},numero.eq.${trk}`)
    .limit(1).maybeSingle()
  if (!sped) throw new Error('Spedizione non trovata')
  const salvati = async () => {
    const { data: ev } = await admin.from('tracking_events')
      .select('stato,descrizione,luogo,data_evento')
      .eq('spedizione_id', sped.id)
      .order('data_evento', { ascending: false })
    return (ev || []).map((e: any) => ({
      data: String(e.data_evento || ''),
      descrizione: String(e.descrizione || e.stato || 'Evento'),
      luogo: String(e.luogo || ''),
    }))
  }
  const statoQui = typeof sped.stato === 'string' && sped.stato ? sped.stato : null
  // Un salto in piu' (il tetto evita di girare per sempre su una catena chiusa ad anello).
  if (sped.corrieri?.tipo === 'moovexpress' && salto < 6) {
    try {
      const credSu = await memo.chiaveDi(sped.master_id, sped.corrieri.nome_contratto)
      if (credSu?.api_key) {
        const trkSu = String(sped.tracking_number || sped.numero || '')
        const su = venditoreSuQuestoPortale(credSu)
          ? await trackingMoovexpressLocale(admin, credSu, trkSu, memo, salto + 1)
          : await trackingMoovexpress(credSu, trkSu)
        const stato = su.stato || statoQui
        return { stato, consegnata: stato === 'consegnata', eventi: su.eventi.length ? su.eventi : await salvati() }
      }
    } catch { /* come la rotta: se il salto sopra non risponde, vale cio' che c'e' qui */ }
  }
  return { stato: statoQui, consegnata: statoQui === 'consegnata', eventi: await salvati() }
}
