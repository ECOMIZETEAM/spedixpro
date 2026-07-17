import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { bloccaAgente } from '@/lib/agente'

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  const { id } = await params
  const body = await req.json()
  const { metodoPagamento, pagamenti } = body

  const admin = createAdminSupabase()
  const { data: dist } = await admin.from('distinte_contrassegni')
    .select('id,master_id,cliente_id,target_master_id,numero,totale_iniziale,totale_pagato,stato')
    .eq('id', id).maybeSingle()
  if (!dist) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  const totale = Math.round(Number(dist.totale_iniziale || 0) * 100) / 100
  const giaPagato = Math.round(Number(dist.totale_pagato || 0) * 100) / 100
  const residuo = Math.round((totale - giaPagato) * 100) / 100
  if (residuo <= 0.02) return NextResponse.json({ error: 'Distinta già saldata' }, { status: 400 })

  // Righe pagamento {metodo, importo}.
  // - pagamenti[]      -> ripartizione (es. metà bonifico, metà compensata)
  // - metodoPagamento  -> metodo unico; con body.importo si paga PARZIALE, altrimenti salda il residuo
  let righe: { metodo: string; importo: number }[] = []
  if (Array.isArray(pagamenti) && pagamenti.length) {
    righe = pagamenti.map((p: any) => ({ metodo: String(p.metodo || '').toLowerCase(), importo: Math.round((Number(p.importo) || 0) * 100) / 100 }))
  } else if (metodoPagamento) {
    const imp = body.importo != null ? Math.round((Number(body.importo) || 0) * 100) / 100 : residuo
    righe = [{ metodo: String(metodoPagamento).toLowerCase(), importo: imp }]
  }
  righe = righe.filter(p => p.metodo && p.importo > 0)
  if (!righe.length) return NextResponse.json({ error: 'Metodo/importo pagamento mancante' }, { status: 400 })
  const paidThis = Math.round(righe.reduce((s, p) => s + p.importo, 0) * 100) / 100
  if (paidThis > residuo + 0.02) {
    return NextResponse.json({ error: `L'importo (€${paidThis.toFixed(2)}) supera il residuo da saldare (€${residuo.toFixed(2)})` }, { status: 400 })
  }

  const nuovoPagato = Math.round((giaPagato + paidThis) * 100) / 100
  const saldata = nuovoPagato >= totale - 0.02
  // Es. "bonifico €50.00" (parziale) o "bonifico €30.00 + compensata €20.00"
  const metodoLabel = righe.map(p => `${p.metodo} €${p.importo.toFixed(2)}`).join(' + ')

  const { error } = await supabase.from('distinte_contrassegni').update({
    totale_pagato: nuovoPagato,
    stato: saldata ? 'pagata' : 'parziale',   // parziale finché il residuo non è saldato
    metodo_pagamento: metodoLabel,
    data_pagamento: new Date().toISOString().split('T')[0],
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Spedizioni -> 'pagato' SOLO quando la distinta è saldata del tutto (parziale = restano in_distinta)
  if (saldata) {
    const { data: righeSped } = await supabase.from('distinte_contrassegni_righe').select('spedizione_id').eq('distinta_id', id)
    if (righeSped?.length) {
      await supabase.from('spedizioni').update({ stato_contrassegno: 'pagato' }).in('id', righeSped.map(r => r.spedizione_id))
    }
  }

  // COMPENSAZIONE di QUESTO pagamento -> accredita il credito del destinatario (cliente/master).
  // Bonifico/contanti/assegno/sepa = denaro fuori dal wallet, nessun movimento.
  // Riferimento unico per importo cumulativo → i pagamenti parziali successivi non si doppiano.
  let compensato = 0
  for (const p of righe) if (p.metodo === 'compensata') compensato += p.importo
  compensato = Math.round(compensato * 100) / 100
  let movimentoCredito = false
  if (compensato > 0) {
    const descrizione = `Rimessa contrassegni compensata — distinta N.${dist.numero}`
    const riferimento = `DIST-COD-${dist.numero}-${nuovoPagato}`
    try {
      if (dist.cliente_id) {
        await registraMovimento(admin, { masterId: dist.master_id, clienteId: dist.cliente_id, tipo: 'contrassegno', descrizione, importo: compensato, riferimento, createdBy: user.id })
        movimentoCredito = true
      } else if (dist.target_master_id) {
        await registraMovimentoMaster(admin, { masterOwnerId: dist.master_id, masterTargetId: dist.target_master_id, tipo: 'contrassegno', descrizione, importo: compensato, riferimento, createdBy: user.id })
        movimentoCredito = true
      }
    } catch (e) { console.error('Movimento contrassegno compensato:', e) }
  }

  return NextResponse.json({ success: true, saldata, totalePagato: nuovoPagato, residuo: Math.round((totale - nuovoPagato) * 100) / 100, movimentoCredito, compensato })
}
