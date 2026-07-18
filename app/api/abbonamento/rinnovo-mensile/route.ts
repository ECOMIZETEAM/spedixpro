import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimentoMaster } from '@/lib/movimenti'
import { meseCorrente } from '@/lib/piani'

// CRON (1° del mese): riaddebita il canone ai master ATTIVI (che hanno un piano),
// accreditando l'incasso al SUPERROOT. I master disdetti (piano null) sono bloccati
// e NON vengono addebitati. Idempotente: salta chi ha già abbonamento_mese = mese corrente.
export async function GET() {
  const admin = createAdminSupabase()
  const mese = meseCorrente()

  // Superroot = master senza padre
  const { data: roots } = await admin.from('masters').select('id').is('parent_master_id', null).limit(1)
  const rootId = roots?.[0]?.id || null

  const { data: attivi } = await admin.from('masters')
    .select('id,nome,abbonamento_piano,abbonamento_prezzo,abbonamento_mese,parent_master_id,abbonamento_esente')
    .not('abbonamento_piano', 'is', null)

  let addebitati = 0, esentiSaltati = 0
  for (const m of (attivi || [])) {
    if (m.abbonamento_mese === mese) continue          // già addebitato questo mese
    if (!m.parent_master_id) continue                  // il root è la piattaforma: esente
    // Master ESENTI (es. LL / Ecomize Solution / MULTIEXPRESS): tengono il piano ma NON pagano.
    if (m.abbonamento_esente) { await admin.from('masters').update({ abbonamento_mese: mese }).eq('id', m.id); esentiSaltati++; continue }
    const prezzo = Number(m.abbonamento_prezzo || 0)
    if (prezzo > 0) {
      try {
        await registraMovimentoMaster(admin, {
          masterOwnerId: m.id, masterTargetId: m.id, tipo: 'abbonamento',
          descrizione: `Canone mensile ${mese}`, importo: -Math.abs(prezzo), createdBy: null,
        })
        if (rootId) await registraMovimentoMaster(admin, {
          masterOwnerId: rootId, masterTargetId: rootId, tipo: 'abbonamento_incasso',
          descrizione: `Canone ${mese} da ${m.nome || 'master'}`, importo: Math.abs(prezzo), createdBy: null,
        })
        await admin.from('abbonamenti_pagamenti').insert({
          master_id: m.id, root_id: rootId, piano: m.abbonamento_piano, mese, importo: prezzo, pagato: false,
        })
      } catch (e) { console.error('Errore rinnovo abbonamento master', m.id, e); continue }
    }
    await admin.from('masters').update({ abbonamento_mese: mese }).eq('id', m.id)
    addebitati++
  }
  return NextResponse.json({ success: true, mese, addebitati, esentiSaltati })
}
