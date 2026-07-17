import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

// API pubblica MoovExpress — chiude la giornata generando la distinta per il
// contratto della API key. Raccoglie le spedizioni non ancora in distinta.
// Auth: Authorization: Bearer <api_key>
// Body (opzionale): { shipmentIds?: string[], date?: 'YYYY-MM-DD' }
export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
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

  // Numero progressivo distinta per il master
  const { data: ultima } = await admin.from('distinte')
    .select('numero').eq('master_id', ctx.masterId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  let numeroInt = 1000
  if (ultima?.numero) { const n = parseInt(String(ultima.numero).replace(/\D/g, '')); if (!isNaN(n)) numeroInt = n }
  const numeroDistinta = String(numeroInt + 1)
  const dataDistinta = (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : new Date().toISOString().split('T')[0]

  const { data: distinta, error: insErr } = await admin.from('distinte').insert({
    master_id: ctx.masterId, cliente_id: ctx.clienteId, corriere_id: ctx.corriereId,
    numero: numeroDistinta, data: dataDistinta, stato: 'chiusa',
    confermata_vettore: true, data_conferma: new Date().toISOString(),
    totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: righe.length, prezzo_totale: prezzoTotale,
  }).select('id').single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })

  await admin.from('spedizioni').update({ distinta_id: distinta.id }).in('id', righe.map((r: any) => r.id))

  // Chiusura bordero lato corriere (best-effort): per spedisci genera il borderò PDF del corriere.
  try {
    const { chiudiBorderoSpedisci } = await import('@/lib/spedisci')
    await chiudiBorderoSpedisci(admin, distinta.id)
  } catch (e) { console.error('API close-day bordero:', e) }

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
