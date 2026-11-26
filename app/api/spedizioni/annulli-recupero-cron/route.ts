import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { AVVISO_NON_ARRIVATA } from '@/lib/spedisci'
import { ripristinaPartita } from '@/lib/annulli-ripristino'

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

  // Il caso DOPO l'annullo: le SDA EXPRESS L annullate sul portale (POSTE non ha l'annullo via API) che
  // risultano partite lo stesso si riaddebitano a ogni livello. La regola e' in lib/annullo-poste; qui
  // si chiama ogni ora, sugli eventi gia' scritti da qualunque fonte (OneTracking, poste.it).
  let sorveglianza: any = null
  try {
    const { sorvegliaAnnullatePoste } = await import('@/lib/annullo-poste')
    const r = await sorvegliaAnnullatePoste(admin)
    sorveglianza = { pacchi: r.pacchi, partiti: r.partiti, riaddebitati: r.riaddebitati }
  } catch (e: any) { console.error('[ANNULLI][SORVEGLIANZA-POSTE]', e?.message) }

  const { data: coda, error: eCoda } = await admin.from('spedizioni')
    .select('id,numero,stato,stato_precedente')
    .in('stato', ['annullamento_pending', 'annullamento_manuale'])
    .order('id')
    .limit(3000)
  if (eCoda) { console.error('[ANNULLI][RECUPERO] coda non letta:', eCoda.message); return NextResponse.json({ ok: false, error: eCoda.message, sorveglianza }, { status: 500 }) }
  if ((coda || []).length >= 1000) console.warn('[ANNULLI][RECUPERO] coda di', (coda || []).length, 'righe: oltre le 1.000 la lettura puo\' essere troncata')
  const ids = (coda || []).map((s: any) => s.id)
  if (!ids.length) return NextResponse.json({ ok: true, esaminate: 0, ripristinate: 0, sorveglianza })

  // Blocchi da 100: una spedizione in coda da settimane accumula molti eventi, e una lettura oltre le
  // 1.000 righe si tronca senza dirlo. Una lettura fallita si dice: prima diventava «nessuna partita».
  const partite = new Set<string>()
  let lettureFallite = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    // Ripesatura del fornitore = misura reale sul collo = e' partita.
    const { data: mv, error: eMv } = await admin.from('movimenti')
      .select('spedizione_id').eq('tipo', 'rettifica').like('riferimento', 'RIPFORN-%').in('spedizione_id', chunk)
    if (eMv) { lettureFallite++; console.error('[ANNULLI][RECUPERO] ripesature non lette:', eMv.message) }
    for (const m of (mv || [])) if ((m as any).spedizione_id) partite.add((m as any).spedizione_id)
    // Evento di tracking con uno stato che implica il transito. Si salta l'avviso GLS «non (ancora) arrivata
    // presso la sede» registrato come in_transito: gli eventi salvati prima del 26/11/2026 lo hanno cosi', ma
    // su un pacco mai affidato al corriere non prova niente (vedi lib/spedisci, AVVISO_NON_ARRIVATA).
    const { data: ev, error: eEv } = await admin.from('tracking_events')
      .select('spedizione_id,stato,descrizione').in('stato', STATI_PARTITA).in('spedizione_id', chunk)
    if (eEv) { lettureFallite++; console.error('[ANNULLI][RECUPERO] eventi non letti:', eEv.message) }
    for (const e of (ev || [])) {
      if (!(e as any).spedizione_id) continue
      if ((e as any).stato === 'in_transito' && AVVISO_NON_ARRIVATA.test(String((e as any).descrizione || ''))) continue
      partite.add((e as any).spedizione_id)
    }
  }

  let ripristinate = 0, ordineGiaRispedito = 0, errori = lettureFallite
  for (const s of (coda || [])) {
    if (!partite.has((s as any).id)) continue
    const esito = await ripristinaPartita(admin, s as any, '[ANNULLI][RECUPERO]')
    if (esito === 'ripristinata') ripristinate++
    else if (esito === 'ordine_gia_rispedito') ordineGiaRispedito++
    else if (esito === 'errore') errori++
  }

  return NextResponse.json({ ok: true, esaminate: ids.length, partite: partite.size, ripristinate, ordineGiaRispedito, errori, sorveglianza })
}
