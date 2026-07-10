import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { annullaSpedizioneSulCorriere, rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (orario): prende le spedizioni in 'annullamento_pending' da più di 48h e invia
// l'annullo al corriere. Se il corriere accetta (o la considera già inesistente) → 'annullata'
// + storno credito. Se rifiuta (già spedita/chiusa) → torna allo stato precedente con la nota
// d'errore, così resta tracciabile e non sparisce.
export async function GET() {
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: pendenti } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,corriere_id,raw_response,tracking_number,stato_precedente,annullamento_da')
    .eq('stato', 'annullamento_pending')
    .lte('annullamento_richiesto_at', soglia)
    .order('annullamento_richiesto_at', { ascending: true })
    .limit(200)

  let annullate = 0, rifiutate = 0, errori = 0
  for (const s of (pendenti || [])) {
    try {
      const esito = await annullaSpedizioneSulCorriere(admin, s as any)
      if (esito.ok) {
        await admin.from('spedizioni').update({ stato: 'annullata', annullamento_errore: null }).eq('id', s.id)
        await rimborsaAnnulloSpedizione(admin, s as any, (s as any).annullamento_da || null)
        annullate++
      } else {
        // Il corriere rifiuta: torno allo stato precedente con la nota d'errore (non resta appesa in pending)
        await admin.from('spedizioni').update({
          stato: (s as any).stato_precedente || 'in_lavorazione',
          annullamento_richiesto_at: null,
          annullamento_errore: `Annullo rifiutato dal corriere: ${esito.reason || 'spedizione già spedita o chiusa in distinta'}`,
        }).eq('id', s.id)
        rifiutate++
      }
    } catch (e) {
      console.error('Errore cron annullamento spedizione', s.id, e)
      errori++
    }
  }

  return NextResponse.json({ ok: true, esaminate: pendenti?.length || 0, annullate, rifiutate, errori })
}
