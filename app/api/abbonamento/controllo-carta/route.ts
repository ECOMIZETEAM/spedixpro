import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { INIZIO_OBBLIGO_CARTA } from '@/lib/abbonamento-cambi'

// CONTROLLO GIORNALIERO: chi ha un piano attivo ma nessuna carta non sta pagando il canone.
//
// Girava una volta al mese, il primo. Non basta: chi toglie la carta il 5 resterebbe scoperto fino
// al primo del mese dopo, cioe' quasi un mese di servizio gratis. Qui si guarda ogni giorno.
//
// Non congela nessuno: fa solo partire il conto alla rovescia (3 giorni), che e' la stessa regola
// di un addebito fallito. La data si scrive UNA volta sola — riscriverla ogni giorno rimanderebbe
// il congelamento all'infinito, che e' esattamente il modo in cui questi controlli non funzionano.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron

  // Periodo di preavviso per il passaggio alla carta: prima di questa data non si segna nessuno.
  if (Date.now() < INIZIO_OBBLIGO_CARTA.getTime()) {
    return NextResponse.json({ success: true, inAttesa: true, dal: INIZIO_OBBLIGO_CARTA.toISOString() })
  }

  const admin = createAdminSupabase()
  const { data: attivi } = await admin.from('masters')
    .select('id,nome,parent_master_id,abbonamento_esente,stripe_subscription_id,stripe_stato,pagamento_scaduto_dal')
    .not('abbonamento_piano', 'is', null)

  const segnati: string[] = []
  for (const m of (attivi || [])) {
    if (!m.parent_master_id) continue                                   // il principale e' la piattaforma
    if (m.abbonamento_esente) continue                                  // tiene il piano, non paga
    if (m.stripe_subscription_id && m.stripe_stato !== 'canceled') continue  // paga con carta: ci pensa il circuito
    if (m.pagamento_scaduto_dal) continue                               // conto alla rovescia gia' partito

    await admin.from('masters')
      .update({ pagamento_scaduto_dal: new Date().toISOString() })
      .eq('id', m.id).is('pagamento_scaduto_dal', null)
    segnati.push(m.nome || m.id)
  }
  return NextResponse.json({ success: true, segnati: segnati.length, chi: segnati })
}
