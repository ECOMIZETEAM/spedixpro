import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester } from '@/lib/ripesature-harvester'
import { eventiDaFullTracking, statoDaLetturaPoste } from '@/lib/tracking-poste'
import { notificaCambioStato } from '@/lib/tracking-notifica'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Riceve dallo script locale il full-tracking OneTracking di un lotto di LDV cieche e scrive la
// cronologia + avanza lo stato SOLO-AVANTI (mai declassare, terminali intoccabili, reso appiccicoso).
// NON tocca giacenza_data: un backfill di una giacenza vecchia datandola "ora" falserebbe l'addebito
// a giornate — le giacenze restano al flusso normale del webhook/cron.
// E NON marca 'in_giacenza': senza giacenza_data sarebbe una "mezza giacenza" (stato in giacenza ma
// FUORI dalla lista, che filtra giacenza_data) → il cliente vedeva il pallino e poi la lista vuota.
// Soprattutto, la giacenza la apre solo il FORNITORE: un'istruzione data su una giacenza che lui non
// ha ancora aperto non ha dove arrivare. Qui prima c'era scritto che la giacenza "vera" la registrava
// bonifica-poste: era la stessa lettura di Poste da un'altra porta. Regola in `statoDaLetturaPoste`.
// body: { righe: [{ spedizione_id, ldv, tracking: [...] }], soloCronologia? }
//   (tracking = array `tracking` del full-tracking)
// soloCronologia: scrive la storia e non fa avanzare lo stato, TRANNE il reso al mittente.
// Serve al recupero delle consegnate senza cronologia (66.918 al 18/09/2026): li' lo stato e' gia'
// terminale e va bene com'e'. Il 18/09 si temeva che un reso trovato dentro una storia vecchia
// facesse scattare addebiti a catena su migliaia di pacchi tutti insieme, e si e' deciso di
// riempire prima la storia e contare poi, coi numeri davanti.
// CONTATI il 02/10/2026, a 54.233 cronologie recuperate su 66.918: i resi nascosti sono 35, lo
// 0,065%, per 644,10 EUR di nolo in tutta la catena. Non migliaia. Quindi il reso si applica
// subito: un pacco tornato al mittente che resta "consegnata" non fa pagare il reso a nessuno e
// fa credere al cliente che sia arrivato.
export async function POST(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const righe = Array.isArray(body?.righe) ? body.righe : []
  const soloCronologia = body?.soloCronologia === true
  let cronologie = 0, avanzati = 0, vuote = 0
  for (const r of righe) {
    const sid = r?.spedizione_id
    if (!sid) continue
    const eventi = eventiDaFullTracking(r?.tracking || [])
    if (!eventi.length) {
      // Poste non la conosce ancora: la segno controllata-vuota così non la si ri-interroga per 3
      // giorni (la esclude prossime_cieche_spedisci). Best-effort.
      try { await admin.from('cieche_ot_check').upsert({ spedizione_id: sid, ultimo_check: new Date().toISOString() }) } catch { /* best-effort */ }
      vuote++; continue
    }
    const { data: sp } = await admin.from('spedizioni').select('stato').eq('id', sid).maybeSingle()
    if (!sp) continue
    // Sostituisco la cronologia (arriva completa: niente duplicati) e riallineo lo stato.
    // Si AGGIUNGE quello che manca, non si riscrive: una lettura piu' povera di quella di prima
    // portava via descrizioni gia' buone. I doppioni li ferma la chiave unica del database.
    await admin.from('tracking_events').upsert(
      eventi.map((e) => ({ spedizione_id: sid, ...e, luogo: e.luogo ?? '' })),
      { onConflict: 'spedizione_id,data_evento,descrizione,luogo', ignoreDuplicates: true },
    )
    cronologie++
    // Col recupero di una storia vecchia passa SOLO il reso: tutto il resto di quella cronologia
    // e' il racconto di un viaggio gia' finito, e farebbe tornare indietro uno stato buono.
    const letto = statoDaLetturaPoste(eventi, (sp as any).stato)
    const nuovo = soloCronologia && letto !== 'reso_mittente' ? null : letto
    if (nuovo && nuovo !== (sp as any).stato) {
      await admin.from('spedizioni').update({ stato: nuovo }).eq('id', sid)
      avanzati++
      // Anche questa porta scrive lo stato dei contratti Poste: avvisa il cliente come le altre.
      // Non quando si sta riempiendo una storia vecchia: li' si corregge un archivio di mesi fa,
      // e una notifica "il tuo pacco e' tornato indietro" per una spedizione di luglio arriva
      // solo a spaventare. Lo stato corretto lo vede in piattaforma, e il reso lo addebita il cron.
      if (!soloCronologia) await notificaCambioStato(admin, sid, nuovo, (sp as any).stato)
    }
  }
  return NextResponse.json({ ok: true, cronologie, avanzati, vuote })
}
