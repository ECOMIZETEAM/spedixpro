import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { gestisceLaRete, senzaCostoMaster } from '@/lib/ruoli'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { ledgerFornitoriDaNascondere } from '@/lib/gambe-visibilita'
import { fetchAllStretto } from '@/lib/fetch-all'
import { spedizioniInCatena } from '@/lib/catena-report'
import { confineGiornoRoma } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'

// Elenco giacenze (lista master). La GESTIONE (svincolo/riconsegna/reso/nuovo indirizzo + addebito)
// NON sta più qui: passa dalla porta unica eseguiSvincolo via /api/giacenze/[id] (dettaglio), il
// portale cliente (/api/cliente/giacenze) e l'API v1. Il vecchio POST di questa rotta — svincolo
// rapido a sola "riconsegna", senza scelta reso/nuovo indirizzo e con un costo giornaliero mai
// addebitato — era rimasto agganciato solo a un modal ORMAI MORTO della lista: rimosso (11/09/2026).
//
// La usa anche il Report Giacenze (?report=1): stesso perimetro della pagina, piu' l'importo della
// giacenza addebitato al DIRETTO. Prima il report leggeva l'elenco spedizioni filtrato sullo stato
// ATTUALE `in_giacenza` e sulla data di CREAZIONE: MULTIEXPRESS dall'1 al 14/10 ne vedeva 82 su 671
// aperte nel periodo (misurato il 15/10), e la colonna "Totale" era il nolo: 822,99 € su quelle 82,
// mentre le giacenze del periodo addebitate ai diretti sono 1.455,75 €.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // Rotta del portale master: il cliente ha /api/cliente/giacenze, l'autista nessuna. Senza questa
  // riga entrambi finivano nel ramo "solo il mio master_id", affidati alla sola RLS.
  if (!utente?.master_id || (!vedeLaRete(utente) && !isAgente(utente))) return NextResponse.json({ error: 'Non consentito' }, { status: 403 })
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  // Vettore FISICO (GLS/BRT/POSTE/SDA/UPS...), come nell'elenco spedizioni: prima il parametro veniva
  // letto e mai usato, e le tendine mandavano 'sda/gls/brt/poste' minuscolo.
  const vettore = (p.get('vettore') || '').trim().toUpperCase()
  const contratto = (p.get('contratto') || '').trim()
  const agenteSel = (p.get('agente') || '').trim()
  const stato = p.get('stato')
  // Giorni di ROMA: 'YYYY-MM-DD' diventa mezzanotte/fine giornata italiane (prima valeva l'ora di
  // Greenwich, e le giacenze aperte fra mezzanotte e le 2 finivano nel giorno sbagliato).
  const dal = confineGiornoRoma(p.get('dal'), 'dal')
  const al = confineGiornoRoma(p.get('al'), 'al')
  const report = p.get('report') === '1'

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminDb = createAdminSupabase()
  let db: any = supabase
  let subtreeSel: string[] | null = null
  let ownedContractNames: string[] | null = null   // filtro visibilità rete (contratti posseduti)
  if (masterSel && vedeLaRete(utente)) {
    const { sottoAlberoMasterIds, masterIdsVisibili, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
    const nn = await contrattiPossedutiNomi(adminDb, utente.master_id)
    ownedContractNames = nn.length ? nn : null
  // Elencare "cliente per cliente" i ruoli esclusi a mano (agente, cliente) lasciava dentro
  // l'AUTISTA, che un master_id ce l'ha come tutti: con l'accesso pieno vedeva le giacenze
  // dell'intera rete, prezzi e clienti compresi. La regola sta in lib/perimetro.ts, dove e' una
  // sola e non si dimentica un ruolo per volta.
  } else if (vedeLaRete(utente)) {
    // MASTER: le giacenze risalgono a TUTTA la rete (come Elenco Spedizioni/volumetria), non solo
    // le proprie: prima si vedeva solo master_id === il mio, quindi le giacenze dei sotto-master
    // (es. Ecomize LL) non comparivano.
    const { sottoAlberoMasterIds, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
    subtreeSel = await sottoAlberoMasterIds(adminDb, utente.master_id)
    if (subtreeSel.length > 1) db = adminDb
    const nn = await contrattiPossedutiNomi(adminDb, utente.master_id)
    ownedContractNames = nn.length ? nn : null
  }
  const filtroContratti = !!ownedContractNames && ownedContractNames.length > 0
  // NASCONDI-FORNITORI (come lista spedizioni): niente giacenze delle gambe a monte (cliente = ledger d'acquisto).
  const ledgerNascosti = isAgente(utente) ? [] : await ledgerFornitoriDaNascondere(adminDb, utente.master_id)
  // Agente: solo giacenze dei suoi clienti (copre anche l'eventuale ramo rete).
  const idsAgente = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null

  // Filtro "è entrata in giacenza" (giacenza_data valorizzata), NON lo stato corrente: dopo lo
  // svincolo il cron sposta spedizioni.stato (in_giacenza -> non_consegnato/in_consegna) ma la
  // giacenza deve RESTARE in elenco (con giacenza_stato = svincolata/chiusa). Prima spariva.
  // Colonne LEGGERE (SPED_COLS): niente etichetta_url/raw_response/colli_dettaglio (~300 KB/riga di
  // blob PDF/base64). Includono già tutti i campi giacenza_* che la pagina usa. Era `*`: su una rete
  // con molte giacenze la lista trasferiva decine di MB → "veramente lenta". La rotta cliente lo faceva già.
  // A PAGINE, con l'id come secondo ordine: PostgREST si ferma a 1.000 righe e l'elenco si troncava in
  // silenzio (MULTIEXPRESS ne ha 1.198 nel solo settembre, ~2.650 nei 365 giorni che la pagina carica).
  const build = () => {
    let query = db.from('spedizioni')
      .select(`${SPED_COLS}, clienti(ragione_sociale,agente), ${filtroContratti ? 'corrieri!inner(nome_contratto)' : 'corrieri(nome_contratto)'}`)
      .not('giacenza_data', 'is', null)
      .order('giacenza_data', { ascending: false })
      .order('id', { ascending: false })
    if (subtreeSel) query = query.in('master_id', subtreeSel)
    else query = query.eq('master_id', utente.master_id)
    if (ledgerNascosti.length) query = query.or(`cliente_id.is.null,cliente_id.not.in.(${ledgerNascosti.join(',')})`)
    // Rete: solo giacenze su contratti che possiedo (non i privati del sub).
    if (filtroContratti) query = query.in('corrieri.nome_contratto', ownedContractNames as string[])
    if (idsAgente) query = query.in('cliente_id', idsAgente)
    if (clienteId) query = query.eq('cliente_id', clienteId)
    // 'aperta' = in attesa di istruzioni: le giacenze appena rilevate hanno giacenza_stato NULL
    // (il rilevamento valorizza solo giacenza_data) -> il confronto esatto le escludeva dal filtro.
    if (stato === 'aperta') query = query.or('giacenza_stato.eq.aperta,giacenza_stato.is.null')
    else if (stato) query = query.eq('giacenza_stato', stato)
    // Filtro per la data di ENTRATA in giacenza (giacenza_data), non per la data di spedizione
    // (created_at): una giacenza può nascere oggi da una spedizione creata giorni fa, e col filtro
    // su created_at (default oggi) non compariva.
    if (dal) query = query.gte('giacenza_data', dal)
    if (al) query = query.lte('giacenza_data', al)
    return query
  }
  let righe: any[]
  try { righe = await fetchAllStretto(build) }
  catch (e: any) { return NextResponse.json({ error: 'Lettura giacenze non riuscita: ' + (e?.message || e) }, { status: 500 }) }

  // Il vettore di una riga e' quello del MIO contratto con lo stesso nome: le copie dei sotto-master
  // sono spesso ponti (tipo 'moovexpress') e i GLS/BRT diretti hanno nomi senza il marchio ("PF CE
  // LIGHT" e' GLS), quindi la riga da sola non lo dice.
  const { data: mieiCorr, error: eCorr } = await adminDb.from('corrieri').select('nome_contratto,tipo').eq('master_id', utente.master_id)
  if (eCorr) return NextResponse.json({ error: 'Lettura contratti non riuscita: ' + eCorr.message }, { status: 500 })
  const vettoreDiNome = new Map<string, string>()
  for (const c of (mieiCorr || [])) vettoreDiNome.set(String((c as any).nome_contratto || '').trim(), vettoreFisico(c as any))
  const nomeContratto = (r: any) => String(r.corrieri?.nome_contratto || '').trim()
  for (const r of righe) r.vettore = vettoreDiNome.get(nomeContratto(r)) || vettoreFisico({ nome_contratto: nomeContratto(r) })
  if (vettore) righe = righe.filter((r: any) => r.vettore === vettore)
  if (contratto) righe = righe.filter((r: any) => nomeContratto(r) === contratto)
  if (agenteSel) righe = righe.filter((r: any) => String(r.clienti?.agente || '').trim() === agenteSel)

  // PRIMA LINEA: le giacenze della rete si leggono col nome del sotto-master DIRETTO attraverso cui
  // scendono (io -> MASSIMO -> GIOVANNI: quelle di Giovanni stanno sotto MASSIMO), come nell'elenco.
  const primaLinea = new Map<string, string>()
  const nomeMaster = new Map<string, string>()
  if (vedeLaRete(utente) && righe.some((r: any) => r.master_id !== utente.master_id)) {
    const { data: ms, error: eM } = await adminDb.from('masters').select('id,nome,parent_master_id')
    if (eM) return NextResponse.json({ error: 'Lettura rete non riuscita: ' + eM.message }, { status: 500 })
    const figliDi = new Map<string, any[]>()
    for (const m of (ms || []) as any[]) {
      nomeMaster.set(m.id, m.nome)
      if (!m.parent_master_id) continue
      if (!figliDi.has(m.parent_master_id)) figliDi.set(m.parent_master_id, [])
      figliDi.get(m.parent_master_id)!.push(m)
    }
    let frontiera = [utente.master_id]
    for (let i = 0; i < 20 && frontiera.length; i++) {
      const nuovi: string[] = []
      for (const f of frontiera) for (const c of (figliDi.get(f) || [])) {
        if (primaLinea.has(c.id)) continue
        primaLinea.set(c.id, f === utente.master_id ? c.id : (primaLinea.get(f) || c.id))
        nuovi.push(c.id)
      }
      frontiera = nuovi
    }
  }
  for (const r of righe) {
    const fl = r.master_id !== utente.master_id ? primaLinea.get(r.master_id) : null
    r.master_rete = fl ? (nomeMaster.get(fl) || null) : null
  }

  if (report && righe.length) {
    try { await importiAlDiretto(adminDb, righe, utente.master_id, primaLinea) }
    catch (e: any) { return NextResponse.json({ error: 'Lettura addebiti giacenza non riuscita: ' + (e?.message || e) }, { status: 500 }) }
  }

  // Il costo che il master paga al corriere non e' un dato dell'agente (rivenditore esterno).
  if (isAgente(utente)) righe = righe.map((r: any) => { const { costo_spedizione, ...resto } = r; return resto })
  return NextResponse.json(righe)
}

// QUANTO E' STATO ADDEBITATO AL DIRETTO PER LA GIACENZA: i movimenti 'giacenza' della spedizione verso
// chi paga me — il cliente (movimento col SUO cliente_id: sulle spedizioni condivise ci sono anche i
// conti "(ingrosso)" sulla stessa riga, e non sono suoi) oppure, per le giacenze della rete, il
// sotto-master di prima linea (master_target_id, cliente_id vuoto). Mai il prezzo del cliente finale
// di un sotto-master.
// Su un pacco condiviso la giacenza e' del PACCO e si registra sulla gamba ORIGINANTE (REGOLE.md):
// per questo si cercano i movimenti su tutte le gambe con lo stesso tracking, non solo su questa riga.
async function importiAlDiretto(adminDb: any, righe: any[], mio: string, primaLinea: Map<string, string>) {
  const gambeDi = new Map<string, Set<string>>()
  const tracking = [...new Set(righe.map((r: any) => r.tracking_number).filter(Boolean))] as string[]
  for (let i = 0; i < tracking.length; i += 150) {
    const gg = await fetchAllStretto(() => adminDb.from('spedizioni').select('id,tracking_number')
      .in('tracking_number', tracking.slice(i, i + 150)).order('id', { ascending: true }))
    for (const g of gg) {
      if (!gambeDi.has(g.tracking_number)) gambeDi.set(g.tracking_number, new Set())
      gambeDi.get(g.tracking_number)!.add(g.id)
    }
  }
  const gambe = (r: any) => { const s = new Set<string>(r.tracking_number ? (gambeDi.get(r.tracking_number) || []) : []); s.add(r.id); return s }
  const tutteLeGambe = [...new Set(righe.flatMap((r: any) => [...gambe(r)]))]
  const movPerSped = new Map<string, any[]>()
  for (let i = 0; i < tutteLeGambe.length; i += 200) {
    const blocco = tutteLeGambe.slice(i, i + 200)
    const mov = await fetchAllStretto(() => adminDb.from('movimenti')
      .select('id,spedizione_id,cliente_id,master_id,master_target_id,conto,importo')
      .eq('tipo', 'giacenza').in('spedizione_id', blocco).order('spedizione_id', { ascending: true }).order('id', { ascending: true }))
    for (const m of mov) {
      if (!movPerSped.has(m.spedizione_id)) movPerSped.set(m.spedizione_id, [])
      movPerSped.get(m.spedizione_id)!.push(m)
    }
  }
  // I pacchi su cui io sto nella catena (lib/catena-report): servono per i movimenti che il
  // sotto-master scrive su SE STESSO, che sono addebiti verso di me solo in quel caso. Stessa regola
  // del Report Rettifiche e delle Fatture: senza, la piattaforma (sopra MULTIEXPRESS, nessun contratto)
  // contava "addebitate a MULTIEXPRESS" 718 giacenze (1.347 €, 1-14/10/2026) che sono del suo fornitore.
  // La prova si fa su TUTTE le gambe del pacco (lib/catena-report): sui contratti condivisi il mio costo
  // d'acquisto sta sul mio conto "(ingrosso)", spesso su un'altra gamba dello stesso tracking.
  const conSelf = righe.filter((r: any) => [...gambe(r)].some((sid) => (movPerSped.get(sid) || []).some((m: any) => !m.cliente_id && m.master_id === m.master_target_id)))
  const gambeInCatena = await spedizioniInCatena(adminDb, mio, conSelf.flatMap((r: any) => [...gambe(r)]))
  for (const r of righe) {
    const paccoInCatena = [...gambe(r)].some((sid) => gambeInCatena.has(sid))
    const fl = r.master_id === mio ? null : (primaLinea.get(r.master_id) || null)
    // Spedizione propria del master senza cliente: non c'e' un diretto a cui addebitare.
    if ((r.master_id === mio && !r.cliente_id) || (r.master_id !== mio && !fl)) { r.importo_giacenza = null; continue }
    let somma = 0
    for (const sid of gambe(r)) for (const m of (movPerSped.get(sid) || [])) {
      // Verso il sotto-master di prima linea contano solo gli addebiti scritti da me o da lui sul suo
      // conto rete: mai quelli di un terzo sulla stessa spedizione, mai il conto 'proprio' (i costi dei
      // suoi contratti), e i suoi su se stesso solo se io sto nella catena.
      const alDiretto = r.master_id === mio
        ? (!!m.cliente_id && m.cliente_id === r.cliente_id)
        : (!m.cliente_id && m.master_target_id === fl && m.conto !== 'proprio'
          && (m.master_id === mio || (m.master_id === fl && paccoInCatena)))
      if (alDiretto) somma += Number(m.importo || 0)
    }
    // Importi con segno: l'addebito e' negativo, lo storno positivo. Addebitato = -(somma).
    r.importo_giacenza = Math.round(-somma * 100) / 100
  }
}
