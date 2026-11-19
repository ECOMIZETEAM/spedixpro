import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { creaCalcolatoreListinoCliente, creaCalcolatoreCorriere } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'
import { confineGiornoRoma } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'
import { ledgerFornitoriDaNascondere } from '@/lib/gambe-visibilita'
import { senzaNomiFornitori } from '@/lib/corriere-logo'
import { spedizioniInCatena } from '@/lib/catena-report'

// Il report di un master grande legge decine di migliaia di spedizioni con i loro movimenti ed
// eventi di tracking (MULTIEXPRESS, 1-14/10/2026: ~60.000 spedizioni). Non sta nella finestra breve.
export const maxDuration = 300

const r2 = (x: number) => Math.round(x * 100) / 100

// MAI UN REPORT MONCO IN SILENZIO. fetchAll, alla prima pagina che non si legge, chiude l'elenco li'
// e restituisce quello che ha: il report usciva con i totali di mezzo periodo e nessuno lo sapeva.
// Qui una pagina che fallisce fa fallire la richiesta, con l'errore vero.
function leggiTutto(build: () => any): Promise<any[]> {
  return fetchAll(() => {
    const q = build()
    return { range: (a: number, b: number) => q.range(a, b).then((r: any) => { if (r.error) throw new Error(r.error.message); return r }) }
  })
}

// Liste di id a blocchi di 200 (oltre ~25 KB di indirizzo PostgREST risponde 400) e sei blocchi
// alla volta: in fila, il report di MULTIEXPRESS di un solo giorno durava 82 secondi.
async function perBlocchi<T>(ids: string[], fn: (blocco: string[]) => Promise<T[]>): Promise<T[]> {
  const blocchi: string[][] = []
  for (let i = 0; i < ids.length; i += 200) blocchi.push(ids.slice(i, i + 200))
  const out: T[] = []
  for (let i = 0; i < blocchi.length; i += 6) {
    for (const parte of await Promise.all(blocchi.slice(i, i + 6).map(fn))) out.push(...parte)
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    return await report(req)
  } catch (e: any) {
    console.error('[REPORT SPEDIZIONI]', e?.message || e)
    return NextResponse.json({ error: 'Report non riuscito: ' + (e?.message || 'errore di lettura') }, { status: 500 })
  }
}

