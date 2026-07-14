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
  // Stato attuale della distinta (per idempotenza e per i dati della rimessa)
  const { data: dist } = await admin.from('distinte_contrassegni')
    .select('id,master_id,cliente_id,target_master_id,numero,totale_iniziale,stato')
    .eq('id', id).maybeSingle()
  if (!dist) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  const giaPagata = dist.stato === 'pagata'
  const totale = Number(dist.totale_iniziale || 0)

  // Normalizzo l'input in una lista di righe {metodo, importo}.
  // - pagamenti[]  -> pagamento SUDDIVISO (es. metà bonifico, metà compensata)
  // - metodoPagamento -> pagamento unico dell'intero totale
  let righe: { metodo: string; importo: number }[] = []
  if (Array.isArray(pagamenti) && pagamenti.length) {
    righe = pagamenti
      .map((p: any) => ({ metodo: String(p.metodo || '').toLowerCase(), importo: Math.round((Number(p.importo) || 0) * 100) / 100 }))
      .filter(p => p.metodo && p.importo > 0)
    if (!righe.length) return NextResponse.json({ error: 'Ripartizione pagamento non valida' }, { status: 400 })
    const somma = righe.reduce((s, p) => s + p.importo, 0)
    if (Math.abs(somma - totale) > 0.02) {
      return NextResponse.json({ error: `La somma delle modalità (€${somma.toFixed(2)}) non corrisponde al totale (€${totale.toFixed(2)})` }, { status: 400 })
    }
  } else if (metodoPagamento) {
    righe = [{ metodo: String(metodoPagamento).toLowerCase(), importo: totale }]
  } else {
    return NextResponse.json({ error: 'Metodo pagamento mancante' }, { status: 400 })
  }
  const metodoLabel = righe.length > 1
    ? righe.map(p => `${p.metodo} €${p.importo.toFixed(2)}`).join(' + ')
    : righe[0].metodo

  const { error } = await supabase.from('distinte_contrassegni').update({
    stato: 'pagata',
    metodo_pagamento: metodoLabel,
    data_pagamento: new Date().toISOString().split('T')[0],
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Aggiorna stato contrassegno spedizioni
  const { data: righeSped } = await supabase.from('distinte_contrassegni_righe')
    .select('spedizione_id').eq('distinta_id', id)
  if (righeSped?.length) {
    await supabase.from('spedizioni').update({ stato_contrassegno: 'pagato' })
      .in('id', righeSped.map(r => r.spedizione_id))
  }

  // CONTRASSEGNO nel credito SOLO per la quota "compensata": invece di pagare quel COD in
  // banca/contanti, lo accreditiamo sul credito del destinatario (riduce il suo debito).
  // Le altre modalità (contanti/assegno/sepa/bonifico) = denaro fuori dal wallet → nessun movimento.
  let compensato = 0
  for (const p of righe) if (p.metodo === 'compensata') compensato += p.importo
  compensato = Math.round(compensato * 100) / 100

  let movimentoCredito = false
  if (!giaPagata && compensato > 0) {
    const descrizione = `Rimessa contrassegni compensata — distinta N.${dist.numero}`
    const riferimento = `DIST-COD-${dist.numero}`
    try {
      if (dist.cliente_id) {
        await registraMovimento(admin, {
          masterId: dist.master_id, clienteId: dist.cliente_id, tipo: 'contrassegno',
          descrizione, importo: compensato, riferimento, createdBy: user.id,
        })
        movimentoCredito = true
      } else if (dist.target_master_id) {
        await registraMovimentoMaster(admin, {
          masterOwnerId: dist.master_id, masterTargetId: dist.target_master_id, tipo: 'contrassegno',
          descrizione, importo: compensato, riferimento, createdBy: user.id,
        })
        movimentoCredito = true
      }
    } catch (e) { console.error('Movimento contrassegno compensato:', e) }
  }

  return NextResponse.json({ success: true, movimentoCredito, compensato })
}
