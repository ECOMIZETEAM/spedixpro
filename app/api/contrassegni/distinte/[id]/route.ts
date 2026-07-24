import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { bloccaAgente } from '@/lib/agente'

// ELIMINA una distinta contrassegni SBAGLIATA (es. file caricato per errore). Consentito SOLO:
// - al master proprietario;
// - se in lavorazione SENZA pagamenti registrati (pagata/parziale = soldi mossi, non si tocca);
// - se il destinatario di rete NON l'ha già accettata/propagata.
// Le spedizioni tornano 'in_attesa' e possono rientrare in una nuova distinta.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: dist } = await admin.from('distinte_contrassegni')
    .select('id,master_id,numero,stato,totale_pagato,accettata_target')
    .eq('id', id).maybeSingle()
  if (!dist) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  if (dist.master_id !== utente.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (dist.stato !== 'in_lavorazione' || Number(dist.totale_pagato || 0) > 0) {
    return NextResponse.json({ error: 'Distinta non eliminabile: ci sono pagamenti registrati.' }, { status: 400 })
  }
  if ((dist as any).accettata_target) {
    return NextResponse.json({ error: 'Distinta non eliminabile: il destinatario l\'ha già accettata e propagata.' }, { status: 400 })
  }

  const { data: righe } = await admin.from('distinte_contrassegni_righe').select('spedizione_id').eq('distinta_id', id)
  const spedIds = (righe || []).map((r: any) => r.spedizione_id).filter(Boolean)
  await admin.from('distinte_contrassegni_righe').delete().eq('distinta_id', id)
  if (spedIds.length) {
    await admin.from('spedizioni')
      .update({ stato_contrassegno: 'in_attesa', distinta_contrassegno_id: null })
      .in('id', spedIds).eq('distinta_contrassegno_id', id).neq('stato_contrassegno', 'pagato')
  }
  const { error } = await admin.from('distinte_contrassegni').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Se la distinta eliminata era nata dal "Carica" di una rimessa ricevuta, RIAPRO le rimesse in
  // entrata che contengono quelle spedizioni (caricata_target=false): tornano nella sezione
  // "da caricare" e i contrassegni non restano MAI orfani (il re-carica salta ciò che è ancora
  // in altre mie distinte grazie all'anti-duplicato per-master).
  if (spedIds.length) {
    try {
      const { data: rientranti } = await admin.from('distinte_contrassegni_righe')
        .select('distinta_id, distinte_contrassegni!inner(id,target_master_id,caricata_target)')
        .in('spedizione_id', spedIds)
        .eq('distinte_contrassegni.target_master_id', utente.master_id)
        .eq('distinte_contrassegni.caricata_target', true)
      const daRiaprire = Array.from(new Set((rientranti || []).map((r: any) => r.distinta_id)))
      if (daRiaprire.length) {
        await admin.from('distinte_contrassegni')
          .update({ caricata_target: false, caricata_target_at: null })
          .in('id', daRiaprire)
      }
    } catch (e) { console.error('[COD][DELETE] riapertura rimesse origine:', e) }
  }
  return NextResponse.json({ success: true, spedizioniLiberate: spedIds.length })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{id: string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // Solo un MASTER può segnare pagata una distinta (mai il cliente destinatario).
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  const { metodoPagamento, pagamenti } = body

  const admin = createAdminSupabase()
  const { data: dist } = await admin.from('distinte_contrassegni')
    .select('id,master_id,cliente_id,target_master_id,numero,totale_iniziale,totale_pagato,stato')
    .eq('id', id).maybeSingle()
  if (!dist) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  // SOLO il master PROPRIETARIO (chi la deve pagare) può segnarla pagata: senza questo check il
  // DESTINATARIO poteva auto-accreditarsi il credito con metodo 'compensata' (il movimento gira
  // su client admin e bypassa la RLS che blocca solo l'update della testata).
  if (dist.master_id !== utente.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
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
  // e SOLO per le distinte verso CLIENTE: lo stato globale è "il cliente ha incassato". Il pagamento
  // di una rimessa verso un SOTTO-MASTER rende verde l'elenco DEL sotto-master (vista per-livello),
  // ma il cliente finale resta arancio finché il SUO master non gli paga la SUA distinta.
  if (saldata && dist.cliente_id) {
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
