import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'
import { resoTraGliStati } from '@/lib/tracking-eventi'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Verifica la firma HMAC-SHA256 del webhook Spedisci.online.
// Supporta ENTRAMBI gli schemi visti in giro:
//  - STANDARD WEBHOOKS (secret "whsec_...", firma BASE64 su `${id}.${timestamp}.${body}` con
//    chiave = base64-decode del secret; header "v1,<base64>" separati da spazio) — e' il formato
//    dei secret reali del pannello Spedisci;
//  - variante legacy hex su `${timestamp}.${body}` con secret grezzo ("t=..,v1=<hex>").
function sicuroUguale(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b)
  return A.length === B.length && crypto.timingSafeEqual(A, B)
}
function verifica(raw: string, id: string | null, timestamp: string | null, signature: string | null, secret: string): boolean {
  if (!timestamp || !signature) return false
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10))
  if (!Number.isFinite(age) || age > 300) return false
  // Firme presentate nell'header (uno o piu' token)
  const presentate: string[] = []
  for (const tok of signature.split(/\s+/)) {
    if (tok.startsWith('v1,')) presentate.push(tok.slice(3))
    for (const p of tok.split(',')) if (p.startsWith('v1=')) presentate.push(p.slice(3))
    if (!tok.includes(',') && !tok.includes('=')) presentate.push(tok)   // header con la sola firma
  }
  if (!presentate.length) return false
  // Chiavi candidate: secret grezzo, il contenuto decodificato base64 e ANCHE il secret senza il
  // prefisso "whsec_" come testo — pannelli diversi firmano in modi diversi e questa terza
  // variante mancava.
  const chiavi: (string | Buffer)[] = [secret]
  if (secret.startsWith('whsec_')) {
    const senzaPrefisso = secret.slice(6)
    try { chiavi.push(Buffer.from(senzaPrefisso, 'base64')) } catch {}
    chiavi.push(senzaPrefisso)
  }
  // Contenuti firmabili: con message-id (standard), senza (legacy) e col solo corpo.
  const contenuti = [`${timestamp}.${raw}`, raw]
  if (id) contenuti.unshift(`${id}.${timestamp}.${raw}`)
  for (const chiave of chiavi) for (const c of contenuti) {
    const dig = crypto.createHmac('sha256', chiave as any).update(c).digest()
    const b64 = dig.toString('base64'), hex = dig.toString('hex')
    for (const pres of presentate) {
      try { if (sicuroUguale(pres, b64) || sicuroUguale(pres, hex)) return true } catch { /* lunghezze diverse */ }
    }
  }
  return false
}

// Diagnostica di una firma NON riconosciuta: stampa le prime cifre di ogni combinazione
// (chiave × contenuto) accanto a quella presentata, così si capisce in un colpo solo quale
// schema usa il pannello. Non espone mai il segreto, solo 12 cifre di un digest.
function diagnosticaFirma(raw: string, id: string | null, timestamp: string | null, presentata: string, segreti: string[]): string[] {
  const out: string[] = [`presentata=${presentata.slice(0, 12)}`]
  if (!timestamp) return out
  segreti.forEach((secret, i) => {
    const chiavi: [string, string | Buffer][] = [['grezzo', secret]]
    if (secret.startsWith('whsec_')) {
      try { chiavi.push(['base64', Buffer.from(secret.slice(6), 'base64')]) } catch {}
      chiavi.push(['senza-prefisso', secret.slice(6)])
    }
    const contenuti: [string, string][] = [['ts.body', `${timestamp}.${raw}`], ['solo-body', raw]]
    if (id) contenuti.push(['id.ts.body', `${id}.${timestamp}.${raw}`])
    for (const [nk, k] of chiavi) for (const [nc, c] of contenuti) {
      const d = crypto.createHmac('sha256', k as any).update(c).digest()
      out.push(`s${i}/${nk}/${nc}=${d.toString('hex').slice(0, 12)}|${d.toString('base64').slice(0, 12)}`)
    }
  })
  return out
}

