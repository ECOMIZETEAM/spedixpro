import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { calcolaPrezzoListino, calcolaSupplementiCliente } from '@/lib/pricing'
import { createAdminSupabase } from '@/lib/supabase-admin'

// API pubblica MoovExpress — tariffa per il contratto della API key.
// Auth: Authorization: Bearer <api_key>
// Body: { packages:[{weight,length,width,height}], shipTo:{postalCode,state,country}, codValue?, insuranceValue? }
export async function POST(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b

  const body = await req.json().catch(() => ({}))
  const admin = createAdminSupabase()
  const { data: cliente } = await admin.from('clienti').select('listino_cliente_id').eq('id', ctx.clienteId).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ error: 'Nessun listino associato al cliente' }, { status: 400 })

  // Contratto in pausa, al proprio livello o SOPRA: non si quota. Rispondere un prezzo per un
  // contratto sospeso porterebbe il cliente a tentare la spedizione e a vederla rifiutata dopo.
  const { data: contratto } = await admin.from('corrieri')
    .select('nome_contratto,tipo,attivo,master_id,settings,multicollo').eq('id', ctx.corriereId).maybeSingle()
  {
    const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
    const sospesi = await contrattiSospesiSopra((contratto as any)?.master_id)
    if ((contratto as any)?.attivo === false || sospesoDallaCatena((contratto as any)?.nome_contratto, sospesi)) {
      return NextResponse.json({ error: 'Contratto momentaneamente sospeso' }, { status: 400 })
    }
  }

  // Stesso collo predefinito della creazione (v1/shipments): senza le misure il preventivo
  // calcolava il volumetrico su zero e poteva quotare meno di quanto poi si spende davvero.
  const packages = Array.isArray(body.packages) && body.packages.length
    ? body.packages
    : [{ weight: Number(body.weight) || 1, length: 20, width: 15, height: 10 }]
  const shipTo = body.shipTo || {}
  const provincia = (shipTo.state || shipTo.provincia || '').toUpperCase().trim()
  const cap = (shipTo.postalCode || shipTo.cap || '').toString().trim()
  const paese = (shipTo.country || shipTo.paese || 'IT').toUpperCase().trim()
  if (!provincia && paese === 'IT') return NextResponse.json({ error: 'Provincia destinatario obbligatoria (shipTo.state)' }, { status: 400 })

  // I LIMITI DEL COLLO VALGONO ANCHE NEL PREVENTIVO.
  // La creazione li applica gia' (v1/shipments); qui no, e il risultato era un preventivo che
  // prometteva un prezzo per un collo che poi veniva rifiutato al momento di spedire. Chi integra
  // le API costruisce il proprio carrello su questa risposta: il rifiuto arrivava al cliente
  // finale, ad acquisto gia' fatto.
  // Stessa libreria della creazione: una regola sola, stesso esito da entrambe le porte.
  const pesoRealeTot = packages.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
  if (packages.length > 1 && (contratto as any)?.multicollo === false)
    return NextResponse.json({ error: 'Il contratto non prevede il multicollo' }, { status: 400 })
  const { motivoLimiteCollo } = await import('@/lib/limiti-collo')
  const _motivoLimite = motivoLimiteCollo((contratto as any)?.settings, pesoRealeTot, packages)
  if (_motivoLimite) {
    return NextResponse.json({ error: `Collo non accettato da questo contratto: ${_motivoLimite}.` }, { status: 400 })
  }

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

  const totale = Math.round((ris.prezzo + supp.contrassegno + supp.assicurazione) * 100) / 100

  return NextResponse.json({
    contratto: (contratto as any)?.nome_contratto || null,
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
