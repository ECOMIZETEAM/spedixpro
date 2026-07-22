import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, spediamoproSearchStocks, mapStatoSpediamopro, spediamoproGetLabel, normalizzaEtichetta } from '@/lib/spediamopro'
import { prioritaStato } from '@/lib/spedisci'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (ogni 4h): aggiorna lo stato delle spedizioni ancora "attive" leggendo il tracking
// dai corrieri. SpediamoPro: mappa lo status 0-13; lo status 11 (eccezione) → controlla gli
// stock: se c'è uno stock attivo → in_giacenza, altrimenti non_consegnato.
export async function GET() {
  const admin = createAdminSupabase()

  // Escludo anche gli stati di annullamento: il tracking NON deve sovrascrivere una spedizione
  // in attesa di annullo (altrimenti perde 'annullamento_pending' e il cron annulli non la trova).
  // Copro TUTTE le spedizioni attive per giro (ordinate dalle meno aggiornate): con limit basso
  // (era 300) e molte spedizioni attive, quelle "in coda" — comprese le nuove GIACENZE — non
  // venivano mai raggiunte e non comparivano nella sezione Giacenze. Un giro da 300 impiega ~12s,
  // quindi c'è ampio margine sotto maxDuration. NB: a volumi molto alti va spezzato in batch
  // con un campo "ultimo_check_tracking" (round-robin) — vedi TODO cron tracking scalabile.
  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,numero,stato,raw_response,tracking_number,etichetta_url,giacenza_data,giacenza_apertura_addebitata,giacenza_addebito_effettuato,cliente_id,master_id,corriere_id,corrieri(tipo,credenziali)')
    .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
    .order('updated_at', { ascending: true })
    .limit(3000)

  let aggiornate = 0, errori = 0
  const lavora = async (s: any) => {
    const corr: any = (s as any).corrieri
    const tipo = corr?.tipo
    const cred: any = corr?.credenziali || {}

    try {
      let nuovo: string | null = null
      let nuovoTracking: string | null = null
      // Contesto SpediamoPro per il recupero di numero/etichetta rimasti indietro (vedi sotto).
      let spAuth: string | null = null
      let spId: number | null = null
      let spCode: string | null = null

      if (tipo === 'spediamopro') {
        const raw: any = s.raw_response || {}
        const spid = raw.id || raw?.raw?.data?.id
        const authcode = cred?.authcode
        if (!spid || !authcode) return
        spAuth = authcode; spId = Number(spid); spCode = raw.code || null

        const tr = await spediamoproGetTracking(authcode, Number(spid))
        nuovo = mapStatoSpediamopro(tr.status)
        if (nuovo === 'eccezione') {
          // distinguo giacenza (stock attivo) da altre eccezioni
          try {
            const stocks = await spediamoproSearchStocks(authcode, tr.shipmentCode || raw.code || String(spid))
            const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && Number(st.shipmentId) === Number(spid))
            nuovo = attivo ? 'in_giacenza' : 'non_consegnato'
          } catch { nuovo = 'non_consegnato' }
        }
        if (tr.trackingCode) nuovoTracking = tr.trackingCode

      } else {
        // Spedisci: il POLLING è stato CHIUSO dal provider (403 "For tracking please use the
        // Webhooks events") → lo stato arriva in tempo reale dal webhook, qui non chiamiamo nulla.
        return
      }

      const upd: any = {}
      // Lo stato avanza SOLO IN AVANTI ('annullata' sempre applicata): il corriere può essere
      // "indietro" rispetto a noi (es. 'spedita' dopo la distinta mentre lui dice ancora
      // "in lavorazione") e NON deve declassare. Era la causa dei badge che regredivano.
      if (nuovo && nuovo !== s.stato && (nuovo === 'annullata' || prioritaStato(nuovo) > prioritaStato(s.stato))) upd.stato = nuovo
      if (nuovo === 'in_giacenza' && !s.giacenza_data) upd.giacenza_data = new Date().toISOString()
      if (nuovoTracking && nuovoTracking !== s.tracking_number) upd.tracking_number = nuovoTracking

      // RECUPERO NUMERO: alla creazione, se SpediamoPro/BRT non aveva ancora assegnato il tracking, il
      // numero è rimasto il codice interno (es. "6A5E..." o "SP-<id>"). Ora che il tracking reale c'è,
      // correggo il numero mostrato (così in elenco appare la LDV vera, non il codice interno).
      if (nuovoTracking && nuovoTracking !== s.numero && (s.numero === spCode || String(s.numero || '').startsWith('SP-'))) {
        upd.numero = nuovoTracking
      }

      // RECUPERO ETICHETTA: se l'etichetta non è mai stata salvata (il completamento in background prova
      // solo ~20s, ma BRT Express a volte genera dopo minuti/ore) e ora c'è un tracking → la scarico UNA
      // volta e la salvo. Così il download è immediato e non dipende più dal fallback on-demand.
      if (tipo === 'spediamopro' && !(s as any).etichetta_url && spAuth && spId && (nuovoTracking || s.tracking_number)) {
        try {
          const lb = await spediamoproGetLabel(spAuth, spId, 1, 0)
          const norm = await normalizzaEtichetta(lb)
          upd.etichetta_url = `data:${norm.mime};base64,${norm.buffer.toString('base64')}`
        } catch { /* non ancora pronta: riprovo al giro dopo */ }
      }

      if (Object.keys(upd).length) {
        await admin.from('spedizioni').update(upd).eq('id', s.id)
        aggiornate++
      }

      // ENTRATA in giacenza -> il cliente paga SUBITO l'apertura dossier (+ cascata rete), una volta.
      // Il servizio (riconsegna/reso) sarà addebitato allo svincolo. Best-effort: non blocca il cron.
      if (nuovo === 'in_giacenza' && !(s as any).giacenza_apertura_addebitata && !(s as any).giacenza_addebito_effettuato) {
        try {
          const { addebitaAperturaGiacenza } = await import('@/lib/giacenza-cascata')
          await addebitaAperturaGiacenza({
            id: s.id, numero: (s as any).numero, cliente_id: (s as any).cliente_id,
            master_id: (s as any).master_id, corriere_id: s.corriere_id,
            giacenza_apertura_addebitata: (s as any).giacenza_apertura_addebitata,
          })
        } catch (e) { console.error('Errore addebito apertura giacenza:', e) }
      }
    } catch { errori++ }
  }

  // Batch PARALLELI (8 alla volta): con migliaia di attive il giro sequenziale non stava nel
  // maxDuration; così si coprono TUTTE le attive a ogni giro (aggiornamenti tempestivi).
  const lista = spedizioni || []
  const BATCH = 8
  for (let i = 0; i < lista.length; i += BATCH) {
    await Promise.all(lista.slice(i, i + BATCH).map(lavora))
  }

  return NextResponse.json({ ok: true, esaminate: lista.length, aggiornate, errori })
}
