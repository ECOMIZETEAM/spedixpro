import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey } from '@/lib/api-auth'
import { registraMovimento } from '@/lib/movimenti'
import { rimborsaCatena } from '@/lib/cascata'

// Dettaglio/stato di una spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: s } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,stato,costo_totale,dest_nome,dest_citta,dest_provincia,dest_cap,dest_paese,peso_reale,colli,contrassegno,created_at,cliente_id,corriere_id,corrieri(nome_contratto)')
    .eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  return NextResponse.json({
    id: s.id, tracking: s.tracking_number || s.numero, stato: s.stato,
    contratto: (s.corrieri as any)?.nome_contratto || null, prezzo: Number(s.costo_totale || 0), valuta: 'EUR',
    destinatario: { nome: s.dest_nome, citta: s.dest_citta, provincia: s.dest_provincia, cap: s.dest_cap, paese: s.dest_paese },
    colli: s.colli, peso: s.peso_reale, contrassegno: Number(s.contrassegno || 0),
    label_url: `/api/v1/shipments/${s.id}/label`, created_at: s.created_at,
  })
}

// Annulla una spedizione creata via API — SOLO se ancora "in_lavorazione"
// (non ancora affidata al corriere). Rimborso credito cliente + cascata master.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,numero,dest_nome,dest_provincia,dest_cap,dest_paese,costo_totale,costo_spedizione,corriere_id,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,stato')
    .eq('id', id).maybeSingle()
  if (!sped || sped.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  if (sped.stato === 'annullata') return NextResponse.json({ success: true, already: true })

  // REGOLA API: annullabile solo finché è in lavorazione (non ancora data al corriere).
  if (sped.stato !== 'in_lavorazione') {
    return NextResponse.json({ error: 'Spedizione già affidata al corriere: non annullabile via API' }, { status: 409 })
  }

  const { error: updErr } = await admin.from('spedizioni').update({ stato: 'annullata' }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  // Rimborso credito al cliente (best-effort)
  const costoCliente = Number(sped.costo_totale || 0)
  if (costoCliente > 0 && sped.cliente_id) {
    try {
      await registraMovimento(admin, {
        masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'rimborso',
        descrizione: `Rimborso ${sped.numero} - ${sped.dest_nome || ''}`.trim(), riferimento: sped.numero,
        importo: Math.abs(costoCliente), spedizioneId: sped.id, createdBy: null,
      })
    } catch (e) { console.error('API rimborso cliente:', e) }
  }
  // Rimborso a cascata ai master (speculare all'addebito in creazione)
  try {
    const { data: corriere } = await admin.from('corrieri').select('master_id').eq('id', sped.corriere_id).single()
    if (corriere?.master_id) {
      const packages = (Array.isArray(sped.colli_dettaglio) && sped.colli_dettaglio.length)
        ? sped.colli_dettaglio.map((c: any) => ({ weight: sped.peso_reale || 1, length: c.lunghezza, width: c.larghezza, height: c.altezza }))
        : [{ weight: sped.peso_reale || 1, length: sped.lunghezza, width: sped.larghezza, height: sped.altezza }]
      await rimborsaCatena(admin, {
        masterDirettoId: sped.master_id, corriereOwnerId: corriere.master_id,
        costoSpedizione: Number(sped.costo_spedizione || 0), provincia: sped.dest_provincia || '',
        cap: sped.dest_cap || '', paese: sped.dest_paese || 'IT', packages,
        numero: sped.numero, destNome: sped.dest_nome || '', spedizioneId: sped.id, createdBy: null,
      })
    }
  } catch (e) { console.error('API rimborso cascata:', e) }

  return NextResponse.json({ success: true, stato: 'annullata' })
}