// Mappa evento + stato Spedisci.online allo stato interno.
// Eventi reali del pannello: tracking.update, shipment.created, stock.created (giacenza), invoice.created.
function mapStato(event: string, statusStr: string): string | null {
  // NOMI DELL'EVENTO DI APERTURA: il pannello manda 'stock.opened', noi conoscevamo solo
  // 'stock.created'. Misurato il 17/09 sui log di produzione: 'stock.opened' arriva e VERIFICA la
  // firma, ma cadeva nel ramo "non riconosciuto" e non apriva niente — nessun `giacenza_data`,
  // quindi nemmeno l'addebito, che si arma su quel campo. Si accettano entrambi i nomi: chi manda
  // ancora il vecchio continua a funzionare.
  // NB: 'stock.closed' NON sta qui di proposito. Chiudere una giacenza non e' uno stato di
  // tracking e non ha una logica collaudata da riusare: prima si guarda un payload vero (loggato
  // qui sotto), poi si scrive. Indovinare, su qualcosa che tocca gli addebiti, no.
  if (event === 'stock.created' || event === 'stock.opened') return 'in_giacenza'   // Nuova giacenza
  const m = mapStatoSpedisci(statusStr)                  // tracking.update porta la stringa di stato
  if (m) return m
  return null   // shipment.created / invoice.created / stati non riconosciuti: non tocco
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const admin = createAdminSupabase()

  // Secret: dal DB (uno per ciascun account Spedisci) + fallback su env. Provo tutti finché uno verifica.
  const { data: righe } = await admin.from('webhook_secrets').select('secret').eq('provider', 'spedisci')
  const candidati = [...(righe || []).map((r: any) => r.secret), process.env.SPEDISCI_WEBHOOK_SECRET].filter(Boolean) as string[]
  // ...e ANCHE i token API degli account spedisci (corrieri.credenziali.password): alcuni pannelli
  // NON danno un "whsec_" separato ma firmano il webhook con il token dell'account stesso — quello
  // che salviamo gia' all'onboarding. Aggiungerli qui fa verificare quegli account SENZA dover
  // copiare a mano un secret dal pannello (che via API non e' nemmeno leggibile: /api/v2/webhooks
  // e' 404 e /tracking risponde "use the Webhooks"). Additivo: piu' chiavi valide, nessuna difesa
  // indebolita. Vale per QUALUNQUE account, anche quelli che nascono domani.
  const { data: contiSped } = await admin.from('corrieri').select('credenziali').eq('tipo', 'spedisci')
  const tokenAccount = Array.from(new Set(
    (contiSped || []).map((c: any) => c?.credenziali?.password).filter((p: any) => typeof p === 'string' && p.length > 20)
  )) as string[]
  candidati.push(...tokenAccount)
  if (!candidati.length) return new NextResponse('Webhook non configurato', { status: 500 })

  const wid = req.headers.get('webhook-id') || req.headers.get('svix-id')
  const ts = req.headers.get('webhook-timestamp') || req.headers.get('svix-timestamp')
  const sig = req.headers.get('webhook-signature') || req.headers.get('svix-signature')
  if (!candidati.some(sec => verifica(raw, wid, ts, sig, sec))) {
    // Sul rifiuto, provo a dire QUALE account e' (dal prefisso dell'ldv nel corpo): senza questo il
    // 401 e' muto e un account rotto resta invisibile. Best-effort, non cambia l'esito.
    let ldvRifiutata = '-'
    try { const b = JSON.parse(raw); ldvRifiutata = b?.data?.ldv || b?.ldv || b?.data?.tracking_number || b?.tracking_number || '-' } catch {}
    console.log('[WEBHOOK][SPEDISCI] firma NON verificata. ldv:', ldvRifiutata, 'id:', wid, 'ts:', ts, 'sig:', String(sig).slice(0, 80))
    // Confronto delle combinazioni possibili: dice subito quale schema usa il pannello.
    const pres = (String(sig || '').split(/[\s,]+/).find(p => p.startsWith('v1=') || p.startsWith('v1,')) || '').slice(3)
    if (pres) console.log('[WEBHOOK][SPEDISCI] confronto:', diagnosticaFirma(raw, wid, ts, pres, candidati).join(' '))
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: any
  try { body = JSON.parse(raw) } catch { return new NextResponse('Bad payload', { status: 200 }) }

  const event = body?.event || body?.type || ''
  const d = body?.data || body || {}
  // FORMATO REALE Spedisci: { ldv, vector_name, order_id, TrackingDettaglio: [{Data,Stato,Luogo}] }
  // (rimandano TUTTA la cronologia a ogni aggiornamento; niente campo "event").
  const tracking = d?.ldv || d?.tracking_number || d?.tracking || d?.trackingNumber || d?.shipment?.tracking_number || d?.code
  console.log('[WEBHOOK][SPEDISCI] evento:', event || 'tracking-cronologia', 'ldv:', tracking || '-')
  // CORPO DEGLI EVENTI DI GIACENZA. Nei log si vedeva solo il nome dell'evento, quindi di
  // 'stock.closed' non sappiamo NIENTE: se porti il motivo, la data vera, l'esito (svincolata?
  // resa al mittente?). Senza quei campi la chiusura si scriverebbe a intuito. Qui si stampa il
  // corpo (troncato) solo per gli eventi stock.*, che sono pochi: serve a vedere la forma reale
  // prima di gestirla. Da togliere quando la chiusura sara' implementata.
  if (String(event).startsWith('stock.')) console.log('[WEBHOOK][SPEDISCI] corpo', event, raw.slice(0, 600))
  if (!tracking) { console.log('[WEBHOOK][SPEDISCI] payload sconosciuto:', raw.slice(0, 400)); return new NextResponse('OK', { status: 200 }) }

  const dettagli: any[] = Array.isArray(d?.TrackingDettaglio) ? d.TrackingDettaglio : []
  if (dettagli.length) {
    // Match su tracking_number O numero (LDV): il webhook copre TUTTO l'account Spedisci,
    // incluse spedizioni fatte fuori da Moove -> quelle si ignorano (log e stop).
    const { data: speds2 } = await admin.from('spedizioni').select('id,stato,giacenza_data').or(`tracking_number.eq.${tracking},numero.eq.${tracking}`)
    if (!(speds2 || []).length) { console.log('[WEBHOOK][SPEDISCI] ldv non nostra:', tracking); return new NextResponse('OK', { status: 200 }) }
    // "23/07/2026 05:40" (ora italiana) -> ISO con offset giusto
    const parseData = (s: string): string => {
      const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
      if (!m) return new Date().toISOString()
      const mese = Number(m[2])
      const off = (mese >= 4 && mese <= 10) ? '+02:00' : '+01:00'
      return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00${off}`
    }
    const eventi = dettagli.map((e: any) => ({
      stato: mapStatoSpedisci(String(e?.Stato || '')),
      descrizione: String(e?.Stato || '').slice(0, 300),
      luogo: (String(e?.Luogo || '').slice(0, 200)) || null,
      data_evento: parseData(e?.Data),
    })).filter((e: any) => e.descrizione)
    const ids = (speds2 || []).map((sp: any) => sp.id)
    // Sostituisco lo storico (arriva completo a ogni giro: cosi' niente duplicati nel popup)
    try {
      // Si AGGIUNGE quello che manca, non si riscrive: il webhook a volte rimanda una cronologia
      // piu' corta e cosi' sparivano descrizioni gia' scritte. Doppioni fermati dalla chiave unica.
      if (eventi.length) await admin.from('tracking_events').upsert(
        ids.flatMap((id: string) => eventi.map((e: any) => ({ spedizione_id: id, ...e, luogo: e.luogo ?? '' }))),
        { onConflict: 'spedizione_id,data_evento,descrizione,luogo', ignoreDuplicates: true },
      )
    } catch { /* best-effort */ }
    // Stato piu' avanzato della cronologia, con le regole di sempre
    // GIACENZA DALLA CRONOLOGIA: stessa regola del ramo eventi qui sotto — la data si scrive anche
    // se lo stato non avanza, perche' una mancata consegna (priorita' 5) copre la giacenza (4) e
    // altrimenti la giacenza non verrebbe mai registrata. Solo se manca, e con la data dell'evento
    // vero, non con l'ora della notifica.
    const eventiGiacenza = eventi.filter((e: any) => e.stato === 'in_giacenza')
    if (eventiGiacenza.length) {
      const senzaData = (speds2 || []).filter((sp: any) => !sp.giacenza_data).map((sp: any) => sp.id)
      if (senzaData.length) {
        const quando = eventiGiacenza.map((e: any) => e.data_evento).sort()[0] || new Date().toISOString()
        await admin.from('spedizioni').update({ giacenza_data: quando }).in('id', senzaData)
        console.log('[WEBHOOK][SPEDISCI] giacenza aperta (cronologia)', tracking, 'il', quando, `(${senzaData.length})`)
      }
    }
    let avanzato: string | null = null
    for (const e of eventi) if (e.stato && prioritaStato(e.stato) > prioritaStato(avanzato)) avanzato = e.stato
    // IL RESO VINCE: la "consegnata" che segue "Resa al mittente" e' la consegna AL MITTENTE.
    if (resoTraGliStati(eventi.map((e: any) => e.stato))) avanzato = 'reso_mittente'
    if (avanzato) {
      const upd2: any = { stato: avanzato }
      const daAgg = (speds2 || []).filter((sp: any) =>
        sp.stato !== 'annullata'
        // Un reso si applica anche a chi risulta gia' 'consegnata': e' la correzione di quel caso.
        && (avanzato === 'reso_mittente'
              ? sp.stato !== 'reso_mittente'
              : sp.stato !== 'consegnata' && prioritaStato(avanzato!) > prioritaStato(sp.stato))
        && !(sp.stato === 'reso_mittente' && avanzato === 'consegnata')   // consegna del ritorno, non del pacco
      )
      const idsAgg = daAgg.map((sp: any) => sp.id)
      if (idsAgg.length) {
        // NB: `giacenza_data` NON si scrive piu' qui. Lo fa il blocco qui sopra, che guarda gli
        // eventi di giacenza e non l'avanzamento di stato, e usa la data VERA dell'evento invece di
        // now(). Lasciare anche la vecchia riga significava riscrivere il campo subito dopo con
        // l'ora della notifica — per giunta senza accorgersene, perche' `daAgg` viene da una
        // lettura precedente e vede ancora il campo nullo.
        await admin.from('spedizioni').update(upd2).in('id', idsAgg)
        console.log('[WEBHOOK][SPEDISCI]', tracking, '-> stato', avanzato, `(${idsAgg.length} agg.)`)

        // L'addebito dell'apertura non si chiama piu' da qui: appena la riga viene scritta con
        // giacenza_data, il database la mette da solo in coda (trigger trg_giacenza_da_addebitare)
        // e il lavoro pianificato la addebita. Cosi' vale per QUALUNQUE strada, non solo per queste
        // due che conosciamo oggi.
      }
    }
    return new NextResponse('OK', { status: 200 })
  }

  const nuovo = mapStato(event, d?.status || d?.stato || d?.description || '')

  // Spedizioni interessate (per id): servono sia per l'avanzamento stato sia per SALVARE L'EVENTO.
  // `giacenza_stato` serve alla chiusura qui sotto: una giacenza gia' 'svincolata' o 'chiusa' non si
  // tocca — quelli sono esiti veri, decisi da un operatore, e sovrascriverli perderebbe informazione.
  const { data: speds } = await admin.from('spedizioni').select('id,stato,giacenza_data,giacenza_stato').eq('tracking_number', tracking)

  // SALVA L'EVENTO in tracking_events: Spedisci ha CHIUSO il polling del tracking (403 "For tracking
  // please use the Webhooks events") → il popup tracking mostra QUESTI eventi. Best-effort.
  const descrizione = String(d?.status || d?.stato || d?.description || event || '').slice(0, 300)
  const luogo = (String(d?.location || d?.office || d?.officeDescription || '').slice(0, 200)) || null
  let dataEvento = new Date(d?.date || d?.data || d?.timestamp || Date.now())
  if (isNaN(dataEvento.getTime())) dataEvento = new Date()
  if ((speds || []).length && descrizione && (event === 'tracking.update' || event === 'stock.created' || event === 'stock.opened')) {
    try {
      await admin.from('tracking_events').insert((speds || []).map((sp: any) => ({
        spedizione_id: sp.id, stato: nuovo, descrizione, luogo, data_evento: dataEvento.toISOString(),
      })))
    } catch { /* l'evento non salvato non blocca l'aggiornamento stato */ }
  }

  // ── LA DATA DELLA GIACENZA E' UN FATTO, NON UNO STATO ────────────────────────────────────────
  // Stava dentro `upd` qui sotto, quindi era ostaggio della regola "lo stato avanza solo in
  // avanti". Ma la scala e': spedita 1, in_transito 2, in_consegna 3, in_giacenza 4,
  // non_consegnato 5, reso_mittente 6, consegnata 7 — e nella realta' del corriere la MANCATA
  // CONSEGNA (5) precede quasi sempre la giacenza (4). Quindi `prioritaStato(4) > prioritaStato(5)`
  // era falso, l'update non partiva, e `giacenza_data` non si scriveva MAI per quel percorso:
  // nemmeno quando l'evento si chiamava 'stock.created' ed era riconosciuto.
  // Verificato in produzione il 17/09 su 3UW1UHA236635: 'stock.opened' ricevuto, firma verificata,
  // risposta 200 — e giacenza_data rimasta nulla perche' la spedizione era gia' 'non_consegnato'.
  // Si scrive SOLO se manca: ri-datare una giacenza gia' nota ri-armerebbe l'addebito (il trigger
  // trg_giacenza_da_addebitare si arma proprio su questo campo).
  // La data e' quella VERA del fornitore (`opened_at` nel payload di stock.opened), non l'ora in cui
  // ci arriva la notifica.
  if (nuovo === 'in_giacenza') {
    const senzaData = (speds || []).filter((sp: any) => !sp.giacenza_data).map((sp: any) => sp.id)
    if (senzaData.length) {
      const apertura = new Date(d?.opened_at || d?.date || d?.data || Date.now())
      const quando = isNaN(apertura.getTime()) ? new Date().toISOString() : apertura.toISOString()
      await admin.from('spedizioni').update({ giacenza_data: quando }).in('id', senzaData)
      console.log('[WEBHOOK][SPEDISCI] giacenza aperta', tracking, 'il', quando, `(${senzaData.length})`)
    }
  }

  // ── GIACENZA CHIUSA DAL FORNITORE ('stock.closed') ───────────────────────────────────────────
  // Payload reale (17-18/09, raccolto loggandolo): stessa forma dell'apertura —
  //   { event, timestamp, ldv, opened_at, stock_id, shipping_id, statusCode, contractCode, domain }
  // Niente `closed_at` (vale il `timestamp`) e NESSUN motivo testuale.
  //
  // `statusCode` NON viene usato, di proposito. Porta l'esito lato fornitore (osservati 3,4,5,6,7 su
  // 10 chiusure) ma NON e' biunivoco col nostro stato: 3 e 7 finiscono entrambi in reso, 4 e 6 in
  // "non consegnato". Tradurlo a intuito, su un flusso che muove addebiti, no: serve la tabella dei
  // codici del fornitore. Finche' non c'e', ci si limita ai due fatti certi che l'evento porta.
  //
  // 1) RECUPERO DELL'APERTURA MAI REGISTRATA. L'evento porta `opened_at`, quindi una giacenza che
  //    non abbiamo mai visto (i due difetti chiusi il 17/09) si puo' scrivere con la sua data VERA.
  //    ATTENZIONE: scrivere `giacenza_data` arma l'addebito dell'apertura (trg_giacenza_da_addebitare).
  //    E' voluto — una giacenza c'e' stata davvero — ma vale la pena saperlo quando si guardano i conti.
  // 2) CHIUSURA. Solo da 'aperta'/'in gestione'/nulla: 'svincolata' e 'chiusa' sono esiti gia' decisi.
  //    Non si guarda lo stato della spedizione: se e' terminale ci ha gia' pensato il trigger
  //    trg_chiudi_giacenza_terminale, e se quel trigger non e' scattato (perche' la data l'abbiamo
  //    scritta solo ora) questa e' l'unica strada che la chiude.
  if (event === 'stock.closed' && (speds || []).length) {
    const ap = new Date(d?.opened_at || '')
    const quandoAperta = isNaN(ap.getTime()) ? null : ap.toISOString()
    if (quandoAperta) {
      const daRecuperare = (speds || []).filter((sp: any) => !sp.giacenza_data).map((sp: any) => sp.id)
      if (daRecuperare.length) {
        await admin.from('spedizioni').update({ giacenza_data: quandoAperta }).in('id', daRecuperare)
        console.log('[WEBHOOK][SPEDISCI] giacenza RECUPERATA da stock.closed', tracking, 'aperta il', quandoAperta, `(${daRecuperare.length})`)
      }
    }
    const daChiudere = (speds || [])
      .filter((sp: any) => !sp.giacenza_stato || sp.giacenza_stato === 'aperta' || sp.giacenza_stato === 'in_gestione')
      .map((sp: any) => sp.id)
    if (daChiudere.length) {
      await admin.from('spedizioni').update({ giacenza_stato: 'chiusa' }).in('id', daChiudere)
      console.log('[WEBHOOK][SPEDISCI] giacenza chiusa', tracking, `(${daChiudere.length})`)
    }
  }

  if (nuovo) {
    const upd: any = { stato: nuovo }
    // Lo stato avanza SOLO IN AVANTI (mai declassare: es. 'spedita' dopo la distinta non deve tornare
    // 'in lavorazione' per un evento vecchio); consegnate/annullate restano terminali.
    const daAggiornare = (speds || []).filter((sp: any) =>
      sp.stato !== 'consegnata' && sp.stato !== 'annullata' && prioritaStato(nuovo) > prioritaStato(sp.stato)
      && !(sp.stato === 'reso_mittente' && nuovo === 'consegnata')   // consegna del ritorno, non del pacco
    ).map((sp: any) => sp.id)
    if (daAggiornare.length) await admin.from('spedizioni').update(upd).in('id', daAggiornare)
  }

  return new NextResponse('OK', { status: 200 })
}

// Verifica dell'endpoint: diversi pannelli (e chi configura) provano l'indirizzo in GET prima di
// attivarlo. Rispondere 405 lo faceva risultare NON valido e il webhook non veniva mai acceso.
// Qui si conferma soltanto che l'indirizzo è vivo: nessun dato, nessuna azione.
export async function GET() {
  return new NextResponse('OK — endpoint webhook attivo. Gli eventi vanno inviati in POST.', {
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
