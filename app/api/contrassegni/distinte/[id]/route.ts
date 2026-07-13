import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const { metodoPagamento } = body

  const admin = createAdminSupabase()
  // Stato attuale della distinta (per idempotenza e per i dati della rimessa)
  const { data: dist } = await admin.from('distinte_contrassegni')
    .select('id,master_id,cliente_id,target_master_id,numero,totale_iniziale,stato')
    .eq('id', id).maybeSingle()
  if (!dist) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  const giaPagata = dist.stato === 'pagata'

  const { error } = await supabase.from('distinte_contrassegni').update({
    stato: 'pagata',
    metodo_pagamento: metodoPagamento,
    data_pagamento: new Date().toISOString().split('T')[0],
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Aggiorna stato contrassegno spedizioni
  const { data: righe } = await supabase.from('distinte_contrassegni_righe')
    .select('spedizione_id').eq('distinta_id', id)
  if (righe?.length) {
    await supabase.from('spedizioni').update({ stato_contrassegno: 'pagato' })
      .in('id', righe.map(r => r.spedizione_id))
  }

  // CONTRASSEGNO nel credito SOLO se la rimessa è "compensata": invece di pagare il COD in
  // banca/contanti, lo accreditiamo sul credito del destinatario (riduce il suo debito).
  // Assegno / SEPA / Contanti = denaro fuori dal wallet → nessun movimento sul credito.
  let movimentoCredito = false
  if (!giaPagata && String(metodoPagamento || '').toLowerCase() === 'compensata') {
    const importo = Number(dist.totale_iniziale || 0)
    if (importo > 0) {
      const descrizione = `Rimessa contrassegni compensata — distinta N.${dist.numero}`
      const riferimento = `DIST-COD-${dist.numero}`
      try {
        if (dist.cliente_id) {
          await registraMovimento(admin, {
            masterId: dist.master_id, clienteId: dist.cliente_id, tipo: 'contrassegno',
            descrizione, importo, riferimento, createdBy: user.id,
          })
          movimentoCredito = true
        } else if (dist.target_master_id) {
          await registraMovimentoMaster(admin, {
            masterOwnerId: dist.master_id, masterTargetId: dist.target_master_id, tipo: 'contrassegno',
            descrizione, importo, riferimento, createdBy: user.id,
          })
          movimentoCredito = true
        }
      } catch (e) { console.error('Movimento contrassegno compensato:', e) }
    }
  }

  return NextResponse.json({ success: true, movimentoCredito })
}
