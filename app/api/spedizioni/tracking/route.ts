import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { spediamoproGetTracking, mapStatoSpediamopro, spediamoproEventiIndicanoReso } from '@/lib/spediamopro'
import { prioritaStato } from '@/lib/spedisci'
import { erroreTrackingPulito } from '@/lib/errore-corriere'
import { colliDaRaw } from '@/lib/colli-dettaglio'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const isCliente = utente.ruolo === 'cliente'
  // Master: vede il tracking di tutta la propria rete (sotto-albero). Cliente: solo le proprie.
  const masterIds = isCliente ? [utente.master_id] : await sottoAlberoMasterIds(admin, utente.master_id)

  let spedQuery = admin.from('spedizioni')
    .select('id,stato,tracking_number,corriere_id,numero,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_telefono,dest_email,raw_response,colli_dettaglio,mitt_nome,cliente_id,contenuto')
    .eq('id', spedizioneId).in('master_id', masterIds)
  if (isCliente) spedQuery = spedQuery.eq('cliente_id', utente.cliente_id)
  // Agente: solo tracking di un suo cliente.
  if (isAgente(utente as any)) spedQuery = spedQuery.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
  const { data: spedizione } = await spedQuery.single()
  if (!spedizione) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Aggiorna lo stato salvato dallo stato live del tracking (best-effort, non blocca la risposta).
  // Ritorna lo stato EFFETTIVO dopo l'allineamento: il frontend lo usa per aggiornare badge e riga
  // in elenco (prima il popup mostrava eventi live ma il badge restava quello vecchio della lista).
  let statoEffettivo: string = (spedizione as any).stato
  const persistiStato = async (nuovo: string | null) => {
    if (!nuovo || nuovo === 'eccezione' || nuovo === (spedizione as any).stato) return
    if ((spedizione as any).stato === 'consegnata' || (spedizione as any).stato === 'annullata') return
    // Reso appiccicoso: la 'consegnata' dopo un reso e' la consegna del ritorno al mittente.
    if ((spedizione as any).stato === 'reso_mittente' && nuovo === 'consegnata') return
    // SOLO IN AVANTI: il corriere può essere "indietro" rispetto a noi (es. 'spedita' dopo la
    // distinta mentre lui dice ancora "in lavorazione"): mai declassare lo stato.
    if (nuovo !== 'annullata' && prioritaStato(nuovo) <= prioritaStato((spedizione as any).stato)) return
    try { await admin.from('spedizioni').update({ stato: nuovo }).eq('id', spedizione.id); statoEffettivo = nuovo } catch {}
  }

  // Audit accesso PII (visualizzazione dati spedizione/destinatario) — best-effort
  try { const { registraAudit } = await import('@/lib/audit'); await registraAudit({ utenteId: user.id, ruolo: (utente as any)?.ruolo, azione: 'tracking_view', risorsa: spedizione.numero }) } catch {}
  const { data: cliente } = await admin.from('clienti').select('ragione_sociale').eq('id', spedizione.cliente_id).single()
  const { data: corriere } = await admin.from('corrieri').select('credenziali,tipo,nome_contratto').eq('id', spedizione.corriere_id).single()
  if (!corriere) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 404 })

  const cred = corriere.credenziali as Record<string,string>
  const base = {
    numero: spedizione.numero,
    tracking_number: spedizione.tracking_number,
    corriere: corriere.nome_contratto,
    cliente: cliente?.ragione_sociale || null,
    contenuto: spedizione.contenuto,
    mitt_nome: spedizione.mitt_nome,
    destinatario: {
      nome: spedizione.dest_nome,
      indirizzo: spedizione.dest_indirizzo,
      citta: spedizione.dest_citta,
      provincia: spedizione.dest_provincia,
      telefono: spedizione.dest_telefono,
      email: spedizione.dest_email,
    },
    // Multicollo senza colli_dettaglio salvato (SpediamoPro): ricostruisco dai parcels del raw,
    // così il tab "Colli" mostra i colli veri invece di "singolo collo".
    colli_dettaglio: (Array.isArray(spedizione.colli_dettaglio) && spedizione.colli_dettaglio.length)
      ? spedizione.colli_dettaglio
      : colliDaRaw(spedizione.raw_response),
  }

  try {
    // SpediamoPro: usa authcode + shipmentId (non master_domain). Eventi: {at, title, description}.
    if (corriere.tipo === 'spediamopro') {
      const raw: any = spedizione.raw_response || {}
      const spid = raw.id || raw?.raw?.data?.id
      const authcode = cred?.authcode
      if (!spid || !authcode) return NextResponse.json({ ...base, eventi: [], stato: statoEffettivo, error: 'Tracking non disponibile per questa spedizione' })
      const tr = await spediamoproGetTracking(authcode, Number(spid))
      // Reso al mittente: lo status numerico non lo distingue, lo dicono gli eventi. Se c'e', vince
      // (poi la guardia "reso appiccicoso" in persistiStato tiene reso anche sulla consegna di ritorno).
      let nuovoSp = mapStatoSpediamopro(tr.status)
      if (spediamoproEventiIndicanoReso(tr.events)) nuovoSp = 'reso_mittente'
      await persistiStato(nuovoSp)
      // RECUPERO NUMERO al volo: se il numero è ancora il codice interno SpediamoPro (raw.code) e ora
      // esiste il tracking reale del corriere, correggo subito (senza aspettare il giro del cron).
      if (tr.trackingCode && tr.trackingCode !== spedizione.numero && (spedizione.numero === raw.code || String(spedizione.numero || '').startsWith('SP-'))) {
        try { await admin.from('spedizioni').update({ numero: tr.trackingCode, tracking_number: tr.trackingCode }).eq('id', spedizione.id) } catch {}
        ;(base as any).numero = tr.trackingCode
        ;(base as any).tracking_number = tr.trackingCode
      }
      const eventi = (tr.events || []).map((e: any) => ({
        date: e.at || e.date || '',
        description: [e.title, e.description].filter(Boolean).join(' — ') || 'Evento',
        location: '',
      })).reverse()   // più recente in alto
      // Niente `raw`: era il payload di tracking del provider rimandato al browser senza che
      // nessuna schermata lo usasse (verificato: il popup legge solo eventi ed error).
      return NextResponse.json({ ...base, eventi, stato: statoEffettivo, status_code: 200 })
    }

    // CONTRATTI DVA: il tracking si chiede al momento, e si chiede col CODICE OFFERTA — la ricerca
    // per lettera di vettura risponde "Spedizione non trovata" (verificato sul campo). Qui non
    // esiste un webhook, quindi senza questo ramo il riquadro resterebbe sempre vuoto: cadrebbe
    // sulla lettura di tracking_events, che per questi contratti nessuno riempie mai.
    if (corriere.tipo === 'easyparcel') {
      const raw: any = spedizione.raw_response || {}
      const codiceOfferta = raw._codiceOfferta
      if (!codiceOfferta || !cred?.apikey) {
        return NextResponse.json({ ...base, eventi: [], stato: statoEffettivo, error: 'Tracking non ancora disponibile per questa spedizione' })
      }
      const { easyparcelTracking, mapStatoEasyparcel } = await import('@/lib/easyparcel')
      const { stati, raw: trRaw } = await easyparcelTracking(cred.apikey, { codiceOfferta: String(codiceOfferta) })
      let avanzato: string | null = null
      for (const s of stati) {
        const m = mapStatoEasyparcel(s)
        if (m && prioritaStato(m) > prioritaStato(avanzato)) avanzato = m
      }
      await persistiStato(avanzato)
      // La lettera di vettura puo' essere arrivata dopo la creazione: se il numero e' ancora
      // quello provvisorio, si corregge subito senza aspettare il giro automatico.
      const ldv = (trRaw as any)?.tracking?.lettera_vettura
      if (ldv && ldv !== spedizione.numero && /^(TMP|DVA)-/.test(String(spedizione.numero || ''))) {
        try { await admin.from('spedizioni').update({ numero: String(ldv), tracking_number: String(ldv) }).eq('id', spedizione.id) } catch {}
        ;(base as any).numero = String(ldv)
        ;(base as any).tracking_number = String(ldv)
      }
      const eventi = (Array.isArray((trRaw as any)?.dettagli) ? (trRaw as any).dettagli : []).map((e: any) => ({
        date: [e?.data, e?.ora].filter(Boolean).join(' '),
        description: [e?.descrizione, e?.note].filter(Boolean).join(' — ') || 'Evento',
        location: e?.filiale || '',
      })).reverse()   // più recente in alto, come nell'altro ramo
      return NextResponse.json({ ...base, eventi, stato: statoEffettivo, status_code: 200 })
    }

    // GLS / BRT DIRETTI: non c'è webhook e nessuno riempie tracking_events → senza questo ramo il popup
    // cadrebbe sulla lettura (vuota) qui sotto e mostrerebbe "nessun evento" per SEMPRE, pur avendo il
    // badge di stato giusto. Si chiede il tracking LIVE al corriere (come DVA/SpediamoPro). Gli eventi sono
    // i testi di transito del T&T (senza data: il T&T che interroghiamo espone solo la descrizione dello
    // stato; la data richiederebbe i campi grezzi del corriere, da mappare su un pacco tracciato reale).
    if (corriere.tipo === 'gls' || corriere.tipo === 'brt') {
      const raw: any = spedizione.raw_response || {}
      let stati: string[] = []
      if (corriere.tipo === 'gls' && raw.numero && cred?.sigla_sede) {
        const { trackingGls, mapStatoGls } = await import('@/lib/gls')
        const r = await trackingGls(cred as any, String(raw.numero)); stati = r.stati
        let av: string | null = null
        for (const s of stati) { const m = mapStatoGls(s); if (m && prioritaStato(m) > prioritaStato(av)) av = m }
        await persistiStato(av)
      } else if (corriere.tipo === 'brt' && raw.parcelID) {
        const { trackingBrt, mapStatoBrt } = await import('@/lib/brt')
        const r = await trackingBrt(String(raw.parcelID)); stati = r.stati
        let av: string | null = null
        for (const s of stati) { const m = mapStatoBrt(s); if (m && prioritaStato(m) > prioritaStato(av)) av = m }
        await persistiStato(av)
      }
      const uniq = stati.filter((s, i) => s && stati.indexOf(s) === i)   // dedup, ordine cronologico
      const eventi = uniq.map(s => ({ date: '', description: s, location: '' })).reverse()   // più recente in alto
      return NextResponse.json({ ...base, eventi, stato: statoEffettivo, status_code: 200 })
    }

    // Spedisci.online ha CHIUSO il polling del tracking (403 "For tracking please use the Webhooks
    // events"): gli eventi arrivano in tempo reale dal WEBHOOK e vengono salvati in tracking_events.
    // Il popup mostra quelli (lo stato è già allineato dal webhook stesso, solo-in-avanti).
    const { data: evDb } = await admin.from('tracking_events')
      .select('stato,descrizione,luogo,data_evento')
      .eq('spedizione_id', spedizione.id)
      .order('data_evento', { ascending: false })
    const eventi = (evDb || []).map((e: any) => ({
      date: e.data_evento || '',
      description: e.descrizione || 'Evento',
      location: e.luogo || '',
    }))
    return NextResponse.json({ ...base, eventi, stato: statoEffettivo, status_code: 200 })
  } catch(e: any) {
    // MAI e.message grezzo: contiene il nome del provider e il corpo della sua risposta, e finiva
    // stampato nel popup sia al cliente sia al master.
    console.warn('[TRACKING][ERRORE]', { spedizione: spedizione.id, motivo: e?.message })
    return NextResponse.json({ ...base, eventi: [], stato: statoEffettivo, error: erroreTrackingPulito(e), tracking_number: spedizione.tracking_number }, { status: 200 })
  }
}