// Report spedizioni dal punto di vista del MASTER LOGGATO (report margine):
// - "Tutti" (nessun cliente selezionato) → tutta la sua rete (sotto-albero).
// - Prezzo Cliente = quello che gli paga il suo DIRETTO (cliente diretto o figlio di prima linea).
// - Prezzo Corriere = quello che paga LUI (il suo listino corriere, assegnato dal master sopra).
async function report(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente, error: errUtente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome,listino_agente_id').eq('id', user.id).single()
  if (errUtente || !utente) return NextResponse.json({ error: 'Utente non trovato' }, { status: 403 })
  const p = req.nextUrl.searchParams
  const ruolo = (utente.ruolo || '').toLowerCase()
  // L'autista lavora solo da /api/autista: qui valeva come master (rete, costi, prezzi corriere).
  if (ruolo === 'autista') return NextResponse.json({ error: 'Non consentito' }, { status: 403 })
  // UN CLIENTE VEDE SOLO LE PROPRIE SPEDIZIONI, QUALUNQUE COSA CHIEDA.
  //
  // Il perimetro lo decideva il parametro ?clienteId. Passando "m:<id>" si finiva nel ramo della
  // rete, che per costruzione usa il client amministrativo e quindi SCAVALCA la RLS — e il
  // master_id ce l'hanno anche gli utenti cliente. Bastava quindi che un cliente chiamasse questa
  // rotta con l'id del proprio master per scaricarsi il report di tutte le spedizioni della rete,
  // costi nostri compresi. Il ruolo va guardato PRIMA di leggere qualunque parametro: quello che
  // arriva da fuori non puo' allargare il perimetro di chi chiede.
  const eCliente = ruolo === 'cliente'
  const clienteIdRaw = eCliente ? null : p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato')
  // Giorni di Roma: 'YYYY-MM-DD' (o la vecchia fine giornata 'T23:59:59') diventa il confine del
  // giorno italiano. Prima valeva quello di Greenwich: le spedizioni fra mezzanotte e le 2 finivano
  // nel giorno prima.
  const dal = confineGiornoRoma(p.get('dal'), 'dal')
  const al = confineGiornoRoma(p.get('al'), 'al')
  const contrassegno = p.get('contrassegno')
  // Provincia: due lettere, senza badare a maiuscole/minuscole. Col confronto esatto "RM" non trovava
  // le 119 spedizioni di ottobre scritte "rm" (e "Rm", "rm"...).
  const provRaw = (p.get('provincia') || '').trim()
  if (provRaw && !/^[A-Za-z]{2}$/.test(provRaw)) return NextResponse.json({ error: 'Provincia non valida' }, { status: 400 })
  const provincia = provRaw || null
  const fVettore = (p.get('vettore') || '').trim().toUpperCase() || null
  const fContratto = (p.get('contratto') || '').trim() || null
  const mine = utente.master_id
  const isMaster = ruolo !== 'cliente' && ruolo !== 'agente' && !!mine

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminDb = createAdminSupabase()

  // Prima linea: per ogni discendente del master loggato, il figlio diretto attraverso cui
  // scende la spedizione (serve per prezzare il PREZZO CLIENTE verso il figlio diretto, e per
  // raggruppare il riepilogo: chi paga il master e' il suo diretto).
  const primaLineaId = new Map<string, string>()
  const nomeMaster = new Map<string, string>()
  if (isMaster && mine) {
    const { data: tuttiM, error: errM } = await adminDb.from('masters').select('id,nome,parent_master_id')
    if (errM) throw new Error(errM.message)
    const figliDi = new Map<string, any[]>()
    for (const m of (tuttiM || []) as any[]) {
      nomeMaster.set(m.id, m.nome)
      if (!m.parent_master_id) continue
      if (!figliDi.has(m.parent_master_id)) figliDi.set(m.parent_master_id, [])
      figliDi.get(m.parent_master_id)!.push(m)
    }
    let frontier = [mine]
    for (let i = 0; i < 20 && frontier.length; i++) {
      const nuovi: string[] = []
      for (const f of frontier) for (const c of (figliDi.get(f) || [])) {
        if (primaLineaId.has(c.id) || c.id === mine) continue
        primaLineaId.set(c.id, c.parent_master_id === mine ? c.id : (primaLineaId.get(c.parent_master_id) || c.id))
        nuovi.push(c.id)
      }
      frontier = nuovi
    }
  }

  // Scope della query
  let db: any = supabase
  let subtreeSel: string[] | null = null
  if (masterSel && isMaster && mine) {
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const mieiDiscendenti = await masterIdsVisibili(adminDb, mine)
    subtreeSel = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(adminDb, masterSel) : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  }
  const reteIds = isMaster && !clienteId && !masterSel ? [mine as string, ...primaLineaId.keys()] : null
  if (reteIds && reteIds.length > 1) db = adminDb
  // VISIBILITÀ PER CONTRATTO: sui rami di RETE il master vede solo i contratti che possiede
  // (non i privati dei sub). Stessa regola della lista spedizioni.
  const { contrattiPossedutiNomi } = await import('@/lib/rete-masters')
  const ownedContractNames = isMaster && mine ? await contrattiPossedutiNomi(adminDb, mine) : []

  // Agente: solo i suoi clienti (calcolato una volta, fuori dal loop).
  const agIds = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null

  // RETTIFICHE ADDEBITATE AI DIRETTI NEL PERIODO (Report Fatture, ?vista=rettifiche).
  // La fattura di un mese deve contenere le rettifiche ADDEBITATE in quel mese, qualunque sia il
  // giorno della spedizione: prese per data della spedizione, a ottobre (1-14/10/2026) restavano fuori
  // 4.623 rettifiche cliente per 14.833 € su spedizioni di luglio-settembre, e la fattura di settembre
  // cambiava a posteriori. Si leggono quindi i MOVIMENTI per data dell'addebito, e solo quelli verso
  // il DIRETTO: il cliente diretto (cliente_id, movimento sul conto di chi guarda) o il sotto-master di
  // prima linea (master_target_id, senza cliente). Per il sotto-master contano solo gli addebiti scritti
  // da chi guarda o sul conto del sotto-master stesso (le due forme che usa la piattaforma), mai quelli
  // di un terzo: sulla stessa spedizione condivisa ci sono anche gli addebiti fra fornitori (LOGIXIA →
  // Wave, che e' un figlio di MULTIEXPRESS nell'albero, 13/10/2026), e MULTIEXPRESS avrebbe fatturato a
  // Wave una rettifica che Wave deve a LOGIXIA. Fuori anche il conto 'proprio': sono i costi del
  // sotto-master sui contratti suoi, che chi sta sopra non gli fattura.
  if (p.get('vista') === 'rettifiche') {
    if (!dal || !al) return NextResponse.json({ error: 'Periodo mancante' }, { status: 400 })
    const base = () => adminDb.from('movimenti')
      .select('id,created_at,importo,descrizione,spedizione_id,cliente_id,master_id,master_target_id,conto,spedizioni(numero,master_id,dest_nome)')
      .eq('tipo', 'rettifica').not('spedizione_id', 'is', null)
      .gte('created_at', dal).lte('created_at', al)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
    const addebitoMioAlFiglio = (m: any) => (m.master_id === mine || m.master_id === m.master_target_id) && m.conto !== 'proprio'
    // Il movimento che il sotto-master scrive su SE STESSO e' un addebito verso di me solo se io sto nella
    // catena di quella spedizione (lib/catena-report): stessa regola del Report Rettifiche e dei report
    // di margine. Senza, la piattaforma (sopra MULTIEXPRESS, nessun contratto) si trovava "da fatturare
    // a MULTIEXPRESS" 2.037 rettifiche per 8.124 € (1-14/10/2026) che sono del fornitore di MULTIEXPRESS
    // e con lei non c'entrano.
    const soloInCatena = async (righe: any[]) => {
      const self = righe.filter((m: any) => m.master_id === m.master_target_id).map((m: any) => m.spedizione_id as string)
      if (!self.length) return righe
      const inCatena = await spedizioniInCatena(adminDb, mine as string, self)
      return righe.filter((m: any) => m.master_id !== m.master_target_id || inCatena.has(m.spedizione_id))
    }
    let mvs: any[] = []
    if (eCliente) mvs = utente.cliente_id ? await leggiTutto(() => base().eq('cliente_id', utente.cliente_id)) : []
    else if (!mine) mvs = []
    // Il cliente scelto vale anche per l'agente, purche' sia uno dei suoi: prima il ramo dell'agente
    // veniva per primo e il documento "Da fatturare a <cliente>" portava le rettifiche di tutti i suoi clienti.
    else if (clienteId) mvs = (agIds && !agIds.includes(clienteId)) ? [] : await leggiTutto(() => base().eq('master_id', mine).eq('cliente_id', clienteId))
    else if (agIds) mvs = await leggiTutto(() => base().eq('master_id', mine).in('cliente_id', agIds))
    else if (masterSel) {
      const fl = isMaster ? primaLineaId.get(masterSel) : null
      mvs = fl ? await soloInCatena((await leggiTutto(() => base().eq('master_target_id', fl).is('cliente_id', null)))
        .filter((m: any) => addebitoMioAlFiglio(m) && (subtreeSel || []).includes(m.spedizioni?.master_id))) : []
    } else {
      mvs = await leggiTutto(() => base().eq('master_id', mine).not('cliente_id', 'is', null))
      const figli = Array.from(new Set(primaLineaId.values()))
      if (isMaster && figli.length) mvs.push(...await soloInCatena((await leggiTutto(() => base().in('master_target_id', figli).is('cliente_id', null))).filter(addebitoMioAlFiglio)))
    }
    const cliIds = Array.from(new Set(mvs.map((m: any) => m.cliente_id).filter(Boolean))) as string[]
    const cli = new Map<string, any>()
    for (const c of await perBlocchi(cliIds, b => leggiTutto(() => adminDb.from('clienti').select('id,ragione_sociale,aliquota_iva').in('id', b).order('id')))) cli.set(c.id, c)
    return NextResponse.json(mvs.map((m: any) => {
      const c = m.cliente_id ? cli.get(m.cliente_id) : null
      return {
        id: m.id, created_at: m.created_at, spedizione_id: m.spedizione_id,
        numero: m.spedizioni?.numero || null, dest_nome: m.spedizioni?.dest_nome || null,
        // Addebito = positivo (l'importo del movimento e' negativo quando si addebita).
        importo: r2(-Number(m.importo || 0)),
        descrizione: senzaNomiFornitori(m.descrizione),
        diretto_id: m.cliente_id ? m.cliente_id : 'm:' + m.master_target_id,
        diretto_nome: m.cliente_id ? (c?.ragione_sociale || '—') : (nomeMaster.get(m.master_target_id) || '—'),
        aliquota_iva: m.cliente_id && c?.aliquota_iva != null ? Number(c.aliquota_iva) : 22,
      }
    }))
  }

  // ALBERO + NASCONDI-FORNITORI (stessa regola dell'Elenco spedizioni): su una spedizione condivisa un
  // master non vede le gambe di CHI GLI VENDE. Senza, il report di MULTIEXPRESS 1-14/10/2026 aveva
  // 94.521 righe per 59.755 pacchi: 17.399 gambe LOGIXIA col cliente "Wave ship (ingrosso)" e 17.367
  // gambe Wave col cliente "MULTIEXPRESS (ingrosso)", 175.954,75 € di "prezzo cliente" sommati come vendite.
  const ledgerNascosti = isMaster ? await ledgerFornitoriDaNascondere(adminDb, mine) : []

  const buildBase = () => {
    const filtroContratti = ownedContractNames.length > 0 && (!!subtreeSel || (!!reteIds && reteIds.length > 1))
    let q = db.from('spedizioni')
      .select(`${SPED_COLS}, clienti(ragione_sociale,agente), ${filtroContratti ? 'corrieri!inner(id,nome_contratto)' : 'corrieri(id,nome_contratto)'}`)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
    if (subtreeSel) q = q.in('master_id', subtreeSel)
    else if (clienteId) q = q.eq('cliente_id', clienteId).eq('master_id', mine)
    else if (eCliente) q = q.eq('cliente_id', utente.cliente_id)
    else if (reteIds && reteIds.length > 1) q = q.in('master_id', reteIds)
    else q = q.eq('master_id', mine)
    // Le gambe a monte hanno come cliente un ledger d'acquisto → fuori. Clienti reali e spedizioni
    // senza cliente restano sempre (per questo l'OR is.null).
    if (ledgerNascosti.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${ledgerNascosti.join(',')})`)
    if (filtroContratti) q = q.in('corrieri.nome_contratto', ownedContractNames)
    if (agIds) q = q.in('cliente_id', agIds)
    // Escludo le ANNULLATE (salvo filtro stato esplicito): sono rimborsate (addebito+rimborso = 0),
    // quindi il widget "Report Guadagno" (basato sui movimenti) le netta a 0. Contarle qui riga-per-riga
    // gonfiava i totali del report PDF e non coincideva col Guadagno. Ora report e Guadagno combaciano.
    if (!stato) q = q.not('stato', 'in', '(annullata)')
    if (stato) q = q.eq('stato', stato)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    if (contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (contrassegno === 'no') q = q.eq('contrassegno', 0)
    if (provincia) q = q.ilike('dest_provincia', provincia)
    const canale = p.get('canale')
    if (canale === 'portale') q = q.is('canale', null); else if (canale) q = q.eq('canale', canale)
    // STATO CONTRASSEGNO solo sulle spedizioni CON contrassegno: 'in_attesa' e' il valore di partenza di
    // tutte, e "In attesa" restituiva anche quelle senza contrassegno (1-14/10/2026: 98.686 su 101.897).
    const statoCod = p.get('statoContrassegno'); if (statoCod) q = q.gt('contrassegno', 0).eq('stato_contrassegno', statoCod)
    // Report SMS: servono solo le spedizioni con l'avviso inviato (il flag si accende a invio riuscito).
    if (p.get('notificaSms') === '1') q = q.eq('notifica_sms', true)
    return q
  }
  // Report COMPLETO: carico a blocchi (il DB tronca a 1000/query), altrimenti i totali/margini
  // sarebbero sbagliati per i master con molte spedizioni. Nessun limite pratico.
  let spedizioni: any[] = await leggiTutto(buildBase)

  // Tipo del contratto (via chiave di servizio: il permesso per colonna su corrieri puo' negarlo alla
  // sessione). Serve al filtro Vettore e a riconoscere le gambe-ponte della condivisione.
  const corrInfo = new Map<string, { tipo: string; nome: string }>()
  const corrIds = Array.from(new Set(spedizioni.map((s: any) => s.corriere_id).filter(Boolean))) as string[]
  for (const c of await perBlocchi(corrIds, b => leggiTutto(() => adminDb.from('corrieri').select('id,tipo,nome_contratto').in('id', b).order('id')))) {
    corrInfo.set(c.id, { tipo: c.tipo || '', nome: c.nome_contratto || '' })
  }
  // CONTRATTO: per nome, senza spazi ai bordi (le copie dei sotto-master a volte li hanno).
  if (fContratto) spedizioni = spedizioni.filter((s: any) => String(s.corrieri?.nome_contratto || '').trim() === fContratto)
  // VETTORE FISICO, non "prima parola del nome": per QUICK "GLS" trovava 0 spedizioni su 750, perche'
  // i suoi GLS si chiamano "Q GLS ..." e "PF CK ..." (contratti GLS diretti, riconosciuti dal tipo).
  if (fVettore) spedizioni = spedizioni.filter((s: any) => {
    const c = corrInfo.get(s.corriere_id)
    return !!c && vettoreFisico({ tipo: c.tipo, nome_contratto: c.nome }) === fVettore
  })

  // FONTE DI VERITÀ = i MOVIMENTI reali (quello che ogni livello ha effettivamente pagato).
  // Non ricalcolo i prezzi: un ricalcolo non replica agevolazioni misure/peso reale, fattore
  // per-corriere, ecc. e produce margini falsati. Uso gli importi realmente addebitati.
  const spedIds = spedizioni.map((s: any) => s.id)
  const clienteDi = new Map<string, string | null>(spedizioni.map((s: any) => [s.id, s.cliente_id || null]))
  const costoMine = new Map<string, number>()      // spedId -> costo del master loggato (mio)
  const costoTarget = new Map<string, number>()    // "spedId|masterId" -> costo di quel master
  const pagatoCliente = new Map<string, number>()  // spedId -> pagato dal cliente diretto
  // SOMMO 'spedizione' + 'rettifica' (signed): le rettifiche allineano il prezzo dopo una correzione.
  // ?rettifiche=escluse (lo passano Report Spedizioni e Report Fatture): SOLO il movimento della
  // spedizione, cosi' prezzo cliente, prezzo corriere e margine sono quelli della spedizione. Le
  // ripesature stanno nel Report Rettifiche, e in Fatture si contano per data dell'ADDEBITO
  // (?vista=rettifiche, sopra), non della spedizione.
  const tipiMov = p.get('rettifiche') === 'escluse' ? ['spedizione'] : ['spedizione', 'rettifica']
  const sumCliR = new Map<string, number>()
  const sumTargetR = new Map<string, number>()
  const sumRettCli = new Map<string, number>()   // solo RETTIFICHE lato cliente (l'aumento/variazione di prezzo)
  // Movimenti via adminDb per TUTTI tranne il CLIENTE: all'agente serve per popolare
  // pagatoCliente (RLS gli bloccherebbe i movimenti) e non gli restituisco i costi master
  // (usa calcAgente per il costo). Per il CLIENTE resto su `db` (RLS): così i costi master
  // (costoMine) NON gli arrivano.
  const mvDb = eCliente ? db : adminDb
  const movimenti = await perBlocchi(spedIds, b => leggiTutto(() => mvDb.from('movimenti')
    .select('spedizione_id,master_target_id,cliente_id,importo,tipo').in('tipo', tipiMov)
    .in('spedizione_id', b).order('spedizione_id', { ascending: true }).order('id', { ascending: true })))
  for (const mv of movimenti) {
    const imp = Number(mv.importo || 0)   // SIGNED
    if (mv.cliente_id) {
      // SOLO il cliente della spedizione. Sulle spedizioni condivise giacenze, resi e rettifiche dei
      // conti "(ingrosso)" sono registrati sulla spedizione d'ORIGINE, con cliente_id = il ledger:
      // sommati qui finivano nel prezzo del cliente finale (282224J028657, FUTURAL: 6,88 pagati,
      // 10,02 in report per le due rettifiche da 1,57 su "Wave ship" e "MULTIEXPRESS (ingrosso)").
      if (mv.cliente_id !== clienteDi.get(mv.spedizione_id)) continue
      sumCliR.set(mv.spedizione_id, (sumCliR.get(mv.spedizione_id) || 0) + imp)
      if (mv.tipo === 'rettifica') sumRettCli.set(mv.spedizione_id, (sumRettCli.get(mv.spedizione_id) || 0) + imp)
    }
    else if (mv.master_target_id) { const k = mv.spedizione_id + '|' + mv.master_target_id; sumTargetR.set(k, (sumTargetR.get(k) || 0) + imp) }
  }
  for (const [spedId, s] of sumCliR) pagatoCliente.set(spedId, r2(Math.abs(s)))
  for (const [k, s] of sumTargetR) {
    const [spedId, target] = k.split('|')
    const amt = r2(Math.abs(s))
    costoTarget.set(k, amt)
    if (target === mine) costoMine.set(spedId, amt)
  }

  // AGENTE: il suo COSTO non è un movimento del master, ma il prezzo del suo LISTINO AGENTE.
  const calcAgente = isAgente(utente) && (utente as any)?.listino_agente_id
    ? await creaCalcolatoreListinoCliente(supabase, (utente as any).listino_agente_id)
    : null

  // CONDIVISIONE (stesse due regole dell'Elenco spedizioni, perche' il report dia i suoi stessi numeri):
  // - gamba-ponte MIA (contratto comprato via codice, tipo 'moovexpress'): il costo vero e' il suo
  //   costo_spedizione, cioe' quanto pago al fornitore;
  // - spedizione d'ORIGINE di un mio sotto-master su un contratto che compro all'ingrosso: il costo vero
  //   e' quello che pago al fornitore sulla gamba col MIO ledger d'acquisto (stesso tracking), non il mio
  //   listino. Senza, 282224J033553 dava a MULTIEXPRESS costo 18,00 di listino e margine -4,98, mentre
  //   paga a Wave 11,73 e guadagna +1,29.
  const costoPonte = (s: any): number | null => {
    if (!isMaster || s.master_id !== mine || corrInfo.get(s.corriere_id)?.tipo !== 'moovexpress') return null
    const c = Number(s.costo_spedizione)
    return c > 0 ? c : null
  }
  const costoIngrossoAcq = new Map<string, number>()
  if (isMaster && mine && spedizioni.length) {
    const { data: ccAcq, error: errCc } = await adminDb.from('corrieri_condivisi')
      .select('cliente_ledger_id').eq('master_id', mine).eq('stato', 'attiva')
    if (errCc) throw new Error(errCc.message)
    const mieiLedger = Array.from(new Set((ccAcq || []).map((r: any) => r.cliente_ledger_id).filter(Boolean))) as string[]
    if (mieiLedger.length) {
      // Solo le righe che ne hanno bisogno: quelle col mio movimento o gamba-ponte hanno gia' il costo.
      const daCercare = spedizioni.filter((s: any) => s.tracking_number && !costoMine.has(s.id) && costoPonte(s) == null)
      const trk = Array.from(new Set(daCercare.map((s: any) => s.tracking_number))) as string[]
      const costoPerTrk = new Map<string, number>()
      for (const g of await perBlocchi(trk, b => leggiTutto(() => adminDb.from('spedizioni')
        .select('id,tracking_number,costo_totale').in('tracking_number', b).in('cliente_id', mieiLedger).order('id')))) {
        costoPerTrk.set(g.tracking_number, Number(g.costo_totale) || 0)
      }
      for (const s of daCercare) if (costoPerTrk.has(s.tracking_number)) costoIngrossoAcq.set(s.id, costoPerTrk.get(s.tracking_number)!)
    }
  }

  // Ripiego prezzo corriere (movimento mancante su spedizioni vecchie/rete): il MIO listino corriere.
  // Si costruisce solo se serve davvero: sono query pesanti (zone, fasce) per le poche righe senza costo.
  let calcMioCorr: ((s: any) => any) | null = null
  const nomeToMioCorr = new Map<string, string>()
  const servonoMieiContratti = isMaster && !calcAgente && spedizioni.some((s: any) =>
    !costoMine.has(s.id) && costoPonte(s) == null && !((costoIngrossoAcq.get(s.id) || 0) > 0))
  const flSenzaCosto = isMaster && !calcAgente && spedizioni.some((s: any) => {
    if (s.master_id === mine) return false
    const fl = primaLineaId.get(s.master_id)
    return !!fl && !costoTarget.has(s.id + '|' + fl)
  })
  if (servonoMieiContratti || flSenzaCosto) {
    const { data: miei, error: errMiei } = await adminDb.from('corrieri').select('id,nome_contratto').eq('master_id', mine)
    if (errMiei) throw new Error(errMiei.message)
    for (const c of (miei || [])) nomeToMioCorr.set((c as any).nome_contratto, (c as any).id)
  }
  if (servonoMieiContratti) {
    try { calcMioCorr = await creaCalcolatoreCorriere(adminDb, mine as string) } catch { calcMioCorr = null }
  }

  // Prezzo cliente di RETE = prezzo del MIO listino verso il figlio di PRIMA LINEA (quello che gli ho
  // assegnato), stesso corriere rimappato per nome. Solo come ripiego delle righe senza movimento.
  const parentListinoOf = new Map<string, string | null>()
  const calcPerListino = new Map<string, (s: any) => any>()
  if (flSenzaCosto) {
    const flIds = Array.from(new Set(Array.from(primaLineaId.values())))
    const { data: tms, error: errTms } = await adminDb.from('masters').select('id,parent_listino_id').in('id', flIds)
    if (errTms) throw new Error(errTms.message)
    for (const t of (tms || [])) parentListinoOf.set(t.id, (t as any).parent_listino_id || null)
    for (const lid of Array.from(new Set(Array.from(parentListinoOf.values()).filter(Boolean))) as string[]) calcPerListino.set(lid, await creaCalcolatoreListinoCliente(adminDb, lid))
  }

  // DATA CONSEGNA (colonna del report): per le spedizioni CONSEGNATE, la data_evento piu' recente dei
  // tracking_events (l'evento di consegna e' l'ultimo). Le non-consegnate restano senza data.
  // Lettura COMPLETA: a blocchi di 300 senza pagine si fermava a 1.000 eventi per blocco, e su
  // MULTIEXPRESS 1-7/10 il 57% delle consegnate restava senza eventi e prendeva la data dell'ultimo
  // aggiornamento della riga (un giorno diverso nel 24% dei casi).
  const consegnaMap = new Map<string, string>()
  const deliveredIds = spedizioni.filter((s: any) => /conseg/i.test(s.stato || '') && !/in[\s_]?conseg/i.test(s.stato || '')).map((s: any) => s.id)
  for (const e of await perBlocchi(deliveredIds, b => leggiTutto(() => adminDb.from('tracking_events')
    .select('spedizione_id,data_evento').in('spedizione_id', b).order('spedizione_id', { ascending: true }).order('id', { ascending: true })))) {
    const d = e.data_evento; if (!d) continue
    const prec = consegnaMap.get(e.spedizione_id)
    if (!prec || Date.parse(d) > Date.parse(prec)) consegnaMap.set(e.spedizione_id, d)
  }

  // DISTINTA (data + bordero) per le colonne Data_distinta/bda: NON esiste una FK spedizioni->distinte,
  // quindi NIENTE embed PostgREST `distinte(...)` (romperebbe TUTTA la query -> report vuoto). Lookup in
  // blocco per distinta_id.
  const distMap = new Map<string, any>()
  const distIds = Array.from(new Set(spedizioni.map((s: any) => s.distinta_id).filter(Boolean))) as string[]
  for (const d of await perBlocchi(distIds, b => leggiTutto(() => adminDb.from('distinte').select('id,data,bordero_id').in('id', b).order('id')))) {
    distMap.set(d.id, { data: d.data, bordero_id: d.bordero_id })
  }

  // ALIQUOTA IVA del diretto: quella della scheda cliente (vuota = 22%). Prima era 22% per tutti, e
  // gli 82 clienti allo 0% che hanno spedito fra il 15/09 e il 14/10/2026 ricevevano 12.010 € di IVA in
  // piu' nei PDF (10.331 € solo su Velox). I sotto-master non hanno un campo aliquota: 22%.
  const aliquotaCliente = new Map<string, number>()
  const cliIds = Array.from(new Set(spedizioni.map((s: any) => s.cliente_id).filter(Boolean))) as string[]
  for (const c of await perBlocchi(cliIds, b => leggiTutto(() => adminDb.from('clienti').select('id,aliquota_iva').in('id', b).order('id')))) {
    if (c.aliquota_iva != null) aliquotaCliente.set(c.id, Number(c.aliquota_iva))
  }

  const rows = spedizioni.map((s: any) => {
    // PREZZO CORRIERE = quello che ho pagato IO (mio movimento reale). Per l'agente = suo listino.
    // AGENTE SENZA LISTINO, o col listino che non copre quel contratto: non ha un costo suo, e il
    // ripiego finiva su costo_spedizione — il costo di chi sta SOPRA (per Andrea Mollica coincideva
    // con quello di MULTIEXPRESS, due livelli sopra il suo master, su tutte le 579 spedizioni di
    // ottobre). E' proprio il dato che non deve vedere. Meglio nessun numero che uno di qualcun altro.
    const agenteSenzaListino = isAgente(utente) && !calcAgente
    let prezzo_corriere: number | null = calcAgente
      ? (calcAgente(s)?.totale ?? null)
      : ((!agenteSenzaListino && costoMine.has(s.id)) ? costoMine.get(s.id)! : null)
    if (prezzo_corriere == null && isMaster) prezzo_corriere = costoPonte(s)
    if (prezzo_corriere == null && isMaster && (costoIngrossoAcq.get(s.id) || 0) > 0) prezzo_corriere = costoIngrossoAcq.get(s.id)!
    if (prezzo_corriere == null && calcMioCorr && !calcAgente && !agenteSenzaListino) {
      const nome = (s.corrieri as any)?.nome_contratto
      const mioCorr = (s.master_id === mine) ? s.corriere_id : (nome ? nomeToMioCorr.get(nome) : null)
      if (mioCorr) { const r = calcMioCorr({ ...s, corriere_id: mioCorr }); if (r && r.totale != null) prezzo_corriere = r.totale }
    }
    // PREZZO CLIENTE = prezzo del LISTINO che HO ASSEGNATO al mio diretto:
    //  - mio cliente diretto -> quello che paga (costo_totale);
    //  - spedizione di rete -> prezzo del mio listino verso il figlio di PRIMA LINEA (diretto sotto di me).
    let prezzo_cliente: number
    const flId = primaLineaId.get(s.master_id)
    if (calcAgente || s.master_id === mine || !isMaster) {
      // Agente e cliente: quello che il cliente ha REALMENTE pagato (movimenti); ripiego costo_totale.
      prezzo_cliente = pagatoCliente.has(s.id) ? pagatoCliente.get(s.id)! : Number(s.costo_totale || 0)
    } else if (flId && costoTarget.has(s.id + '|' + flId)) {
      // Rete: prezzo cliente = costo del figlio di PRIMA LINEA (quello che paga a me).
      prezzo_cliente = costoTarget.get(s.id + '|' + flId)!
    } else {
      // Ripiego: il mio listino verso di lui; poi costo_totale.
      const listinoId = flId ? parentListinoOf.get(flId) : null
      const nome = (s.corrieri as any)?.nome_contratto
      const mioCorr = nome ? nomeToMioCorr.get(nome) : null
      const calc = listinoId ? calcPerListino.get(listinoId) : null
      prezzo_cliente = Number(s.costo_totale || 0)
      if (calc && mioCorr) { const r = calc({ ...s, corriere_id: mioCorr }); if (r && r.totale != null) prezzo_cliente = r.totale }
    }
    // NB: per i clienti di un AGENTE il master vede come "Prezzo Cliente" il prezzo del CLIENTE
    // FINALE (costo_totale), coerente col report Guadagno (che somma i movimenti cliente = costo_totale).
    // (Prima qui si sovrascriveva col listino agente: era incoerente col guadagno.)
    // Master SOPRA il proprietario del contratto (nessun mio costo né mio listino per quel corriere):
    // semplice passaggio -> prezzo corriere = prezzo cliente -> margine 0 (niente margine totale rete).
    if (prezzo_corriere == null && !calcAgente && !agenteSenzaListino) prezzo_corriere = prezzo_cliente
    if (eCliente) prezzo_corriere = prezzo_cliente
    // DIRETTO = a chi il master fattura questa spedizione: il suo cliente, o il sotto-master di prima
    // linea da cui scende (mai il cliente finale di un sotto-master, a cui il master non fattura niente).
    // Il riepilogo e il Report Fatture raggruppano per questo; il dettaglio tiene il cliente finale.
    let diretto_id: string, diretto_nome: string, aliquota_iva = 22
    if (isMaster && s.master_id !== mine) {
      diretto_id = flId ? 'm:' + flId : 'rete'
      diretto_nome = (flId && nomeMaster.get(flId)) || 'Rete'
    } else if (s.cliente_id) {
      diretto_id = s.cliente_id
      diretto_nome = s.clienti?.ragione_sociale || s.mitt_nome || '—'
      if (aliquotaCliente.has(s.cliente_id)) aliquota_iva = aliquotaCliente.get(s.cliente_id)!
    } else {
      diretto_id = 'proprie'
      diretto_nome = 'Spedizioni proprie'
    }
    // Rettifica lato cliente = variazione di prezzo applicata (positivo = aumento, es. +5€).
    const rettifica = r2(-(sumRettCli.get(s.id) || 0))
    // COSTO DEL MASTER FUORI DAL REPORT DELL'AGENTE. Lo spread `...s` porta con se' la colonna
    // grezza costo_spedizione: dice quanto paga il MASTER al corriere. Per l'agente il "Prezzo
    // Corriere" e' il suo listino agente (calcAgente qui sopra), non il costo del master — che e'
    // esattamente il dato che il commento a inizio rotta dichiara di non volergli dare.
    // Il costo del master non esce ne' verso l'agente ne' verso il CLIENTE: dice quanto paghiamo
    // noi al corriere, cioe' il margine.
    const { costo_spedizione: _costoMaster, ...sPulita } = s
    const base = (calcAgente || agenteSenzaListino || eCliente) ? sPulita : s
    return {
      ...base,
      costo_totale: prezzo_cliente,          // "Prezzo Cliente" nel report (già comprensivo della rettifica)
      prezzo_corriere,                        // "Prezzo Corriere" (quello che pago io)
      rettifica,                              // colonna "Rettifica" (aumento/variazione di prezzo)
      data_consegna: consegnaMap.get(s.id) || null,   // colonna "Data_consegna" del report
      distinte: distMap.get(s.distinta_id) || null,   // { data, bordero_id } per Data_distinta/bda (lookup, non embed)
      diretto_id, diretto_nome, aliquota_iva,
    }
  })
  return NextResponse.json(rows)
}

// Qui c'era una POST che registrava un report SENZA file: nessuna pagina la chiamava piu' (i report
// si salvano da /api/reports/salva, col file), e restava solo una porta per mettere righe vuote
// nell'elenco del master, aperta a chiunque fosse loggato. Tolta.
