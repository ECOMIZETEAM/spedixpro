import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { createAdminSupabase } from '@/lib/supabase-admin'

// API pubblica MoovExpress — tariffa per il contratto della API key.
// Auth: Authorization: Bearer <api_key>
// Body: { packages:[{weight,length,width,height}], shipTo:{postalCode,state,country}, codValue?, insuranceValue? }
export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()
  const { data: cliente } = await admin.from('clienti').select('listino_cliente_id').eq('id', ctx.clienteId).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ error: 'Nessun listino associato al cliente' }, { status: 400 })

  const packages = Array.isArray(body.packages) && body.packages.length ? body.packages : [{ weight: body.weight || 1 }]
  const shipTo = body.shipTo || {}
  const provincia = (shipTo.state || shipTo.provincia || '').toUpperCase().trim()
  const cap = (shipTo.postalCode || shipTo.cap || '').toString().trim()
  const paese = (shipTo.country || shipTo.paese || 'IT').toUpperCase().trim()
  if (!provincia && paese === 'IT') return NextResponse.json({ error: 'Provincia destinatario obbligatoria (shipTo.state)' }, { status: 400 })

  const ris = await calcolaPrezzoListino(admin, {
    listinoId: cliente.listino_cliente_id, provincia, cap, paese, packages, corriereId: ctx.corriereId,
    citta: (shipTo.city || shipTo.citta || '').toString().trim(),   // CAP condivisi tra più comuni
  })
  if (!ris) return NextResponse.json({ error: 'Nessuna tariffa disponibile per questa destinazione/peso' }, { status: 400 })

  const cod = Number(body.codValue || 0)
  const ass = Number(body.insuranceValue || 0)
  const supp = await calcolaSupplementiCliente(admin, {
    listinoId: cliente.listino_cliente_id, corriereId: ctx.corriereId,
    contrassegno: cod, assicurazione: ass, valoreMerce: Number(body.valoreMerce || 0), nolo: ris.prezzo,
  })
  if (!supp.disponibile) return NextResponse.json({ error: 'Importo contrassegno/assicurazione oltre il massimo consentito per questo contratto' }, { status: 400 })

  const { data: corr } = await admin.from('corrieri').select('nome_contratto,tipo').eq('id', ctx.corriereId).single()
  const totale = Math.round((ris.prezzo + supp.contrassegno + supp.assicurazione) * 100) / 100

  return NextResponse.json({
    contratto: corr?.nome_contratto || null,
    zona: ris.zona,
    peso_reale: ris.peso_reale,
    peso_volume: ris.peso_volume,
    peso_fatturato: ris.peso_fatturato,
    nolo: ris.prezzo,
    contrassegno: supp.contrassegno,
    assicurazione: supp.assicurazione,
    prezzo: totale,
    valuta: 'EUR',
  })
}
