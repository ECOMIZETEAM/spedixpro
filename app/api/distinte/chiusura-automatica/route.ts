import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fulfillMarketplace } from '@/lib/fulfillMarketplace'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'
import { chiudiBordereauSpediamopro } from '@/lib/spediamopro'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const supabase = createAdminSupabase()

  const ora = new Date()
  // FINESTRA: prima prendeva solo le create nelle ultime ~22h (created_at >= ieri 23:00): chi saltava
  // un giro (annullo→ripristino 48h, cron fallito, creata tra le 23 e l'1) usciva dalla finestra PER
  // SEMPRE e restava aperta. Ora riprende TUTTO l'arretrato senza distinta degli ultimi 30 giorni,
  // escludendo le annullate/in annullo (non vanno mai in distinta).
  const inizio = new Date(ora)
  inizio.setDate(inizio.getDate() - 30)

  const { data: speds } = await supabase.from('spedizioni')
    .select('id,master_id,cliente_id,corriere_id,colli,peso_reale,costo_totale')
    .is('distinta_id', null)
    .not('stato', 'in', '(annullata,annullamento_pending,annullamento_manuale)')
    .gte('created_at', inizio.toISOString())

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

  let distinteCreate = 0
  for (const key in gruppi) {
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
      await supabase.from('spedizioni').update({ distinta_id: distinta.id }).in('id', righe.map(r => r.id))
      // Distinta = consegnate al corriere → "spedita" (solo le "in lavorazione", per non sovrascrivere
      // in_transito/consegnata). Come le chiusure manuali: si distinguono dalle etichette create dopo.
      await supabase.from('spedizioni').update({ stato: 'spedita' }).in('id', righe.map(r => r.id)).eq('stato', 'in_lavorazione')
      distinteCreate++
      // Tracking ai marketplace collegati (best-effort). UNICA porta: fulfillMarketplace applica la
      // guardia "mai evadere col numero provvisorio" per tutte le piattaforme.
      try { await fulfillMarketplace(supabase, righe.map(r => r.id)) } catch {}
      try { await chiudiBorderoSpedisci(supabase, distinta.id) } catch {}
      try { await chiudiBordereauSpediamopro(supabase, distinta.id) } catch {}
      try { const { chiudiGiornataGls } = await import('@/lib/gls'); await chiudiGiornataGls(supabase, distinta.id) } catch {}
    }
  }
  // ── DISTINTE DEI RESI (stesso giro delle 23: chiudo in distinta anche i resi rientrati) ──
  // Il reso e' GIA' addebitato dalla coda (resi_da_addebitare -> cron tracking), e l'addebito sale
  // gia' tutta la catena: qui NON si tocca il credito, si crea solo il DOCUMENTO che mancava. Il
  // numero distinta compare in elenco spedizioni agganciato al master DELLA SPEDIZIONE, quindi
  // "sale la rete" da solo: lo vede anche il master sopra guardando la stessa spedizione.
  let distinteResiCreate = 0
  try {
    // Resi rientrati (stato reso_mittente) di un cliente, non ancora in una distinta_resi, ultimi 30gg.
    // Le proprie del master (cliente_id NULL) non hanno flusso di distinta reso, come nel POST manuale.
    const { data: resi } = await supabase.from('spedizioni')
      .select('id,master_id,cliente_id')
      .eq('stato', 'reso_mittente')
      .not('cliente_id', 'is', null)
      .not('master_id', 'is', null)
      .gte('created_at', inizio.toISOString())

    if (resi?.length) {
      // Voci gia' chiuse (anti-doppia distinta, come escludiGiaInDistinta) + ultimo numero per master.
      const masterIds = [...new Set(resi.map((r: any) => r.master_id))]
      const { data: drEsistenti } = await supabase.from('distinte_resi').select('master_id,numero,voci').in('master_id', masterIds)
      const giaInDistinta = new Set<string>()
      const maxNumPerMaster = new Map<string, number>()
      for (const d of (drEsistenti || [])) {
        for (const v of (Array.isArray((d as any).voci) ? (d as any).voci : [])) if (v?.id) giaInDistinta.add(v.id)
        const mid = (d as any).master_id, n = Number((d as any).numero || 0)
        if (n > (maxNumPerMaster.get(mid) || 0)) maxNumPerMaster.set(mid, n)
      }

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
        const { data: movs } = await supabase.from('movimenti')
          .select('importo').eq('tipo', 'reso').eq('cliente_id', clienteId).in('spedizione_id', righe.map(r => r.id))
        const totale = (movs || []).reduce((s: number, m: any) => s + Math.abs(Number(m.importo || 0)), 0)
        const numero = (maxNumPerMaster.get(masterId) || 0) + 1
        maxNumPerMaster.set(masterId, numero)
        const { error: errR } = await supabase.from('distinte_resi').insert({
          master_id: masterId, cliente_id: clienteId, numero,
          totale_ldv: righe.length, totale, voci: righe.map(r => ({ id: r.id })), stato: 'chiusa',
        })
        if (!errR) distinteResiCreate++
      }
    }
  } catch (e: any) { console.error('[DISTINTE-RESI][CRON] errore:', e?.message) }

  return NextResponse.json({ success: true, distinteCreate, spedizioniChiuse: (speds?.length || 0), distinteResiCreate })
}