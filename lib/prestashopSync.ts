import { psGet, psElenco, PS_STATI_DI_SERIE } from '@/lib/prestashop'

// Il giorno come lo conta il negozio: le date degli ordini PrestaShop sono nell'ora del negozio
// (italiana), non in UTC. Con il giorno UTC, tra mezzanotte e le due "oggi" era ancora ieri.
const giornoRoma = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(ms))
const eData = (s?: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

// IL GIORNO FINALE VA PRESO TUTTO. `date_add` e' data E ORA, e l'intervallo di PrestaShop e' un
// BETWEEN: chiedere [2026-10-13,2026-10-13] significa "tra la mezzanotte del 13 e la mezzanotte del
// 13", cioe' niente; chiedere una settimana fino a oggi significa fermarsi alla mezzanotte di
// stamattina. Per questo gli ordini del giorno arrivavano solo la notte dopo, quando "oggi" diventava
// "ieri" (13/10/2026: alle 16:45, su 16 negozi, 147 ordini di giornata sul negozio e 1 solo da noi;
// "Sincronizza" con il periodo su oggi rispondeva sempre 0). Le altre piattaforme passano da
// rangeGiorniISO, che l'ora ce la mette: qui mancava.
const filtroPeriodo = (dal: string, al: string) => `filter[date_add]=[${dal}%2000:00:00,${al}%2023:59:59]&date=1&`

const aBlocchi = <T>(arr: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// Sincronizza gli ordini PrestaShop pagati/validi in ordini_ecommerce.
// PrestaShop normalizza i dati: ordine → indirizzo → cliente → stato/paese (risorse separate),
// quindi per ogni ordine risolviamo indirizzo + email + provincia + paese (con cache).
export async function sincronizzaOrdiniPrestashop(db: any, integr: any, range?: { dal?: string; al?: string }): Promise<{ letti: number; importati: number; spediti: number; daSpedire: number; annullati: number; avviso: string | null }> {
  const cred = integr.credenziali as any
  const url = cred?.url, key = cred?.key
  if (!url || !key) throw new Error('Credenziali PrestaShop mancanti')

  // Risorse che la chiave del negozio non ci lascia leggere (401): si va avanti con quello che c'e',
  // ma lo si dice al negoziante invece di lasciargli dati monchi senza spiegazione.
  const negate = new Set<string>()
  const eNegata = (e: any) => / 401:/.test(String(e?.message || e))

  // STATI ORDINE del negozio PRIMA di tutto: servono a marcare gli evasi. 'shipped'=1 → lo stato
  // equivale a "spedito" (NON usare 'delivery': su negozi reali "Preparazione in corso" ha delivery=1
  // ma shipped=0). Serve anche per mostrare il NOME dello stato.
  const statoInfo = new Map<string, { nome: string; spedito: boolean }>()
  try {
    const st = await psGet(url, key, 'order_states?display=full')
    for (const x of (st?.order_states || [])) {
      let nome = ''
      if (typeof x?.name === 'string') nome = x.name
      else if (Array.isArray(x?.name)) nome = x.name[0]?.value || ''
      else if (x?.name && typeof x.name === 'object') nome = Object.values(x.name)[0] as string || ''
      statoInfo.set(String(x.id), { nome: nome || String(x.id), spedito: String(x.shipped) === '1' })
    }
  } catch (e) { if (eNegata(e)) negate.add('order_states') }
  // Stati non leggibili: si ripiega su quelli di serie (vedi PS_STATI_DI_SERIE), non su "nessuno".
  if (!statoInfo.size) for (const [id, s] of Object.entries(PS_STATI_DI_SERIE)) statoInfo.set(id, s)

  // SOLO la FINESTRA scelta (per data ordine, default ultimi 30 giorni): "oggi" chiede gli ordini di
  // oggi, una settimana quelli della settimana. NIENTE catch-all "tutti i non spediti a prescindere
  // dalla data": "la coda e' piccola" non era vero — i negozi che non chiudono gli ordini se ne portano
  // dietro centinaia (15/09/2026: 3.542 righe "da spedire" oltre i 30 giorni sui negozi PrestaShop).
  // Su Woo lo stesso giro mandava il negozio in timeout. Chi cerca un ordine vecchio allarga il
  // periodo; i nuovi li prende il cron.
  const oggi = giornoRoma(Date.now())
  const trentaGiorniFa = giornoRoma(Date.now() - 30 * 86400000)
  const dalChiesto = range?.dal, alChiesto = range?.al
  const dal = eData(dalChiesto) ? dalChiesto : trentaGiorniFa
  const al = eData(alChiesto) ? alChiesto : oggi

  // FETCH PAGINATO: col solo `limit=100` PrestaShop tornava AL MASSIMO 100 ordini e il resto spariva —
  // era il "non li importa tutti". Ora si scorre a pagine (limit=offset,100) finche' non si esaurisce.
  const ordini: any[] = []
  const visti = new Set<string>()
  for (let page = 0; page < 50; page++) {
    const batch = await psElenco(url, key, `orders?display=full&filter[valid]=[1]&${filtroPeriodo(dal, al)}sort=[id_DESC]&limit=${page * 100},100`, 'orders')
    for (const o of batch) { const id = String(o.id); if (!visti.has(id)) { visti.add(id); ordini.push(o) } }
    if (batch.length < 100) break
  }

  // COSA ABBIAMO GIA' DI QUESTI ORDINI. Serve a non declassare a 'da_spedire' un ordine che abbiamo
  // spedito noi (o unito a un altro) solo perche' il negozio non e' ancora aggiornato.
  //
  // Si chiede PER ID, a blocchi, e non "tutti gli ordini dell'integrazione": quella lettura tornava al
  // massimo 1.000 righe a caso, e sui negozi che le superano gli ordini rimasti fuori tornavano "Da
  // spedire" col pulsante «Crea spedizione» acceso — 12 ordini gia' CONSEGNATI su due negozi
  // (13/10/2026). E se la lettura fallisce ci si ferma: prima si andava avanti a occhi chiusi, cioe'
  // si declassava tutto.
  const esistenti = new Map<string, { stato: string; spedizione_id: string | null }>()
  for (const ids of aBlocchi(ordini.map(o => String(o.id)), 200)) {
    const { data, error } = await db.from('ordini_ecommerce')
      .select('ordine_esterno_id,stato,spedizione_id').eq('integrazione_id', integr.id).in('ordine_esterno_id', ids)
    if (error) throw new Error('Lettura degli ordini gia\' importati non riuscita: ' + error.message)
    for (const e of (data || [])) esistenti.set(String(e.ordine_esterno_id), { stato: e.stato, spedizione_id: e.spedizione_id })
  }

  // INDIRIZZI E CLIENTI A BLOCCHI. Erano due chiamate per ordine, una dopo l'altra: 1.400 ordini in
  // una settimana sul negozio piu' grande = 2.800 chiamate, e la sync a mano moriva per tempo scaduto
  // prima di finire. PrestaShop accetta piu' id in un filtro ([1|2|3]): quaranta per chiamata. Chi non
  // torna nel blocco si richiede da solo, come prima (verificato: sui 16 negozi il blocco restituisce
  // tutti gli indirizzi, anche quelli che il compratore ha poi cambiato).
  async function leggiABlocchi(risorsa: string, nodo: string, display: string, idsGrezzi: any[]): Promise<Map<string, any>> {
    const out = new Map<string, any>()
    const ids = Array.from(new Set(idsGrezzi.map(x => String(x || '')).filter(x => x && x !== '0')))
    for (const blocco of aBlocchi(ids, 40)) {
      try {
        for (const x of await psElenco(url, key, `${risorsa}?display=${display}&filter[id]=[${blocco.join('|')}]`, nodo)) out.set(String(x.id), x)
      } catch (e) { if (eNegata(e)) { negate.add(risorsa); return out } }
    }
    const singolo = risorsa === 'addresses' ? 'address' : 'customer'
    for (const id of ids) {
      if (out.has(id)) continue
      try { const d = await psGet(url, key, `${risorsa}/${id}`); if (d?.[singolo]) out.set(id, d[singolo]) } catch {}
    }
    return out
  }
  const indirizzi = await leggiABlocchi('addresses', 'addresses', 'full', ordini.map(o => o.id_address_delivery))
  const clienti = await leggiABlocchi('customers', 'customers', '[id,email]', ordini.map(o => o.id_customer))

  // Provincia e paese: poche voci distinte, una chiamata l'una e poi cache. In cache finisce anche il
  // fallimento: con la chiave senza permesso si ripeteva la stessa chiamata negata per ogni ordine.
  const stateCache = new Map<string, string>()
  const countryCache = new Map<string, string>()
  async function statoIso(id: any): Promise<string> {
    const k = String(id || '')
    if (!k || k === '0') return ''
    if (stateCache.has(k)) return stateCache.get(k)!
    let iso = ''
    try { const d = await psGet(url, key, `states/${k}`); iso = d?.state?.iso_code || '' } catch (e) { if (eNegata(e)) negate.add('states') }
    stateCache.set(k, iso); return iso
  }
  async function paeseIso(id: any): Promise<string> {
    const k = String(id || '')
    if (!k) return 'IT'
    if (countryCache.has(k)) return countryCache.get(k)!
    let iso = 'IT'
    try { const d = await psGet(url, key, `countries/${k}`); iso = d?.country?.iso_code || 'IT' } catch (e) { if (eNegata(e)) negate.add('countries') }
    countryCache.set(k, iso); return iso
  }

  const righe: any[] = []
  for (const o of ordini) {
    const addr = indirizzi.get(String(o.id_address_delivery || ''))
    const cust = clienti.get(String(o.id_customer || ''))
    const gia = esistenti.get(String(o.id))
    const prov = negate.has('states') ? '' : await statoIso(addr?.id_state)
    const paese = negate.has('countries') ? 'IT' : await paeseIso(addr?.id_country)

    const destinatario = {
      nome: `${addr?.firstname || ''} ${addr?.lastname || ''}`.trim(),
      indirizzo: [addr?.address1, addr?.address2].filter(Boolean).join(' '),
      citta: addr?.city || '',
      provincia: prov,
      cap: addr?.postcode || '',
      paese: paese || 'IT',
      email: cust?.email || '',
      telefono: addr?.phone_mobile || addr?.phone || '',
    }
    const rows = o.associations?.order_rows || []
    const articoli = rows.map((r: any) => ({
      nome: r.product_name, quantita: Number(r.product_quantity) || 1, grammi: 0, sku: r.product_reference || '', immagine: null,
    }))
    // Spedito se lo stato del negozio ha il flag shipped, o se lo abbiamo già spedito noi. Un ordine
    // UNITO a un altro resta unito: parte nel pacco del capofila, e riportarlo a 'da_spedire' a ogni
    // sync lo rimetteva tra gli spedibili — un doppione.
    const statoOrdine = gia?.stato === 'unito' ? 'unito'
      : (statoInfo.get(String(o.current_state || ''))?.spedito || gia?.stato === 'spedito' || gia?.spedizione_id) ? 'spedito' : 'da_spedire'
    const payload: any = {
      cliente_id: integr.cliente_id,
      master_id: integr.master_id,
      integrazione_id: integr.id,
      // Dominio del negozio SULLA riga: i redact GDPR filtrano su questo. Non su integrazione_id,
      // che sparisce se qualcuno cancella l'integrazione e lascia gli ordini orfani — e un ordine
      // orfano nessuna cancellazione lo raggiunge piu' (erano 4.147 il 9/09/2026).
      shop: integr.identificativo,
      piattaforma: 'prestashop',
      ordine_esterno_id: String(o.id),
      numero_ordine: o.reference || `#${o.id}`,
      cliente_nome: destinatario.nome,
      destinatario,
      articoli,
      totale: o.total_paid ? Number(o.total_paid) : null,
      valuta: 'EUR',
      stato_pagamento: statoInfo.get(String(o.current_state || ''))?.nome || String(o.current_state || ''),
      stato: statoOrdine,
      raw: o,
    }
    // INDIRIZZO NON LETTO (negozio lento, chiamata scaduta): su un ordine che abbiamo gia' NON si
    // riscrive il destinatario. Prima l'errore veniva ingoiato e l'indirizzo buono della volta prima
    // veniva sostituito con uno vuoto.
    if (!addr && gia) { delete payload.destinatario; delete payload.cliente_nome }
    righe.push(payload)
  }

  // Scrittura a blocchi (stesse colonne nello stesso blocco: chi non riscrive il destinatario va a
  // parte). Se un blocco viene rifiutato si riprova riga per riga, cosi' una riga storta non si porta
  // dietro le altre quarantanove.
  let importati = 0, spediti = 0, daSpedire = 0
  let primoErrore = ''
  const scrivi = async (blocco: any[]) => db.from('ordini_ecommerce').upsert(blocco, { onConflict: 'integrazione_id,ordine_esterno_id', ignoreDuplicates: false })
  const conta = (r: any) => { importati++; if (r.stato === 'spedito') spediti++; else if (r.stato === 'da_spedire') daSpedire++ }
  for (const gruppo of [righe.filter(r => 'destinatario' in r), righe.filter(r => !('destinatario' in r))]) {
    for (const blocco of aBlocchi(gruppo, 50)) {
      const { error } = await scrivi(blocco)
      if (!error) { blocco.forEach(conta); continue }
      for (const r of blocco) {
        const { error: e1 } = await scrivi([r])
        if (!e1) conta(r); else if (!primoErrore) primoErrore = e1.message
      }
    }
  }
  if (primoErrore) console.error('[PRESTASHOP SYNC]', integr.identificativo, 'ordini non scritti:', righe.length - importati, primoErrore)

  // ALLINEAMENTO DEGLI STATI. L'import qui sopra legge solo gli ordini VALIDI: un ordine che il
  // negozio annulla o rimborsa DOPO che l'abbiamo importato esce da quella lettura e da noi restava
  // "Da spedire" per sempre, spedibile (36 negli ultimi 30 giorni, 13/10/2026). Lo stesso per chi viene
  // segnato spedito sul negozio quando e' gia' fuori dalla finestra del cron. Qui si rilegge il minimo
  // (id, stato, valido: 500 ordini a chiamata, senza indirizzi) su almeno trenta giorni e si
  // correggono le SOLE righe mai spedite da noi. Best-effort: se fallisce, l'import resta valido.
  let annullati = 0
  try {
    const dalStati = dal < trentaGiorniFa ? dal : trentaGiorniFa
    const sulNegozio = new Map<string, { valido: boolean; stato: string }>()
    for (let page = 0; page < 40; page++) {
      const batch = await psElenco(url, key, `orders?display=[id,current_state,valid]&${filtroPeriodo(dalStati, al)}sort=[id_DESC]&limit=${page * 500},500`, 'orders')
      for (const o of batch) {
        // Senza il campo `valid` non si decide niente: letto come "non valido", un negozio che non lo
        // restituisce si vedrebbe annullare tutti gli ordini aperti.
        if (o.valid === undefined || o.valid === null || o.valid === '') continue
        sulNegozio.set(String(o.id), { valido: String(o.valid) === '1', stato: String(o.current_state || '') })
      }
      if (batch.length < 500) break
    }
    // Le nostre righe ancora aperte, a pagine da mille con un ordine stabile.
    const aperte: { ordine_esterno_id: string; stato: string }[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await db.from('ordini_ecommerce').select('ordine_esterno_id,stato')
        .eq('integrazione_id', integr.id).is('spedizione_id', null).in('stato', ['da_spedire', 'annullato'])
        .order('id').range(da, da + 999)
      if (error) throw new Error(error.message)
      aperte.push(...(data || []))
      if ((data || []).length < 1000) break
    }
    // Raggruppate per (stato di partenza → stato di arrivo, stato del negozio): poche scritture.
    const cambi = new Map<string, { da: string; a: string; statoNegozio: string; ids: string[] }>()
    for (const r of aperte) {
      const n = sulNegozio.get(String(r.ordine_esterno_id))
      if (!n) continue
      // Prima lo stato, poi il "valido": su un negozio un ordine in stato 5 (Consegnato) risulta non
      // valido, e con l'ordine inverso sarebbe diventato "annullato". Non valido e non spedito, sui
      // negozi collegati, vuol dire Annullato o Rimborsato (37 su 37 il 13/10/2026).
      const a = statoInfo.get(n.stato)?.spedito ? 'spedito' : !n.valido ? 'annullato' : 'da_spedire'
      if (a === r.stato) continue
      const k = `${r.stato}>${a}>${n.stato}`
      if (!cambi.has(k)) cambi.set(k, { da: r.stato, a, statoNegozio: n.stato, ids: [] })
      cambi.get(k)!.ids.push(String(r.ordine_esterno_id))
    }
    for (const c of cambi.values()) {
      for (const ids of aBlocchi(c.ids, 200)) {
        // Le guardie stanno NELLA scrittura: mai una riga con la spedizione collegata, e solo se e'
        // ancora nello stato da cui si e' partiti (nel frattempo il cliente puo' averla spedita).
        const { data, error } = await db.from('ordini_ecommerce')
          .update({ stato: c.a, stato_pagamento: statoInfo.get(c.statoNegozio)?.nome || c.statoNegozio })
          .eq('integrazione_id', integr.id).is('spedizione_id', null).eq('stato', c.da)
          .in('ordine_esterno_id', ids).select('id')
        if (error) throw new Error(error.message)
        if (c.a === 'annullato') annullati += (data || []).length
      }
    }
  } catch (e: any) { console.error('[PRESTASHOP SYNC] allineamento stati (best-effort):', integr.identificativo, e?.message) }

  // PERMESSI MANCANTI: scritti sull'integrazione, cosi' il negoziante li legge nella pagina dei negozi
  // collegati. Due negozi sono rimasti mesi con provincia vuota e paese sempre "Italia" (24 ordini per
  // l'estero) senza che niente lo dicesse: la chiamata negata veniva ingoiata.
  let avviso: string | null = null
  if (negate.size) {
    const cosa: string[] = []
    if (negate.has('states')) cosa.push('la provincia resta vuota')
    if (negate.has('countries')) cosa.push('il paese risulta sempre Italia, anche per l\'estero')
    if (negate.has('order_states')) cosa.push('gli stati personalizzati del negozio non vengono riconosciuti')
    if (negate.has('addresses')) cosa.push('gli ordini arrivano senza indirizzo')
    if (negate.has('customers')) cosa.push('gli ordini arrivano senza email')
    avviso = `La chiave Webservice del negozio non ha il permesso di lettura su: ${Array.from(negate).join(', ')}. Per questo ${cosa.join('; ')}. Abilitalo in PrestaShop: Parametri Avanzati → Webservice → la tua chiave → spunta "Visualizza (GET)" su quelle voci.`
  }

  // Quanti ordini ha DAVVERO questo negozio da noi, non quanti ne ha letti l'ultimo giro: dopo una
  // sync del solo "oggi" la scheda del negozio diceva "0 ordini", come se fosse scollegato.
  const { count } = await db.from('ordini_ecommerce').select('id', { count: 'exact', head: true }).eq('integrazione_id', integr.id)
  await db.from('integrazioni')
    .update({ ultimo_sync: new Date().toISOString(), ordini_totali: count ?? ordini.length, errore: avviso })   // sync riuscita: azzera un errore precedente (non piu' appiccicato quando lo store rientra)
    .eq('id', integr.id)

  return { letti: ordini.length, importati, spediti, daSpedire, annullati, avviso }
}
