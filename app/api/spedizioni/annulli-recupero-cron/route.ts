import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON: le spedizioni IN ATTESA DI CANCELLAZIONE (annullamento_pending / annullamento_manuale) che
// RISULTANO PARTITE tornano "buone" da sole. Annullare un pacco che ha gia' viaggiato non ha senso:
// il corriere lo fattura comunque e il cliente lo deve pagare.
//
// "Partita" = una prova che il collo e' entrato nella rete del corriere:
//  - il fornitore l'ha RIPESATA (misura fatta sul collo vero → e' partita), o
//  - c'e' un evento di tracking con uno stato che implica il transito (in transito / in consegna /
//    consegnata / in giacenza / mancata consegna / reso). Questi arrivano dai WEBHOOK delle
//    piattaforme anche mentre e' in coda: il cron di tracking la esclude apposta (per non perderle lo
//    stato d'annullo), ma i webhook no. NON basta "spedita" da sola (spesso e' solo la LDV
//    accettata/stampata): su un annullo appena richiesto non va scambiata per un transito.
//
// Il ripristino rimette SOLO lo stato (come il pulsante "Ripristina"): NESSUN movimento di credito —
// lo storno avverrebbe solo alla conferma dell'annullo, che qui non e' mai avvenuta — e nessuna
// chiamata al corriere. Tornata "in_lavorazione" non e' piu' esclusa dal tracking, che al giro dopo
// la porta allo stato reale (consegnata, ecc.).
const STATI_PARTITA = ['in_transito', 'in_consegna', 'consegnata', 'in_giacenza', 'non_consegnato', 'reso_mittente']

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  const { data: coda } = await admin.from('spedizioni')
    .select('id,numero,stato,stato_precedente')
    .in('stato', ['annullamento_pending', 'annullamento_manuale'])
    .limit(3000)
  const ids = (coda || []).map((s: any) => s.id)
  if (!ids.length) return NextResponse.json({ ok: true, esaminate: 0, ripristinate: 0 })

  const partite = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    // Ripesatura del fornitore = misura reale sul collo = e' partita.
    const { data: mv } = await admin.from('movimenti')
      .select('spedizione_id').eq('tipo', 'rettifica').like('riferimento', 'RIPFORN-%').in('spedizione_id', chunk)
    for (const m of (mv || [])) if ((m as any).spedizione_id) partite.add((m as any).spedizione_id)
    // Evento di tracking con uno stato che implica il transito (basta un id: mi serve solo SAPERE se c'e').
    const { data: ev } = await admin.from('tracking_events')
      .select('spedizione_id').in('stato', STATI_PARTITA).in('spedizione_id', chunk)
    for (const e of (ev || [])) if ((e as any).spedizione_id) partite.add((e as any).spedizione_id)
  }

  let ripristinate = 0, errori = 0
  for (const s of (coda || [])) {
    if (!partite.has((s as any).id)) continue
    const { error } = await admin.from('spedizioni').update({
      stato: (s as any).stato_precedente || 'in_lavorazione',
      stato_precedente: null,
      annullamento_richiesto_at: null,
      annullamento_da: null,
      annullamento_errore: null,
      annullamento_owner_id: null,
    }).eq('id', (s as any).id)
    if (error) { errori++; console.error('[ANNULLI][RECUPERO] ripristino fallito', (s as any).numero, error.message) }
    else { ripristinate++; console.warn('[ANNULLI][RECUPERO] partita → ripristinata:', (s as any).numero) }
  }

  return NextResponse.json({ ok: true, esaminate: ids.length, partite: partite.size, ripristinate, errori })
}
