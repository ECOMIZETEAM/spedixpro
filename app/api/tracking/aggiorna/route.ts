import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, spediamoproSearchStocks, mapStatoSpediamopro } from '@/lib/spediamopro'
import { spedisciTrackingStati, mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'

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
    .select('id,numero,stato,raw_response,tracking_number,giacenza_data,giacenza_apertura_addebitata,giacenza_addebito_effettuato,cliente_id,master_id,corriere_id,corrieri(tipo,credenziali)')
    .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
    .order('updated_at', { ascending: true })
    .limit(1000)

  let aggiornate = 0, errori = 0
  for (const s of (spedizioni || [])) {
    const corr: any = (s as any).corrieri
    const tipo = corr?.tipo
    const cred: any = corr?.credenziali || {}

    try {
      let nuovo: string | null = null
      let nuovoTracking: string | null = null

      if (tipo === 'spediamopro') {
        const raw: any = s.raw_response || {}
        const spid = raw.id || raw?.raw?.data?.id
        const authcode = cred?.authcode
        if (!spid || !authcode) continue

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

      } else if (tipo === 'spedisci') {
        if (!s.tracking_number || !cred?.master_domain || !cred?.password) continue
        // Polling: nessuna configurazione richiesta lato Spedisci (il webhook resta un bonus real-time).
        const { stati } = await spedisciTrackingStati(cred, s.tracking_number)
        // mappo tutti gli eventi e scelgo lo stato "più avanzato" (ordine non garantito)
        for (const str of stati) {
          const m = mapStatoSpedisci(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }

      } else {
        continue
      }

      const upd: any = {}
      if (nuovo && nuovo !== s.stato) upd.stato = nuovo
      if (nuovo === 'in_giacenza' && !s.giacenza_data) upd.giacenza_data = new Date().toISOString()
      if (nuovoTracking && nuovoTracking !== s.tracking_number) upd.tracking_number = nuovoTracking

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

  return NextResponse.json({ ok: true, esaminate: spedizioni?.length || 0, aggiornate, errori })
}
