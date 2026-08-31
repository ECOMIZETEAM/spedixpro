import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

// API pubblica MoovExpress — chiude la giornata generando la distinta per il
// contratto della API key. Raccoglie le spedizioni non ancora in distinta.
// Auth: Authorization: Bearer <api_key>
// Body (opzionale): { shipmentIds?: string[], date?: 'YYYY-MM-DD' }
export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()

  // Spedizioni del cliente su questo contratto, non ancora chiuse in distinta e non annullate
  let q = admin.from('spedizioni')
    .select('id,colli,peso_reale,costo_totale')
    .eq('cliente_id', ctx.clienteId)
    .eq('corriere_id', ctx.corriereId)
    .is('distinta_id', null)
    .neq('stato', 'annullata')
  if (Array.isArray(body.shipmentIds) && body.shipmentIds.length) q = q.in('id', body.shipmentIds)

  const { data: righe } = await q
  if (!righe?.length) return NextResponse.json({ error: 'Nessuna spedizione da chiudere' }, { status: 400 })

  const totaleColli = righe.reduce((s: number, x: any) => s + Number(x.colli || 1), 0)
  const totalePeso = righe.reduce((s: number, x: any) => s + Number(x.peso_reale || 0), 0)
  const prezzoTotale = righe.reduce((s: number, x: any) => s + Number(x.costo_totale || 0), 0)

  // NUMERO dalla sequenza del database, come tutte le altre chiusure (portale master, portale
  // cliente, chiusura serale automatica). Qui invece si leggeva l'ultima distinta del master e si
  // faceva +1: la sequenza non avanzava, quindi il numero inventato veniva RIEMESSO identico dalla
  // chiusura successiva — e la distinta risale la rete, quindi il doppione lo vedono anche i master
  // sopra. Due clienti che chiudono nello stesso istante ottenevano lo stesso numero.
  const { data: numSeq } = await admin.rpc('prossimo_numero_distinta')
  const numeroDistinta = String(numSeq || Date.now())
  const dataDistinta = (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : new Date().toISOString().split('T')[0]

  const { data: distinta, error: insErr } = await admin.from('distinte').insert({
    master_id: ctx.masterId, cliente_id: ctx.clienteId, corriere_id: ctx.corriereId,
    numero: numeroDistinta, data: dataDistinta, stato: 'chiusa',
    totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: righe.length, prezzo_totale: prezzoTotale,
  }).select('id').single()
  if (insErr) { console.error('[V1][DISTINTE]', insErr.message); return NextResponse.json({ error: 'Distinta non creata' }, { status: 400 }) }

  const idsRighe = righe.map((r: any) => r.id)
  await admin.from('spedizioni').update({ distinta_id: distinta.id }).in('id', idsRighe)
  // Distinta = consegnate al corriere -> "spedita" (solo quelle ancora "in lavorazione", per non
  // sovrascrivere in_transito/consegnata). Mancava: le spedizioni chiuse via API restavano "in
  // lavorazione" per sempre, nel portale del cliente e in quello del master.
  await admin.from('spedizioni').update({ stato: 'spedita' }).in('id', idsRighe).eq('stato', 'in_lavorazione')

  // Tracking ai marketplace collegati: senza, gli ordini restavano non evasi e i tempi di spedizione
  // del marketplace continuavano a correre. UNICA porta: fulfillMarketplace applica la guardia
  // "mai evadere col numero provvisorio" per tutte le piattaforme. Best-effort.
  try { const { fulfillMarketplace } = await import('@/lib/fulfillMarketplace'); await fulfillMarketplace(admin, idsRighe) } catch { }

  // Chiusura al corriere (best-effort). `confermata_vettore` NON si scrive prima: veniva messo a
  // true insieme all'insert, quindi una chiusura fallita restava marcata come trasmessa e nessuno
  // se ne accorgeva piu'. Lo scrivono le funzioni di chiusura quando riesce davvero.
  try {
    const { chiudiBorderoSpedisci } = await import('@/lib/spedisci')
    await chiudiBorderoSpedisci(admin, distinta.id)
  } catch (e) { console.error('API close-day bordero:', e) }
  try {
    const { chiudiBordereauSpediamopro } = await import('@/lib/spediamopro')
    await chiudiBordereauSpediamopro(admin, distinta.id)
  } catch (e) { console.error('API close-day bordereau:', e) }
  // GLS: mancava qui (e nei flussi distinta cliente) → un partner con contratto GLS non chiudeva mai
  // la giornata GLS. I flussi master la chiamano su ogni distinta; l'altro provider fa skip. (audit #2)
  try {
    const { chiudiGiornataGls } = await import('@/lib/gls')
    await chiudiGiornataGls(admin, distinta.id)
  } catch (e) { console.error('API close-day gls:', e) }

  // Rileggo il borderò eventualmente prodotto (spedisci): lo restituisco come PDF base64.
  // NB: non esiste un endpoint /pdf per le distinte via API — restituisco direttamente il documento del corriere.
  const { data: distFinale } = await admin.from('distinte').select('bordero_id,bordero_pdf').eq('id', distinta.id).maybeSingle()
  const borderoPdf = distFinale?.bordero_pdf && !String(distFinale.bordero_id || '').startsWith('ERRORE') ? distFinale.bordero_pdf : null

  return NextResponse.json({
    id: distinta.id, numero: numeroDistinta, count: righe.length,
    totale_colli: totaleColli, totale_peso: totalePeso,
    bordero_id: distFinale?.bordero_id || null,
    bordero_pdf: borderoPdf,   // data:application/pdf;base64,... quando il corriere lo fornisce (spedisci); null per spediamopro
  })
}
