import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'
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
  // Chiavi candidate: secret grezzo + (per whsec_) il contenuto decodificato base64
  const chiavi: (string | Buffer)[] = [secret]
  if (secret.startsWith('whsec_')) { try { chiavi.push(Buffer.from(secret.slice(6), 'base64')) } catch {} }
  // Contenuti firmabili: con message-id (standard) e senza (legacy)
  const contenuti = [`${timestamp}.${raw}`]
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

// Mappa evento + stato Spedisci.online allo stato interno.
// Eventi reali del pannello: tracking.update, shipment.created, stock.created (giacenza), invoice.created.
function mapStato(event: string, statusStr: string): string | null {
  if (event === 'stock.created') return 'in_giacenza'   // Nuova giacenza
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
  if (!candidati.length) return new NextResponse('Webhook non configurato', { status: 500 })

  const wid = req.headers.get('webhook-id') || req.headers.get('svix-id')
  const ts = req.headers.get('webhook-timestamp') || req.headers.get('svix-timestamp')
  const sig = req.headers.get('webhook-signature') || req.headers.get('svix-signature')
  if (!candidati.some(sec => verifica(raw, wid, ts, sig, sec))) {
    console.log('[WEBHOOK][SPEDISCI] firma NON verificata. id:', wid, 'ts:', ts, 'sig:', String(sig).slice(0, 60))
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
  if (!tracking) { console.log('[WEBHOOK][SPEDISCI] payload sconosciuto:', raw.slice(0, 400)); return new NextResponse('OK', { status: 200 }) }

  const dettagli: any[] = Array.isArray(d?.TrackingDettaglio) ? d.TrackingDettaglio : []
  if (dettagli.length) {
    const { data: speds2 } = await admin.from('spedizioni').select('id,stato,giacenza_data').eq('tracking_number', tracking)
    if (!(speds2 || []).length) return new NextResponse('OK', { status: 200 })
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
      await admin.from('tracking_events').delete().in('spedizione_id', ids)
      if (eventi.length) await admin.from('tracking_events').insert(ids.flatMap((id: string) => eventi.map((e: any) => ({ spedizione_id: id, ...e }))))
    } catch { /* best-effort */ }
    // Stato piu' avanzato della cronologia, con le regole di sempre
    let avanzato: string | null = null
    for (const e of eventi) if (e.stato && prioritaStato(e.stato) > prioritaStato(avanzato)) avanzato = e.stato
    if (avanzato) {
      const upd2: any = { stato: avanzato }
      const daAgg = (speds2 || []).filter((sp: any) =>
        sp.stato !== 'consegnata' && sp.stato !== 'annullata' && prioritaStato(avanzato!) > prioritaStato(sp.stato)
        && !(sp.stato === 'reso_mittente' && avanzato === 'consegnata')   // consegna del ritorno, non del pacco
      )
      const idsAgg = daAgg.map((sp: any) => sp.id)
      if (idsAgg.length) {
        // giacenza_data solo alla PRIMA rilevazione (non ri-datare giacenze gia' note)
        if (avanzato === 'in_giacenza' && daAgg.every((sp: any) => !sp.giacenza_data)) upd2.giacenza_data = new Date().toISOString()
        await admin.from('spedizioni').update(upd2).in('id', idsAgg)
        console.log('[WEBHOOK][SPEDISCI]', tracking, '-> stato', avanzato, `(${idsAgg.length} agg.)`)
      }
    }
    return new NextResponse('OK', { status: 200 })
  }

  const nuovo = mapStato(event, d?.status || d?.stato || d?.description || '')

  // Spedizioni interessate (per id): servono sia per l'avanzamento stato sia per SALVARE L'EVENTO.
  const { data: speds } = await admin.from('spedizioni').select('id,stato').eq('tracking_number', tracking)

  // SALVA L'EVENTO in tracking_events: Spedisci ha CHIUSO il polling del tracking (403 "For tracking
  // please use the Webhooks events") → il popup tracking mostra QUESTI eventi. Best-effort.
  const descrizione = String(d?.status || d?.stato || d?.description || event || '').slice(0, 300)
  const luogo = (String(d?.location || d?.office || d?.officeDescription || '').slice(0, 200)) || null
  let dataEvento = new Date(d?.date || d?.data || d?.timestamp || Date.now())
  if (isNaN(dataEvento.getTime())) dataEvento = new Date()
  if ((speds || []).length && descrizione && (event === 'tracking.update' || event === 'stock.created')) {
    try {
      await admin.from('tracking_events').insert((speds || []).map((sp: any) => ({
        spedizione_id: sp.id, stato: nuovo, descrizione, luogo, data_evento: dataEvento.toISOString(),
      })))
    } catch { /* l'evento non salvato non blocca l'aggiornamento stato */ }
  }

  if (nuovo) {
    const upd: any = { stato: nuovo }
    if (nuovo === 'in_giacenza') upd.giacenza_data = new Date().toISOString()
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
