import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CODE DEGLI ADDEBITI: aperture giacenza e resi, piu' i rimborsi delle spedizioni annullate.
//
// Stavano in fondo al cron del tracking, che ha 300 secondi e se li prende quasi tutti: gli addebiti
// vivevano degli avanzi. Misurato il 18/09/2026, dopo l'apertura in blocco di 110 giacenze: il giro
// delle 11:00 ne ha elaborate 47 e quello delle 11:30 44, entrambi fermati a meta' coda dal tempo, e i
// resi in coda (che venivano DOPO le giacenze) non sono stati toccati. Nessun addebito perso — la coda
// resta — ma in un giorno pesante i soldi aspettavano il tracking.
//
// Ora sono due squadre separate, ognuna col suo tempo: il tracking legge i corrieri e apre le
// giacenze (il trigger le mette in coda), questo giro addebita. Il codice degli addebiti e' quello di
// prima, SPOSTATO e non riscritto: stessi importi, stesse regole.
//
// UN SOLO CONSUMATORE, di proposito. addebitaAperturaGiacenza guarda il flag
// giacenza_apertura_addebitata letto insieme alla coda: due processi sulla stessa riga nello stesso
// istante addebiterebbero due volte. Per questo il blocco nel tracking e' stato ELIMINATO, non lasciato
// accanto; e questo giro (ogni 10 minuti, al massimo 300 secondi) non si sovrappone mai a se stesso.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const avvioMs = Date.now()
  // TEMPO DIVISO: le giacenze smettono di prendere righe nuove a 200 secondi, i resi a 270. Cosi' i
  // resi hanno sempre almeno ~70 secondi e un arrivo in blocco di giacenze non li lascia indietro.
  // La riga in corso si finisce sempre; il resto resta in coda per il giro dopo, fra dieci minuti.
  const oltre = (sec: number) => Date.now() - avvioMs > sec * 1000

  // ── APERTURE GIACENZA DA ADDEBITARE ──
  // La coda la riempie il database da solo, con un trigger, appena una spedizione entra in
  // giacenza: cosi' nessuna strada d'ingresso puo' saltare l'addebito, nemmeno una che nascera'
  // domani. Qui si svuota: il prezzo lo sa l'applicazione, la regola la tiene il database.
  let giacenzeAddebitate = 0
  try {
    const { data: coda } = await admin.from('giacenze_da_addebitare')
      .select('spedizione_id, tentativi, spedizioni(id,numero,cliente_id,master_id,corriere_id,tracking_number,giacenza_apertura_addebitata)')
      .lt('tentativi', 5).limit(200)
    if (coda?.length) {
      const { addebitaAperturaGiacenza } = await import('@/lib/giacenza-cascata')
      for (const riga of coda) {
        if (oltre(200)) break
        const sp: any = (riga as any).spedizioni
        if (!sp) { await admin.from('giacenze_da_addebitare').delete().eq('spedizione_id', (riga as any).spedizione_id); continue }
        try {
          await addebitaAperturaGiacenza(sp)
          // Si toglie dalla coda solo se e' andata: un errore la lascia li' per il giro dopo, con
          // il conto dei tentativi che cresce — dopo cinque smette di riprovare e resta a vista.
          await admin.from('giacenze_da_addebitare').delete().eq('spedizione_id', sp.id)
          giacenzeAddebitate++
        } catch (e: any) {
          console.error('[GIACENZA][APERTURA] addebito non riuscito', sp.numero, e?.message)
          await admin.from('giacenze_da_addebitare')
            .update({ tentativi: ((riga as any).tentativi || 0) + 1, ultimo_errore: String(e?.message || e).slice(0, 300) })
            .eq('spedizione_id', sp.id)
        }
      }
    }
  } catch (e: any) { console.error('[GIACENZA][APERTURA] coda non svuotata:', e?.message) }

  // ── RESI DA ADDEBITARE ──
  // Stessa idea delle giacenze: la coda la riempie il database con un trigger appena una
  // spedizione passa a "reso al mittente", da qualunque strada. Qui si lavora, riusando lo stesso
  // calcolo dello svincolo giacenza — non una copia. Se il reso e' gia' stato pagato da un'altra
  // strada la funzione del database risponde "gia_addebitato" e non si paga due volte: vince il
  // primo dei due momenti che arriva.
  let resiAddebitati = 0
  try {
    const { data: coda } = await admin.from('resi_da_addebitare')
      .select('spedizione_id, tentativi').lt('tentativi', 5).limit(100)
    if (coda?.length) {
      const { addebitaResoDaTracking } = await import('@/lib/giacenza-cascata')
      for (const riga of coda) {
        if (oltre(270)) break
        const spId = (riga as any).spedizione_id
        try {
          const esito = await addebitaResoDaTracking(admin, spId)
          if (esito.addebitato) {
            // Si toglie dalla coda SOLO se qualcuno ha davvero pagato (o era gia' pagato: qualcun
            // altro ha fatto il lavoro, risultato voluto).
            await admin.from('resi_da_addebitare').delete().eq('spedizione_id', spId)
            resiAddebitati++
          } else {
            // addebitato:false NON e' un successo. addebitaResoGiacenza INGOIA l'errore della RPC e
            // torna false: cancellare qui perdeva il reso in silenzio per sempre (lo stato e' gia'
            // reso_mittente, il trigger non lo rimette piu' in coda). Lo si lascia con tentativi++ per
            // ritentare; dopo 5 resta a vista con l'errore, non sparisce.
            await admin.from('resi_da_addebitare')
              .update({ tentativi: ((riga as any).tentativi || 0) + 1, ultimo_errore: 'addebito non passato (nessun movimento scritto)' })
              .eq('spedizione_id', spId)
          }
        } catch (e: any) {
          console.error('[RESO][ADDEBITO] non riuscito', spId, e?.message)
          await admin.from('resi_da_addebitare')
            .update({ tentativi: ((riga as any).tentativi || 0) + 1, ultimo_errore: String(e?.message || e).slice(0, 300) })
            .eq('spedizione_id', spId)
        }
      }
    }
  } catch (e: any) { console.error('[RESO][ADDEBITO] coda non svuotata:', e?.message) }

  // ── ANNULLI DA RIMBORSARE ──
  // La coda la riempie il database (trg_annullo_da_rimborsare) appena una spedizione passa ad
  // 'annullata', da qualunque strada. Il dettaglio del tracking e l'API /v1/tracking la scrivevano
  // quando il fornitore la dava annullata, senza rimborsare: 5 spedizioni da giugno, 143,85 EUR
  // (050228152996379 del 4/11/2026: 22,70 al cliente, e la catena addebitata).
  // Si rimborsa in automatico SOLO chi non ha nessun rimborso. Le altre porte rimborsano da sole subito
  // dopo lo stato, e ripassarle di qui farebbe danni: sulle gambe LOGIXIA del 3-5/10 il rimborso e' stato
  // fatto a un importo diverso e poi corretto, e l'abbinamento per importo, non trovando la coppia,
  // rimborserebbe una seconda volta. Si aspetta mezz'ora perche' la porta che ha appena annullato finisca
  // di scrivere. Quello che non si decide da soli (rimborsata a meta' da chi l'ha annullata, oppure
  // risulta partita) resta in coda a vista con il motivo: tentativi=5, lo legge il controllo dei log.
  let annulliRimborsati = 0
  try {
    const { STATI_PARTITA } = await import('@/lib/annullo-poste')
    const adesso = Date.now()
    const { data: coda, error: errCoda } = await admin.from('annulli_da_rimborsare')
      .select('spedizione_id, tentativi, avviato_il')
      .lt('tentativi', 5).lte('creato_il', new Date(adesso - 30 * 60 * 1000).toISOString()).limit(100)
    // Senza questo log una coda illeggibile (tabella assente, permesso, relazione) non farebbe niente in silenzio.
    if (errCoda) console.error('[ANNULLO][RIMBORSO DA CODA] coda non leggibile:', errCoda.message)
    if (coda?.length) {
      const { rimborsaAnnulloSpedizione } = await import('@/lib/annullaSpedizione')
      // Soggetti (cliente, o master col suo conto) non ancora a zero su spedizione+rettifica+rimborso:
      // e' l'invariante "annullata netta 0" del guardiano. Vuoto = tutti rimborsati.
      const aperti = (mv: any[]) => {
        const netti = new Map<string, number>()
        for (const m of mv) {
          if (!['spedizione', 'rettifica', 'rimborso'].includes(m.tipo) || (!m.cliente_id && !m.master_target_id)) continue
          const k = `${m.cliente_id || ''}|${m.master_id || ''}|${m.master_target_id || ''}`
          netti.set(k, (netti.get(k) || 0) + Number(m.importo || 0))
        }
        return [...netti.values()].filter((v) => Math.abs(v) >= 0.005)
      }
      for (const riga of coda) {
        if (oltre(285)) break
        const spId = (riga as any).spedizione_id
        const nostro = !!(riga as any).avviato_il   // un nostro tentativo precedente, rimasto a meta'
        const togli = () => admin.from('annulli_da_rimborsare').delete().eq('spedizione_id', spId)
        const aVista = (motivo: string) => admin.from('annulli_da_rimborsare')
          .update({ tentativi: 5, ultimo_errore: motivo.slice(0, 300) }).eq('spedizione_id', spId)
        let numero = spId
        try {
          // PRESA IN CARICO: un solo giro per riga. Due giri sovrapposti (lancio a mano, cron consegnato due
          // volte) leggerebbero entrambi "nessun rimborso" e rimborserebbero due volte. Un tentativo
          // rimasto appeso da piu' di 10 minuti si puo' riprendere.
          const { data: presa, error: errPresa } = await admin.from('annulli_da_rimborsare')
            .update({ avviato_il: new Date().toISOString() }).eq('spedizione_id', spId).lt('tentativi', 5)
            .or(`avviato_il.is.null,avviato_il.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`)
            .select('spedizione_id')
          if (errPresa) throw new Error(errPresa.message)
          if (!presa?.length) continue
          // Stato e movimenti si leggono DOPO la presa: quelli letti a inizio giro possono essere vecchi
          // di minuti (es. la sorveglianza SDA EXPRESS L che nel frattempo l'ha riportata in viaggio).
          const { data: sp } = await admin.from('spedizioni').select('id,numero,dest_nome,stato').eq('id', spId).maybeSingle()
          // Ripristinata, o riportata al suo stato vero perche' partita: niente da rimborsare.
          if (!sp || (sp as any).stato !== 'annullata') { await togli(); continue }
          numero = (sp as any).numero
          const { data: mv, error: errMv } = await admin.from('movimenti')
            .select('tipo,importo,cliente_id,master_id,master_target_id,riferimento').eq('spedizione_id', spId)
          if (errMv) throw new Error(errMv.message)
          const prima = aperti(mv || [])
          if (!prima.length) { await togli(); continue }   // nessun addebito, o gia' tutti a zero
          if (!nostro && (mv || []).some((m: any) => m.tipo === 'rimborso')) {
            await aVista(`rimborsata solo in parte da chi l'ha annullata: ${prima.length} soggetti non a zero (${prima.reduce((a, b) => a + b, 0).toFixed(2)} EUR). Da controllare, non si rimborsa in automatico`)
            continue
          }
          // PACCO PARTITO: non si rimborsa alla cieca. Stessi segni di annulli-recupero-cron: un evento di
          // viaggio o una ripesatura del fornitore (misura presa sul collo vero).
          const ripesata = (mv || []).some((m: any) => m.tipo === 'rettifica' && String(m.riferimento || '').startsWith('RIPFORN-'))
          const { data: ev, error: errEv } = await admin.from('tracking_events').select('id')
            .eq('spedizione_id', spId).in('stato', STATI_PARTITA).limit(1)
          if (errEv) throw new Error(errEv.message)
          if (ripesata || ev?.length) {
            await aVista('annullata ma risulta partita (evento di viaggio o ripesatura del fornitore): non si rimborsa in automatico')
            continue
          }
          await rimborsaAnnulloSpedizione(admin, sp, null)
          // rimborsaAnnulloSpedizione INGOIA gli errori dei singoli movimenti: il successo si rilegge.
          const { data: mvDopo } = await admin.from('movimenti')
            .select('tipo,importo,cliente_id,master_id,master_target_id').eq('spedizione_id', spId)
          const dopo = aperti(mvDopo || [])
          if (!dopo.length) {
            await togli()
            annulliRimborsati++
            console.warn('[ANNULLO][RIMBORSO DA CODA] annullata senza rimborso, rimborsata:', numero)
          } else {
            await admin.from('annulli_da_rimborsare')
              .update({ tentativi: ((riga as any).tentativi || 0) + 1, ultimo_errore: `rimborso incompleto: ${dopo.length} soggetti non a zero` })
              .eq('spedizione_id', spId)
          }
        } catch (e: any) {
          console.error('[ANNULLO][RIMBORSO DA CODA] non riuscito', numero, e?.message)
          await admin.from('annulli_da_rimborsare')
            .update({ tentativi: ((riga as any).tentativi || 0) + 1, ultimo_errore: String(e?.message || e).slice(0, 300) })
            .eq('spedizione_id', spId)
        }
      }
    }
  } catch (e: any) { console.error('[ANNULLO][RIMBORSO DA CODA] coda non svuotata:', e?.message) }

  const durataSec = Math.round((Date.now() - avvioMs) / 1000)
  console.log(`[ADDEBITI][CODE] giacenze=${giacenzeAddebitate} resi=${resiAddebitati} annulli=${annulliRimborsati} durata=${durataSec}s`)
  return NextResponse.json({ ok: true, giacenzeAddebitate, resiAddebitati, annulliRimborsati, durataSec })
}
