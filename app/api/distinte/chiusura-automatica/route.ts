import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fulfillMarketplace } from '@/lib/fulfillMarketplace'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'
import { chiudiBordereauSpediamopro } from '@/lib/spediamopro'
import { pacchiGiaInDistintaResi, prossimoNumeroDistintaResi } from '@/lib/distinte-resi'

// Una sera porta ~7.000 spedizioni da chiudere in ~700 distinte (20/10/2026), e ogni distinta parla col
// corriere: in un passaggio solo non ci stanno. Il giro gira piu' volte a sera (vercel.json) e ogni
// passaggio si ferma in tempo; il successivo riprende da dove e' rimasto, perche' legge solo le
// spedizioni ancora senza distinta.
export const maxDuration = 300
const TEMPO_PER_PASSAGGIO_MS = 200_000

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const supabase = createAdminSupabase()

  const avvio = Date.now()
  const ora = new Date()
  // Finestra dei RESI (sotto): gli ultimi 30 giorni, sono solo documenti.
  const inizio = new Date(ora)
  inizio.setDate(inizio.getDate() - 30)

  // FINESTRA DELLE SPEDIZIONI: gli ultimi 3 giorni, cosi' rientra chi ha saltato un giro (cron fallito,
  // annullo ripristinato entro 48h). Era di 30 giorni, ma la lettura senza pagine si fermava a 1.000
  // righe: ogni sera si chiudevano 1.000 spedizioni a caso del giorno e le altre ~6.000 restavano senza
  // distinta per sempre — anche BRT diretti che senza conferma non vengono ritirati (2 di HYDROEXPERT del
  // 05/10). L'arretrato piu' vecchio NON si chiude da solo: trasmetterebbe oggi ai corrieri etichette di
  // settimane fa, e una GLS trasmessa non si annulla piu' in automatico (scelta di Lorenzo, 21/10/2026).
  const inizioSpedizioni = new Date(ora.getTime() - 3 * 864e5)
  // Solo le create prima delle 21:00 UTC di stasera (l'ora del primo passaggio): i passaggi successivi
  // non prendono le etichette fatte nel frattempo, che restano per la sera dopo come sempre.
  const taglio = new Date(Date.UTC(ora.getUTCFullYear(), ora.getUTCMonth(), ora.getUTCDate(), 21))
  if (taglio > ora) taglio.setUTCDate(taglio.getUTCDate() - 1)

  const speds: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from('spedizioni')
      .select('id,master_id,cliente_id,corriere_id,colli,peso_reale,costo_totale,created_at')
      .is('distinta_id', null)
      .not('stato', 'in', '(annullata,annullamento_pending,annullamento_manuale)')
      .gte('created_at', inizioSpedizioni.toISOString())
      .lt('created_at', taglio.toISOString())
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(da, da + 999)
    if (error) { console.error('[DISTINTE][CRON] lettura spedizioni:', error.message); break }
    speds.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  // NB: niente uscita anticipata se non ci sono spedizioni — sotto vanno comunque chiusi i RESI.

  // AUTODISTINTA OFF (impostazioni cliente): il cron NON chiude le spedizioni di questi clienti —
  // le distinte le fanno loro a mano dal portale. Default (nessuna impostazione) = ON.
  const { data: esclusi } = await supabase.from('clienti').select('id').eq('impostazioni->>autodistinta', 'no')
  const autodistintaOff = new Set((esclusi || []).map((c: any) => c.id))

  const gruppi: Record<string, any[]> = {}
  for (const s of (speds || [])) {
    // cliente_id NULL = spedizione PROPRIA del master: prima veniva SALTATA (mai chiusa in distinta).
    // Ora la raggruppo per master+corriere con distinta senza cliente (come la chiusura manuale "m:").
    if (!s.master_id || !s.corriere_id) continue
    if (s.cliente_id && autodistintaOff.has(s.cliente_id)) continue   // autodistinta OFF: chiude lui
    const key = s.master_id + '|' + (s.cliente_id || 'PROPRIA') + '|' + s.corriere_id
    if (!gruppi[key]) gruppi[key] = []
    gruppi[key].push(s)
  }

  let distinteCreate = 0, spedizioniChiuse = 0, gruppiRimandati = 0
  // I gruppi in ordine di spedizione piu' vecchia (le spedizioni sono lette cosi'): se il tempo finisce,
  // restano indietro le piu' recenti, che il passaggio dopo o la sera dopo riprendono.
  for (const key in gruppi) {
    if (Date.now() - avvio > TEMPO_PER_PASSAGGIO_MS) { gruppiRimandati++; continue }
    const [masterId, clienteRaw, corriereId] = key.split('|')
    const clienteId = clienteRaw === 'PROPRIA' ? null : clienteRaw
    const righe = gruppi[key]
    const totaleColli = righe.reduce((s, x) => s + Number(x.colli || 1), 0)
    const totalePeso = righe.reduce((s, x) => s + Number(x.peso_reale || 0), 0)
    const prezzoTotale = righe.reduce((s, x) => s + Number(x.costo_totale || 0), 0)
    // NUMERO GLOBALE dalla sequenza DB (atomica): unico su tutta la rete, zero conflitti.
    const { data: numSeq } = await supabase.rpc('prossimo_numero_distinta')
    const numeroDistinta = String(numSeq || Date.now())
    const { data: distinta } = await supabase.from('distinte').insert({
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereId,
      numero: numeroDistinta, data: new Date().toISOString().split('T')[0], stato: 'chiusa',
      totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: righe.length, prezzo_totale: prezzoTotale,
    }).select().single()
    if (distinta?.id) {
      // A blocchi di 300: un gruppo puo' avere migliaia di righe, e un elenco di id troppo lungo nella
      // richiesta fallisce senza dirlo. Solo le righe ancora senza distinta: un passaggio non ruba le
      // spedizioni a un altro.
      const ids = righe.map(r => r.id)
      for (let i = 0; i < ids.length; i += 300) {
        const blocco = ids.slice(i, i + 300)
        const { data: prese } = await supabase.from('spedizioni').update({ distinta_id: distinta.id }).in('id', blocco).is('distinta_id', null).select('id')
        spedizioniChiuse += (prese || []).length
        // Distinta = consegnate al corriere → "spedita" (solo le "in lavorazione", per non sovrascrivere
        // in_transito/consegnata). Come le chiusure manuali: si distinguono dalle etichette create dopo.
        await supabase.from('spedizioni').update({ stato: 'spedita' }).in('id', blocco).eq('distinta_id', distinta.id).eq('stato', 'in_lavorazione')
      }
      distinteCreate++
      // Tracking ai marketplace collegati (best-effort). UNICA porta: fulfillMarketplace applica la
      // guardia "mai evadere col numero provvisorio" per tutte le piattaforme.
      for (let i = 0; i < ids.length; i += 200) { try { await fulfillMarketplace(supabase, ids.slice(i, i + 200)) } catch {} }
      try { await chiudiBorderoSpedisci(supabase, distinta.id) } catch {}
      try { await chiudiBordereauSpediamopro(supabase, distinta.id) } catch {}
      try { const { chiudiGiornataGls } = await import('@/lib/gls'); await chiudiGiornataGls(supabase, distinta.id) } catch {}
      try { const { chiudiDistintaBrt } = await import('@/lib/brt'); await chiudiDistintaBrt(supabase, distinta.id) } catch {}
      try { const { chiudiDistintaFedex } = await import('@/lib/fedex'); await chiudiDistintaFedex(supabase, distinta.id) } catch {}
      try { const { chiudiDistintaMoovexpress } = await import('@/lib/distinte-chiusura'); await chiudiDistintaMoovexpress(supabase, distinta.id) } catch {}   // condivisione: gamba-ponte auto-attestata
      // Senza manifest (easyparcel/interno/inpost/poste/dielle): il cron era la porta che NON li
      // attestava → ogni notte nascevano distinte "In attesa" a vita. Ora si attestano subito.
      try { const { chiudiDistintaSenzaManifest } = await import('@/lib/distinte-chiusura'); await chiudiDistintaSenzaManifest(supabase, distinta.id) } catch {}
    }
  }
  // ── DISTINTE DEI RESI (stesso giro delle 23: chiudo in distinta anche i resi rientrati) ──
  // Il reso e' GIA' addebitato dalla coda (resi_da_addebitare -> cron addebiti-code), e l'addebito sale
  // gia' tutta la catena: qui NON si tocca il credito, si crea solo il DOCUMENTO che mancava. Il
  // numero distinta compare in elenco spedizioni agganciato al master DELLA SPEDIZIONE, quindi
  // "sale la rete" da solo: lo vede anche il master sopra guardando la stessa spedizione.
  let distinteResiCreate = 0
  try {
    // Resi rientrati (stato reso_mittente) di un cliente, non ancora in una distinta_resi, ultimi 30gg.
    // Le proprie del master (cliente_id NULL) non hanno flusso di distinta reso, come nel POST manuale.
    // A pagine anche questi: i resi del mese sono ~800 e oltre i 1.000 i restanti sparirebbero senza avviso.
    const resi: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await supabase.from('spedizioni')
        .select('id,numero,master_id,cliente_id')
        .eq('stato', 'reso_mittente')
        .not('cliente_id', 'is', null)
        .not('master_id', 'is', null)
        .gte('created_at', inizio.toISOString())
        .order('id', { ascending: true }).range(da, da + 999)
      if (error) throw new Error('Lettura resi non riuscita: ' + error.message)
      resi.push(...(data || []))
      if (!data || data.length < 1000) break
    }

    if (resi.length) {
      // Voci gia' chiuse (anti-doppia distinta, come escludiGiaInDistinta), lette a pagine: con una lettura
      // sola, oltre le 1.000 distinte, ogni sera si rimettevano in distinta i resi gia' chiusi (vedi
      // lib/distinte-resi). I resi presi qui sono degli ultimi 30 giorni: bastano le distinte da allora.
      const masterIds = [...new Set(resi.map((r: any) => r.master_id))]
      const giaInDistinta = await pacchiGiaInDistintaResi(supabase, masterIds, { dal: inizio.toISOString() })

      // Raggruppo per master DIRETTO + cliente: la distinta_resi e' per cliente, come nel flusso manuale.
      const gruppiResi: Record<string, any[]> = {}
      for (const r of resi) {
        if (giaInDistinta.has(r.id)) continue
        const key = r.master_id + '|' + r.cliente_id
        if (!gruppiResi[key]) gruppiResi[key] = []
        gruppiResi[key].push(r)
      }

      for (const key in gruppiResi) {
        const [masterId, clienteId] = key.split('|')
        const righe = gruppiResi[key]
        // TOTALE = quanto e' GIA' stato addebitato AL CLIENTE (movimento reso con cliente_id): si somma
        // cio' che la coda ha gia' scritto, per mostrarlo in distinta. Nessun addebito parte da qui.
        // Per un pacco condiviso l'addebito sta sulla gamba originante, anche quando la riga in distinta e'
        // la gamba del venditore (LOGIXIA verso "Wave ship (ingrosso)"): lo cerca totaleResoAddebitato.
        const { totaleResoAddebitato } = await import('@/lib/giacenza-cascata')
        const totale = await totaleResoAddebitato(supabase, righe.map(r => r.id), { clienteId })
        const numero = await prossimoNumeroDistintaResi(supabase, masterId)
        const { error: errR } = await supabase.from('distinte_resi').insert({
          master_id: masterId, cliente_id: clienteId, numero,
          // Il numero accanto all'id, come nelle distinte di reso nate dalle altre porte: l'elenco, la pagina
          // Rete e il portale cliente mostrano le LDV leggendolo da qui (solo l'id = "+3" senza numeri).
          totale_ldv: righe.length, totale, voci: righe.map(r => ({ id: r.id, numero: r.numero })), stato: 'chiusa',
        })
        if (!errR) distinteResiCreate++
      }
    }
  } catch (e: any) { console.error('[DISTINTE-RESI][CRON] errore:', e?.message) }

  if (gruppiRimandati) console.warn('[DISTINTE][CRON] tempo finito: distinte rimandate al passaggio successivo', gruppiRimandati)
  return NextResponse.json({ success: true, distinteCreate, spedizioniChiuse, gruppiRimandati, distinteResiCreate })
}