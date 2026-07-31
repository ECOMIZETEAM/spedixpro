import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { spediamoproGetTracking, spediamoproSearchStocks, mapStatoSpediamopro, spediamoproGetLabel, normalizzaEtichetta } from '@/lib/spediamopro'
import { spedisciTrackingStati, mapStatoSpedisci, prioritaStato } from '@/lib/spedisci'
import { inviaWebhook } from '@/lib/webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (ogni 4h): aggiorna lo stato delle spedizioni ancora "attive" leggendo il tracking
// dai corrieri. SpediamoPro: mappa lo status 0-13; lo status 11 (eccezione) → controlla gli
// stock: se c'è uno stock attivo → in_giacenza, altrimenti non_consegnato.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  // Escludo anche gli stati di annullamento: il tracking NON deve sovrascrivere una spedizione
  // in attesa di annullo (altrimenti perde 'annullamento_pending' e il cron annulli non la trova).
  // Copro TUTTE le spedizioni attive per giro (ordinate dalle meno aggiornate): con limit basso
  // (era 300) e molte spedizioni attive, quelle "in coda" — comprese le nuove GIACENZE — non
  // venivano mai raggiunte e non comparivano nella sezione Giacenze. Un giro da 300 impiega ~12s,
  // quindi c'è ampio margine sotto maxDuration. NB: a volumi molto alti va spezzato in batch
  // con un campo "ultimo_check_tracking" (round-robin) — vedi TODO cron tracking scalabile.
  // A PAGINE: PostgREST tronca ogni risposta a 1000 righe (il vecchio .limit(3000) era
  // silenziosamente tagliato -> ogni giro copriva solo le prime 1000 attive). Carico tutte
  // le pagine PRIMA di processare, con dedup per id (le pagine possono slittare se qualche
  // riga cambia stato nel frattempo).
  const vistiIds = new Set<string>()
  const spedizioni: any[] = []
  for (let pag = 0; pag < 8; pag++) {
    const { data: pagina } = await admin.from('spedizioni')
      // MAI 'raw_response' né 'etichetta_url' interi: l'etichetta è il PDF in base64 (156 KB in
      // media) e la risposta del corriere ~43 KB. Su 8.000 righe superavano il gigabyte e la
      // funzione veniva UCCISA per memoria esaurita (4 volte nelle ultime 24h): il giro moriva
      // a metà e il tracking restava indietro per tutti. Qui servono solo tre valori, presi
      // direttamente dal JSON, e l'etichetta si guarda a parte (solo gli id di chi non ce l'ha).
      // ep_offerta/ep_ordine: i due riferimenti del terzo provider. Il tracking si interroga col
      // CODICE OFFERTA (per LDV risponde "Spedizione non trovata"), l'etichetta con l'id ordine.
      .select('id,numero,stato,tracking_number,giacenza_data,giacenza_motivo,giacenza_apertura_addebitata,giacenza_addebito_effettuato,cliente_id,master_id,corriere_id,corrieri(tipo,credenziali,nome_contratto),sp_id:raw_response->id,sp_id_annidato:raw_response->raw->data->id,sp_code:raw_response->code,ep_offerta:raw_response->_codiceOfferta,ep_ordine:raw_response->_idOrdine')
      .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
      .order('tracking_check_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(pag * 1000, pag * 1000 + 999)
    for (const r of pagina || []) { if (!vistiIds.has(r.id)) { vistiIds.add(r.id); spedizioni.push(r) } }
    if (!pagina || pagina.length < 1000) break
  }

  // Chi non ha l'etichetta: SOLO gli id, così sappiamo per quali tentare il recupero senza
  // portarci in memoria i PDF di tutte le altre.
  const senzaEtichetta = new Set<string>()
  for (let pag = 0; pag < 8; pag++) {
    const { data: pagina } = await admin.from('spedizioni')
      .select('id').is('etichetta_url', null)
      .not('stato', 'in', '(consegnata,annullata,annullamento_pending,annullamento_manuale)')
      .order('id', { ascending: true })
      .range(pag * 1000, pag * 1000 + 999)
    for (const r of pagina || []) senzaEtichetta.add((r as any).id)
    if (!pagina || pagina.length < 1000) break
  }

  let aggiornate = 0, errori = 0
  let spedisciBloccato = false   // breaker: al primo 403 di policy niente altre chiamate Spedisci nel giro
  const lavora = async (s: any) => {
    const corr: any = (s as any).corrieri
    const tipo = corr?.tipo
    const cred: any = corr?.credenziali || {}

    try {
      let nuovo: string | null = null
      let nuovoTracking: string | null = null
      let motivoGiacenza: string | null = null   // causale del corriere (rifiuto, assente, indirizzo errato…)
      // Contesto SpediamoPro per il recupero di numero/etichetta rimasti indietro (vedi sotto).
      let spAuth: string | null = null
      let spId: number | null = null
      let spCode: string | null = null

      if (tipo === 'spediamopro') {
        // Valori presi dalle sole chiavi che servono (vedi select sopra), non dall'intero JSON.
        const spid = (s as any).sp_id ?? (s as any).sp_id_annidato
        const authcode = cred?.authcode
        if (!spid || !authcode) return
        spAuth = authcode; spId = Number(spid); spCode = (s as any).sp_code || null

        const tr = await spediamoproGetTracking(authcode, Number(spid))
        nuovo = mapStatoSpediamopro(tr.status)
        if (nuovo === 'eccezione') {
          // distinguo giacenza (stock attivo) da altre eccezioni
          try {
            const stocks = await spediamoproSearchStocks(authcode, tr.shipmentCode || (s as any).sp_code || String(spid))
            const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && Number(st.shipmentId) === Number(spid))
            nuovo = attivo ? 'in_giacenza' : 'non_consegnato'
            // MOTIVO dichiarato dal corriere (es. "Rifiuto del destinatario"): serve all'operatore
            // per scegliere lo svincolo GIUSTO — su un pacco rifiutato la riconsegna viene respinta
            // dal corriere, l'unica strada e' il reso al mittente.
            if (attivo?.reason) motivoGiacenza = String(attivo.reason).slice(0, 200)
          } catch { nuovo = 'non_consegnato' }
        }
        if (tr.trackingCode) nuovoTracking = tr.trackingCode

      } else if (tipo === 'spedisci') {
        // Il provider ha CHIUSO il polling (403 "use the Webhooks events"): il WEBHOOK resta la
        // fonte primaria. Qui TENTIAMO comunque a ogni giro: se il blocco viene rimosso, il polling
        // riparte DA SOLO (ogni 30 min); al primo 403 di policy fermiamo il resto del giro
        // (zero chiamate sprecate). Lo stato avanza SOLO in avanti come per SpediamoPro.
        if (spedisciBloccato) return
        if (!s.tracking_number || !cred?.master_domain || !cred?.password) return
        const { stati, raw, ok } = await spedisciTrackingStati(cred, s.tracking_number)
        if (!ok) { if (JSON.stringify(raw || {}).includes('Webhooks events')) spedisciBloccato = true; return }
        for (const str of stati) {
          const m = mapStatoSpedisci(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }

      } else if (tipo === 'easyparcel') {
        // Si interroga col CODICE OFFERTA, non con la LDV (verificato sul campo: la ricerca per
        // LDV risponde "Spedizione non trovata"). Senza quel riferimento non c'e' nulla da chiedere.
        const offerta = (s as any).ep_offerta
        if (!offerta || !cred?.apikey) return
        const { easyparcelTracking, mapStatoEasyparcel } = await import('@/lib/easyparcel')
        const { stati, raw } = await easyparcelTracking(cred.apikey, { codiceOfferta: String(offerta) })
        for (const str of stati) {
          const m = mapStatoEasyparcel(str)
          if (m && prioritaStato(m) > prioritaStato(nuovo)) nuovo = m
        }
        // La LDV compare nel tracking anche quando alla creazione non era ancora pronta: e' la
        // seconda occasione per rimpiazzare il numero provvisorio "DVA-<ordine>".
        const ldv = (raw as any)?.tracking?.lettera_vettura
        if (ldv) nuovoTracking = String(ldv)

      } else {
        return
      }

      const upd: any = {}
      // Lo stato avanza SOLO IN AVANTI ('annullata' sempre applicata): il corriere può essere
      // "indietro" rispetto a noi (es. 'spedita' dopo la distinta mentre lui dice ancora
      // "in lavorazione") e NON deve declassare. Era la causa dei badge che regredivano.
      // RESO APPICCICOSO: se e' 'reso_mittente', la 'consegnata' del corriere e' la consegna del
      // RITORNO al mittente -> NON e' una consegna al destinatario, lo stato resta reso.
      if (nuovo && nuovo !== s.stato && (nuovo === 'annullata' || prioritaStato(nuovo) > prioritaStato(s.stato))
          && !(s.stato === 'reso_mittente' && nuovo === 'consegnata')) upd.stato = nuovo
      if (nuovo === 'in_giacenza' && !s.giacenza_data) upd.giacenza_data = new Date().toISOString()
      if (motivoGiacenza && motivoGiacenza !== (s as any).giacenza_motivo) upd.giacenza_motivo = motivoGiacenza
      if (nuovoTracking && nuovoTracking !== s.tracking_number) upd.tracking_number = nuovoTracking

      // RECUPERO NUMERO: alla creazione, se SpediamoPro/BRT non aveva ancora assegnato il tracking, il
      // numero è rimasto il codice interno (es. "6A5E..." o "SP-<id>"). Ora che il tracking reale c'è,
      // correggo il numero mostrato (così in elenco appare la LDV vera, non il codice interno).
      // 'DVA-<ordine>' e' il numero provvisorio del terzo provider, assegnato quando la lettera di
      // vettura non era ancora pronta: va sostituito appena arriva quella vera, come per 'SP-'.
      if (nuovoTracking && nuovoTracking !== s.numero && (s.numero === spCode || /^(SP|DVA)-/.test(String(s.numero || '')))) {
        upd.numero = nuovoTracking
      }

      // RECUPERO ETICHETTA: se l'etichetta non è mai stata salvata (il completamento in background prova
      // solo ~20s, ma BRT Express a volte genera dopo minuti/ore) e ora c'è un tracking → la scarico UNA
      // volta e la salvo. Così il download è immediato e non dipende più dal fallback on-demand.
      if (tipo === 'spediamopro' && senzaEtichetta.has(s.id) && spAuth && spId && (nuovoTracking || s.tracking_number)) {
        try {
          const lb = await spediamoproGetLabel(spAuth, spId, 1, 0)
          const norm = await normalizzaEtichetta(lb)
          upd.etichetta_url = `data:${norm.mime};base64,${norm.buffer.toString('base64')}`
        } catch { /* non ancora pronta: riprovo al giro dopo */ }
      }
      // Stessa rete di sicurezza per il terzo provider: li' l'etichetta nasce da una chiamata a
      // parte (getwaybill) e alla creazione puo' non essere ancora disponibile.
      if (tipo === 'easyparcel' && senzaEtichetta.has(s.id) && (s as any).ep_ordine && cred?.apikey) {
        try {
          const { easyparcelWaybill } = await import('@/lib/easyparcel')
          const w = await easyparcelWaybill(cred.apikey, String((s as any).ep_ordine), 1, 0)
          const b64 = w.singole[0]?.pdfBase64 || w.pdfBase64
          if (b64) upd.etichetta_url = `data:application/pdf;base64,${b64}`
          if (w.numero && w.numero !== s.tracking_number) {
            upd.tracking_number = w.numero
            if (/^DVA-/.test(String(s.numero || ''))) upd.numero = w.numero
          }
        } catch { /* non ancora pronta: riprovo al giro dopo */ }
      }

      if (Object.keys(upd).length) {
        await admin.from('spedizioni').update(upd).eq('id', s.id)
        aggiornate++
      }

      // WEBHOOK AL CLIENTE quando lo stato CAMBIA DAVVERO.
      // Chi si integra puo' registrare tracking.updated / tracking.delivered /
      // tracking.exception, ma finora quelle notifiche partivano da un solo punto: la GET del
      // tracking, cioe' solo se era il cliente stesso a interrogarci. Il giro che aggiorna
      // davvero gli stati — questo — non ne mandava nessuna. Risultato: per sapere di una
      // consegna il cliente doveva fare polling su ogni spedizione, esattamente cio' che il
      // webhook serve a evitare. Best-effort: non blocca ne' fa fallire il giro.
      if (upd.stato && (s as any).cliente_id) {
        const evento = upd.stato === 'consegnata' ? 'tracking.delivered'
          : (upd.stato === 'in_giacenza' || upd.stato === 'non_consegnato' || upd.stato === 'reso_mittente') ? 'tracking.exception'
          : 'tracking.updated'
        inviaWebhook({
          clienteId: (s as any).cliente_id, corriereId: s.corriere_id, evento,
          data: {
            tracking_number: upd.tracking_number || s.tracking_number || (s as any).numero,
            carrier: (s as any).corrieri?.nome_contratto || null,
            status: upd.stato, location: '', events: [],
          },
        }).catch(() => {})
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

  // Batch PARALLELI (16 alla volta) + ROTAZIONE: dopo ogni batch marco tracking_check_at, così
  // chi è stato controllato va in fondo alla coda e il giro dopo parte da chi aspetta da più
  // tempo. Anche se il run viene ucciso dal timeout a metà, la rotazione resta EQUA: nessuna
  // spedizione può restare indietro per sempre (era il bug "si aggiorna solo al click").
  const lista = spedizioni
  const BATCH = 16
  const inizioMs = Date.now()
  for (let i = 0; i < lista.length; i += BATCH) {
    const gruppo = lista.slice(i, i + BATCH)
    await Promise.all(gruppo.map(lavora))
    try { await admin.from('spedizioni').update({ tracking_check_at: new Date().toISOString() }).in('id', gruppo.map((g: any) => g.id)) } catch {}
    // margine di sicurezza sotto il maxDuration (300s): meglio fermarsi puliti che essere uccisi
    if (Date.now() - inizioMs > 270000) break
  }

  console.log(`[TRACKING] esaminate=${lista.length} aggiornate=${aggiornate} errori=${errori} durata=${Math.round((Date.now() - inizioMs) / 1000)}s`)
  return NextResponse.json({ ok: true, esaminate: lista.length, aggiornate, errori, durataSec: Math.round((Date.now() - inizioMs) / 1000) })
}
