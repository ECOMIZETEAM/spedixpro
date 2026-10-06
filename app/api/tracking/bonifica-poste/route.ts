import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { prioritaStato } from '@/lib/spedisci'
import { statoDaLetturaPoste, leggiTrackingPostePubblico } from '@/lib/tracking-poste'
import { notificaCambioStato } from '@/lib/tracking-notifica'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// TRACKING DELLE LDV CHE SONO CODICI POSTE, LETTO DAL TRACKING PUBBLICO DI poste.it.
// Due lavori diversi, stessa fonte e stesso freno (una LDV ogni 1,2s, al massimo 60 per giro — 40 dei
// Poste diretti + 20 della bonifica: la dose resta piccola per non far scattare il rate-limit di Poste,
// dove un 400 vuol dire "bloccati". Sessanta letture a 1,2s stanno in 72s, sotto il tetto di 120s).
//
// 1) BONIFICA (contratti 'spedisci'): il provider ha chiuso il polling (webhook-only) e le spedizioni
//    gia' in viaggio prima dell'attivazione del webhook hanno il popup vuoto finche' non arriva il
//    prossimo evento. Si riempiono quelle SENZA cronologia: si esaurisce da sola.
//
// 2) FONTE DELLO STATO (contratti 'poste', i Poste DIRETTI come "SDA EXPRESS L"): qui non c'e' niente
//    da bonificare, e' l'unica fonte che abbiamo. Il tracking del fornitore risponde `outcome: OK` e
//    trova la LDV, ma torna `tracking: []` SEMPRE. Queste si RILEGGONO a rotazione, perche' il pacco
//    deve poter avanzare fino a "consegnata".

