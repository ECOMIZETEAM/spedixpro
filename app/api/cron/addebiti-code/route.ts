import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CODE DEGLI ADDEBITI: aperture giacenza e resi.
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
      .select('spedizione_id, tentativi, spedizioni(id,numero,cliente_id,master_id,corriere_id,giacenza_apertura_addebitata)')
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

  const durataSec = Math.round((Date.now() - avvioMs) / 1000)
  console.log(`[ADDEBITI][CODE] giacenze=${giacenzeAddebitate} resi=${resiAddebitati} durata=${durataSec}s`)
  return NextResponse.json({ ok: true, giacenzeAddebitate, resiAddebitati, durataSec })
}
