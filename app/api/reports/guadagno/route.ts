import { creaCalcolatoreListinoCliente } from '@/lib/pricing'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { vedeLaRete } from '@/lib/perimetro'

// Guadagno del master = quanto incassa dai clienti diretti e dai sotto-master diretti
// per le SPEDIZIONI, meno quanto il master paga al livello superiore/corriere.
// (Solo spedizioni + eventuali rimborsi per non contare le annullate. Resi esclusi.)
function dataDa(periodo: string): string {
  const d = new Date()
  if (periodo === 'giornaliero') d.setHours(0, 0, 0, 0)
  else if (periodo === 'settimanale') { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0) }
  else if (periodo === 'annuale') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }
  else { d.setDate(1); d.setHours(0, 0, 0, 0) }  // mensile: dal 1° del mese
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome,cliente_id,listino_agente_id').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || (utente?.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')   // 'YYYY-MM-DD'
  const alParam = req.nextUrl.searchParams.get('al')     // 'YYYY-MM-DD'
  // Intervallo: se arrivano dal/al (calendario) uso quelli, altrimenti il periodo predefinito.
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  // Aggregazione: per giorno se l'intervallo è breve, per mese se è lungo (o periodo annuale).
  const perMese = dalParam ? ((Date.parse(alEnd) - Date.parse(dal)) / 86400000 > 92) : (periodo === 'annuale')
  // Le RETTIFICHE (ripesature, allineamenti, correzioni di prezzo) qui NON entrano: hanno il loro
  // riquadro in home (/api/reports/guadagno-rettifiche, stessa struttura ristretta a tipo='rettifica').
  // Mescolate al margine delle spedizioni lo facevano oscillare a ondate — il fornitore rifattura a
  // blocchi e il master riaddebita il giorno dopo — e "il guadagno è dimezzato" non si capiva se
  // fossero le spedizioni o le ripesature. Verificato 22/09 su tutti i master, settembre: guadagno con
  // rettifiche = questo + riquadro Rettifiche, scarto 0,00.
  const TIPI = ['spedizione', 'rimborso', 'reso', 'giacenza']
  const admin = createAdminSupabase()

  // ── AGENTE ────────────────────────────────────────────────────────────────
  // Restituiva zero, sempre: il guadagno dell'agente non era calcolato da nessuna parte, e lui si
  // vedeva un report vuoto. Il suo margine non sta nei movimenti (i movimenti sono del master):
  // e' la differenza fra quello che i SUOI clienti hanno pagato e quello che costa a LUI, cioe' il
  // listino agente che il master gli ha assegnato.
  if (isAgente(utente)) {
    const idsCli = idClientiPerFiltro(await clientiAgente(supabase, utente))
    const listinoAg = (utente as any)?.listino_agente_id || null
    // Senza listino agente non esiste un costo suo: qualunque numero sarebbe inventato, e il
    // ripiego sul costo del master gli mostrerebbe il margine del master. Meglio dirlo.
    if (!listinoAg || !idsCli.length || idsCli[0] === '00000000-0000-0000-0000-000000000000') {
      return NextResponse.json({
        guadagno: 0, ricavi: 0, costi: 0, periodo, serie: [], numSpedizioni: 0, mediaSped: 0,
        costiProvider: null, senzaListino: !listinoAg,
      })
    }
    const calcAg = await creaCalcolatoreListinoCliente(admin, listinoAg)
    const sped = await fetchAll(() => admin.from('spedizioni')
      .select('id,costo_totale,created_at,stato,corriere_id,peso_reale,peso_fatturato,colli,dest_cap,dest_provincia,dest_citta,dest_paese,colli_dettaglio,contrassegno,assicurazione,servizi_accessori')
      .in('cliente_id', idsCli).gte('created_at', dal).lte('created_at', alEnd)
      .order('created_at', { ascending: false }).order('id', { ascending: false }))
    // Quello che il cliente ha pagato DAVVERO (movimenti), non il campo sulla spedizione: cosi'
    // resi e giacenze entrano nel conto come nell'elenco. Le rettifiche no (vedi TIPI): il costo
    // dell'agente e' il listino sulla spedizione originale, e contare la ripesatura pagata dal
    // cliente senza il suo costo gonfiava il margine.
    const movCli = await fetchAll(() => admin.from('movimenti')
      .select('spedizione_id,importo').in('cliente_id', idsCli).not('spedizione_id', 'is', null)
      .gte('created_at', dal).lte('created_at', alEnd).in('tipo', TIPI)
      .order('created_at', { ascending: false }).order('id', { ascending: false }))
    const pagato = new Map<string, number>()
    for (const m of (movCli || [])) {
      const k = (m as any).spedizione_id
      pagato.set(k, (pagato.get(k) || 0) + Math.abs(Number((m as any).importo || 0)) * (Number((m as any).importo || 0) < 0 ? 1 : -1))
    }
    let ricaviA = 0, costiA = 0
    const perG = new Map<string, { ricavi: number; costi: number }>()
    for (const sp of (sped || [])) {
      if ((sp as any).stato === 'annullata') continue
      const ric = pagato.has((sp as any).id) ? pagato.get((sp as any).id)! : Number((sp as any).costo_totale || 0)
      const cos = calcAg ? (calcAg(sp)?.totale ?? 0) : 0
      ricaviA += ric; costiA += cos
      const d = new Date((sp as any).created_at)
      const k = perMese ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : d.toISOString().slice(0, 10)
      const cur = perG.get(k) || { ricavi: 0, costi: 0 }
      cur.ricavi += ric; cur.costi += cos; perG.set(k, cur)
    }
    const r2a = (x: number) => Math.round(x * 100) / 100
    const n = (sped || []).filter((x: any) => x.stato !== 'annullata').length
    return NextResponse.json({
      guadagno: r2a(ricaviA - costiA), ricavi: r2a(ricaviA), costi: r2a(costiA), periodo,
      serie: Array.from(perG.entries()).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([giorno, v]) => ({ giorno, ricavi: r2a(v.ricavi), costi: r2a(v.costi), margine: r2a(v.ricavi - v.costi) })),
      numSpedizioni: n, mediaSped: n ? r2a((ricaviA - costiA) / n) : 0, costiProvider: null,
    })
  }

  // Il GUADAGNO include: spedizioni + RESI + GIACENZE (le rettifiche hanno il loro riquadro, vedi TIPI).
  // Struttura (movimento cliente/sotto-master = ricavo, movimento master_target = costo, più il costo
  // che scende dal livello superiore); il margine di resi e giacenze entra automaticamente, il
  // 'rimborso' netta le annullate a 0. (Per questo Report Guadagno ≠ Report Spedizioni.)
  //
  // Aggregazione nel DB: la serie ricavi/costi per giorno (o mese) la somma la RPC guadagno_master_serie_v1,
  // il numero spedizioni guadagno_num_spedizioni_v1. Prima si scaricavano in memoria TUTTI i movimenti del
  // periodo, mille per round-trip (per E&A MULTIEXPRESS ~90.000 righe = ~90 chiamate, più le spedizioni a
  // blocchi di 300 e il giro provider): decine di secondi. Ora poche query. La logica (ricavi clienti +
  // ricavi sotto-master + propria a margine 0, costo self + costo dal livello superiore) è identica ed è
  // stata verificata prima/dopo sui dati veri.
  const [{ data: serieRows, error: errSerie }, numSpedizioni] = await Promise.all([
    admin.rpc('guadagno_master_serie_v1', { p_master: M, p_dal: dal, p_al: alEnd, p_per_mese: perMese, p_tipi: TIPI }),
    admin.rpc('guadagno_num_spedizioni_v1', { p_master: M, p_dal: dal, p_al: alEnd }).then((r: any) => Number(r?.data || 0)),
  ])
  if (errSerie) return NextResponse.json({ error: errSerie.message }, { status: 500 })

  const r2 = (x: number) => Math.round(x * 100) / 100
  const perGiorno = new Map<string, { ricavi: number; costi: number }>()
  for (const row of (serieRows || [])) perGiorno.set((row as any).bucket, { ricavi: Number((row as any).ricavi || 0), costi: Number((row as any).costi || 0) })

  let ricaviTot = 0, costiTot = 0
  for (const v of perGiorno.values()) { ricaviTot += v.ricavi; costiTot += v.costi }
  const ricavi = r2(ricaviTot)
  const costi = r2(costiTot)
  const guadagno = r2(ricavi - costi)
  const mediaSped = numSpedizioni > 0 ? r2(guadagno / numSpedizioni) : 0

  // Riempio TUTTI i punti dell'intervallo (0 dove non ci sono movimenti) così il grafico è continuo
  const startD = new Date(dal), endD = new Date(alEnd)
  const keys: string[] = []
  if (perMese) {
    let y = startD.getUTCFullYear(), m = startD.getUTCMonth()
    const ey = endD.getUTCFullYear(), em = endD.getUTCMonth()
    while (y < ey || (y === ey && m <= em)) {
      keys.push(`${y}-${String(m + 1).padStart(2, '0')}`)
      m++; if (m > 11) { m = 0; y++ }
    }
  } else {
    let t = Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth(), startD.getUTCDate())
    const endT = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate())
    while (t <= endT) { keys.push(new Date(t).toISOString().slice(0, 10)); t += 86400000 }
  }
  const serie = keys.map(k => {
    const v = perGiorno.get(k) || { ricavi: 0, costi: 0 }
    return { giorno: k, ricavi: r2(v.ricavi), costi: r2(v.costi), margine: r2(v.ricavi - v.costi) }
  })

  // ── SOLO per E&A MULTIEXPRESS: costo corriere diviso per provider.
  //    Serve a verificare 1=1 col credito speso su ciascun account. Non compare per gli altri
  //    master: e' l'unico punto dell'applicazione dove i nomi dei fornitori a valle si possono
  //    leggere, e deve restare cosi'. ──
  const EA_MULTI_ID = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
  let costiProvider: any = null
  // NON BASTA CHE SIA LA RETE GIUSTA: DEVE ESSERE LA PERSONA GIUSTA.
  // Il controllo guardava solo il master. Ma sotto quel master ci sono anche due AGENTI, che sono
  // rivenditori esterni: a loro finiva sotto gli occhi la spesa divisa per fornitore, con i nomi
  // dei fornitori a valle — l'unica cosa che non deve uscire da qui. I clienti erano gia' fermati
  // piu' sopra; gli agenti no, perche' li' si guarda solo il ruolo 'cliente'.
  if (M === EA_MULTI_ID && vedeLaRete(utente)) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const sub = await sottoAlberoMasterIds(admin, M)
    // Costo per fornitore aggregato nel DB (group by): prima si scaricava tutto il sotto-albero.
    const { data: prov } = await admin.rpc('guadagno_costi_provider_v1', { p_sub: sub.length ? sub : [M], p_dal: dal, p_al: alEnd })
    // Ogni fornitore col suo nome. Chi non era nell'elenco usciva col nome tecnico del tipo
    // ('easyparcel'), che oltretutto non e' il nome con cui quel conto si chiama davvero.
    const LABEL: Record<string, string> = {
      spediamopro: 'SpediamoPro',
      spedisci: 'Spedisci.online',
      easyparcel: 'DVA',
      interno: 'Circuito interno',
    }
    costiProvider = (prov || [])
      .map((p: any) => ({ provider: LABEL[p.tipo] || p.tipo, costo: r2(Number(p.costo || 0)), n: Number(p.n || 0) }))
      .sort((a: any, b: any) => b.costo - a.costo)
  }

  return NextResponse.json({ guadagno, ricavi, costi, periodo, serie, numSpedizioni, mediaSped, costiProvider })
}