// La frase Poste -> stato la decide mappaStatoPoste (lib/tracking-poste.ts): qui c'era una copia
// quasi identica ma piu' povera, e le due si erano gia' allontanate (le mancavano 'arrivata',
// 'partita', 'smistamento'). La regola del reso e' blindata li' dentro, una volta sola per tutte le porte.

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const admin = createAdminSupabase()

  // DUE FAMIGLIE DI CONTRATTI, ENTRAMBE CON LDV CHE SONO CODICI POSTE.
  //  - 'spedisci': la bonifica storica descritta sopra, che si esaurisce da sé.
  //  - 'poste' (Poste DIRETTI, es. "SDA EXPRESS L"): qui non è una bonifica, è LA fonte. Il tracking
  //    del fornitore risponde `OK` ma con la lista eventi SEMPRE VUOTA — provato il 6/10/2026 con
  //    tutte le varianti dei parametri su un pacco che poste.it dava "in transito". Risultato: 6.249
  //    spedizioni SDA EXPRESS L con ZERO eventi e lo stato fermo a 'in_lavorazione'/'spedita', e con
  //    loro tutta la catena sotto (i rivenditori chiedono al venditore, che non sa niente).
  const { data: corr } = await admin.from('corrieri').select('id,tipo').in('tipo', ['spedisci', 'poste'])
  const idsSpedisci = (corr || []).filter((c: any) => c.tipo === 'spedisci').map((c: any) => c.id)
  const idsPosteDiretti = (corr || []).filter((c: any) => c.tipo === 'poste').map((c: any) => c.id)
  const corrIds = [...idsSpedisci, ...idsPosteDiretti]
  if (!corrIds.length) return NextResponse.json({ ok: true, fatte: 0 })

  // Candidate. Includo ANCHE gli 'in_lavorazione' VECCHI: quando il webhook Spedisci non consegna
  // (verificato su amas: ~45% degli eventi non arriva), la spedizione resta ferma su 'in_lavorazione'
  // anche se il corriere l'ha presa in carico da giorni → Poste la conosce e ce la racconta. Gli
  // 'in_lavorazione' FRESCHI (< 2 giorni) li salto: quelli Poste non li ha ancora, sprecherebbero quota.
  const ATTIVI = ['in_lavorazione', 'spedita', 'in_transito', 'in_consegna', 'non_consegnato', 'in_giacenza']
  const dueGiorniFa = Date.now() - 2 * 86400000
  const seiOreFa = Date.now() - 6 * 3600000

  const { data: cand } = idsSpedisci.length
    ? await admin.from('spedizioni')
      .select('id,numero,tracking_number,stato,created_at')
      .in('corriere_id', idsSpedisci).in('stato', ATTIVI)
      .order('created_at', { ascending: true }).limit(600)
    : { data: [] as any[] }

  // SPEDISCI: solo quelle SENZA cronologia (è una bonifica: finita, non fa più nulla).
  const { data: gia } = cand?.length
    ? await admin.from('tracking_events').select('spedizione_id').in('spedizione_id', cand.map((c: any) => c.id))
    : { data: [] as any[] }
  const conEventi = new Set((gia || []).map((g: any) => g.spedizione_id))
  // Priorita' agli stati piu' avanzati (in consegna prima di spedita): sono i piu' guardati dai clienti
  const listaSpedisci = (cand || []).filter((c: any) => !conEventi.has(c.id))
    .filter((c: any) => !(c.stato === 'in_lavorazione' && new Date(c.created_at).getTime() > dueGiorniFa))
    .sort((a: any, b: any) => prioritaStato(b.stato) - prioritaStato(a.stato))
    .slice(0, 20)

  // POSTE DIRETTI: qui si RILEGGE, perché è la fonte dello stato e il pacco deve poter avanzare fino
  // a "consegnata". Rotazione sul meno letto di recente (`tracking_check_at`, che si riscrive sotto).
  // La dose: 40 per giro × 4 giri l'ora = ~3.800 letture al giorno. Il freno resta: una ogni 1,2s e
  // stop dopo 6 risposte non-ok di fila (se Poste chiude il rubinetto si riprende al giro dopo).
  // LA DOSE VA DOVE I MOVIMENTI CI SONO. Campionato il 6/10/2026 appena acceso questo ramo: sulle
  // 'spedita' (consegnate al corriere) poste.it ha movimenti in 1 caso su 3; sulle 'in_lavorazione'
  // 0 su 6 — sono etichette emesse e non ancora scansionate, e su questo contratto sono la grande
  // maggioranza (1.772 contro 303). Mescolandole in un'unica rotazione la quota finiva quasi tutta su
  // LDV che Poste non conosce: 5 giri avevano riempito solo 15 cronologie. Quindi due secchielli:
  // 30 per giro a chi e' in viaggio (e deve ancora arrivare a "consegnata"), 10 a chi e' ferma in
  // lavorazione — che cosi' non resta esclusa, perche' qualcuna viene scansionata piu' tardi.
  const PRESE_IN_CARICO = ['spedita', 'in_transito', 'in_consegna', 'non_consegnato', 'in_giacenza']
  const pescaPoste = async (stati: string[], quante: number, nonPrimaDi?: number) => {
    if (!idsPosteDiretti.length) return [] as any[]
    const { data } = await admin.from('spedizioni')
      .select('id,numero,tracking_number,stato,created_at')
      .in('corriere_id', idsPosteDiretti).in('stato', stati)
      .order('tracking_check_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true }).limit(quante * 4)
    return (data || [])
      .filter((c: any) => !nonPrimaDi || new Date(c.created_at).getTime() < nonPrimaDi)
      .slice(0, quante)
  }
  const listaPoste = [
    ...await pescaPoste(PRESE_IN_CARICO, 30),
    // Gli 'in_lavorazione' appena creati si saltano (< 6 ore): Poste non li ha ancora e sprecano quota.
    ...await pescaPoste(['in_lavorazione'], 10, seiOreFa),
  ]

  const lista = [...listaPoste, ...listaSpedisci]
  const rileggere = new Set(listaPoste.map((s: any) => s.id))
  if (!lista.length) return NextResponse.json({ ok: true, fatte: 0, messaggio: 'niente da leggere' })

  let cronologie = 0, stati = 0, vuote = 0, bloccati = 0
  for (const sp of lista) {
    try {
      // La chiamata e la traduzione delle frasi stanno in lib/tracking-poste (un posto solo: le usa
      // anche il backfill OneTracking, e due copie si erano gia' allontanate una volta).
      const { ok, eventi } = await leggiTrackingPostePubblico(String(sp.tracking_number || sp.numero))
      // Timbro la lettura PRIMA di valutare l'esito, se no una LDV che Poste non conosce ancora
      // resterebbe in testa alla rotazione e si mangerebbe la quota a ogni giro.
      if (rileggere.has(sp.id)) await admin.from('spedizioni').update({ tracking_check_at: new Date().toISOString() }).eq('id', sp.id)
      if (!ok) { bloccati++; if (bloccati >= 6) break; continue }   // 400 in serie = Poste ci ha chiuso: stop, riprova al giro dopo
      bloccati = 0
      // Lista vuota = Poste non ha ancora movimenti per quella LDV. Per i POSTE DIRETTI e' normale
      // (pacco creato ma non ancora scansionato) e NON e' un segnale di blocco: si riprova dopo.
      if (!eventi.length) { vuote++; continue }
      // Si AGGIUNGE quello che manca, non si riscrive (vedi lib/tracking-eventi): una lettura piu'
      // povera cancellava descrizioni gia' scritte. I doppioni li ferma la chiave unica del database.
      await admin.from('tracking_events').upsert(
        eventi.map((e: any) => ({ spedizione_id: sp.id, ...e, luogo: e.luogo ?? '' })),
        { onConflict: 'spedizione_id,data_evento,descrizione,luogo', ignoreDuplicates: true },
      )
      cronologie++
      // Regole di sempre (solo avanti, terminali intoccabili, reso appiccicoso) e MAI in giacenza.
      // Qui, se poste.it diceva giacenza, si datava giacenza_data: il database la metteva in coda di
      // addebito e il cliente riceveva l'avviso, su un pacco che il fornitore non aveva in giacenza.
      // La giacenza la apre solo il fornitore (vedi statoDaLetturaPoste).
      const nuovo = statoDaLetturaPoste(eventi, sp.stato)
      if (nuovo && nuovo !== sp.stato) {
        await admin.from('spedizioni').update({ stato: nuovo }).eq('id', sp.id)
        stati++
        // Il cambio stato dei contratti Poste (via Spedisci) lo scrive QUI: qui va anche avvisato il
        // cliente, come fa la cron aggiorna per i fornitori diretti (prima non partiva → Edit Shop 23/9).
        await notificaCambioStato(admin, sp.id, nuovo, sp.stato)
      }
    } catch { /* singola LDV: pazienza, riprova al giro dopo */ }
    await new Promise(res => setTimeout(res, 1200))
  }
  console.log(`[BONIFICA-POSTE] cronologie=${cronologie} stati=${stati} senza_movimenti=${vuote} bloccati=${bloccati}`
    + ` candidate=${lista.length} (poste_diretti=${listaPoste.length} spedisci=${listaSpedisci.length})`)
  return NextResponse.json({ ok: true, fatte: cronologie, stati, vuote, bloccati, poste_diretti: listaPoste.length, spedisci: listaSpedisci.length })
}
