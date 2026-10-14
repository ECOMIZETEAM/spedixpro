import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'
import { gestisceLaRete, vedeLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { risaliCatena, destinatarioCod } from '@/lib/contrassegni-catena'
import { detentoreContratto, nomeContrattoNormalizzato } from '@/lib/contratto-per-nome'
import { gambePerTracking, catenaDaCorriere, destinatarioCodCondivisione, type LivelloCondivisione } from '@/lib/condivisione-catena'

// Una selezione grande di contrassegni condivisi legge la fila di ogni contratto: non deve scadere a metà.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // Rotta del portale master. Il solo `master_id` non e' un permesso: senza questa riga un'utenza
  // cliente si leggeva le distinte contrassegni di TUTTI i clienti del master (importi incassati,
  // numeri di spedizione, ragioni sociali). Il POST qui sotto era gia' protetto con gestisceLaRete,
  // il GET no. Il cliente le sue distinte le vede da /api/cliente/contrassegni/*; l'agente resta
  // dentro, filtrato sui suoi clienti poco piu' sotto.
  if (!vedeLaRete(utente)) return NextResponse.json([])
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato: le sue distinte hanno target_master_id
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')

  let query = supabase.from('distinte_contrassegni')
    .select('*, clienti(ragione_sociale), distinte_contrassegni_righe(id,numero_spedizione,importo_cod,importo_sistema,spedizioni(dest_nome,rif_destinatario,mitt_nome,created_at))')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })

  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (masterSel) query = query.eq('target_master_id', masterSel)
  else if (clienteId) query = query.eq('cliente_id', clienteId)
  if (stato) query = query.eq('stato', stato)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')

  const { data } = await query
  const distinte = data || []
  const masterIds = [...new Set(distinte.map((d:any)=>d.target_master_id).filter(Boolean))]
  if (masterIds.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminC = createAdminSupabase()
    const { data: masters } = await adminC.from('masters').select('id,nome').in('id', masterIds)
    const mMap: Record<string,any> = {}
    ;(masters||[]).forEach((m:any)=>{ mMap[m.id] = m })
    distinte.forEach((d:any)=>{ if (d.target_master_id && mMap[d.target_master_id]) d.target_master = { nome: mMap[d.target_master_id].nome } })
  }
  // Distinte "proprie" (nessun cliente né sotto-master): COD del master stesso, già incassato → etichetta
  // esplicita così in elenco non appaiono senza destinatario.
  distinte.forEach((d:any)=>{ if (!d.cliente_id && !d.target_master_id && !d.clienti) d.clienti = { ragione_sociale: 'Propri (già incassati)' } })
  return NextResponse.json(distinte)
}

// CREA DISTINTE DA LISTA CONTRASSEGNI — il livello paga chi gli sta DIRETTAMENTE sotto.
//
// Due casi, con la stessa regola del file del corriere (lib/contrassegni-catena.ts):
//  - spedizione di un MIO cliente → distinta verso il cliente (come sempre);
//  - spedizione della mia RETE → distinta verso il sotto-master sotto di me: è l'ANTICIPO. Il
//    detentore (es. MULTIEXPRESS) paga il sotto-master prima che il corriere gli versi i soldi; quando
//    poi arriva il file del corriere quei contrassegni risultano già nelle sue distinte e non si
//    ripagano: li trattiene lui.
//
// Il guasto del 22/09: MULTIEXPRESS selezionava contrassegni della rete di QUICK e la distinta
// "spariva". La rotta prendeva solo le spedizioni con master_id = il mio, cioè quelle dei miei
// clienti diretti: le altre venivano scartate in silenzio.
//
// L'anticipo NON tocca lo stato del contrassegno sulla spedizione: quello è lo stato del CLIENTE
// finale, e lo muovono solo le distinte verso il cliente. Se lo toccasse, il cliente vedrebbe
// "pagato" perché il detentore ha pagato il sotto-master, mentre a lui non è arrivato niente.
// Ogni livello vede il colore della SUA distinta (vedi GET /api/contrassegni).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // Da qui si scrive con la chiave di servizio: il permesso va controllato a mano (lib/ruoli.ts).
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio: string = utente.master_id
  const body = await req.json().catch(() => ({}))
  const spedizioneIds: string[] = Array.isArray(body?.spedizioneIds) ? body.spedizioneIds.filter(Boolean).map(String) : []
  if (!spedizioneIds.length) return NextResponse.json({ error: 'Nessuna spedizione' }, { status: 400 })

  const admin = createAdminSupabase()
  const spedizioni: any[] = []
  for (let i = 0; i < spedizioneIds.length; i += 300) {
    const { data } = await admin.from('spedizioni')
      .select('id,master_id,cliente_id,corriere_id,contrassegno,numero,stato_contrassegno,distinta_contrassegno_id,tracking_number')
      .in('id', spedizioneIds.slice(i, i + 300)).gt('contrassegno', 0)
    spedizioni.push(...(data || []))
  }

  // PACCHI CONDIVISI: il contrassegno è del PACCO, non della riga. Un pacco condiviso ha più gambe (la
  // prima un ponte, poi quelle dei venditori fino al detentore) e il file del corriere e le rimesse
  // lavorano sulla gamba ORIGINANTE. Qui una gamba del venditore (LOGIXIA su SDA EXPRESS L, GTS sul GLS che
  // rivende a spedizioni 2000: cliente = il ledger del compratore) diventava una "distinta al cliente" verso
  // quel ledger, e il file o la rimessa successivi pagavano lo stesso contrassegno una seconda volta, su
  // un'altra riga che l'anti-doppio per livello non riconosce. E l'albero non è la fila: MULTI che anticipava
  // il ponte di spedizioni 2000 pagava 2000 saltando GTS, da cui 2000 lo compra. Ora ogni gamba si riporta
  // all'originante e il destinatario è il livello sotto di me nella fila del contratto, col suo conto.
  const condivise = new Map<string, any>()   // id della riga scelta → riga originante (con contratto)
  {
    let gambeDi: Awaited<ReturnType<typeof gambePerTracking>>
    try { gambeDi = await gambePerTracking(admin, spedizioni.map(s => s.tracking_number).filter(Boolean)) }
    catch { return NextResponse.json({ error: 'Lettura delle spedizioni non riuscita: riprova. Nessuna distinta creata.' }, { status: 500 }) }
    const origIds = new Set<string>()
    for (const s of spedizioni) {
      const g = s.tracking_number ? (gambeDi.get(s.tracking_number) || []) : []
      if (g.length > 1 && g[0].tipo === 'moovexpress') origIds.add(g[0].spedizioneId)
    }
    if (origIds.size) {
      const { data: orig, error: eO } = await admin.from('spedizioni')
        .select('id,master_id,cliente_id,corriere_id,contrassegno,numero,stato_contrassegno,distinta_contrassegno_id,tracking_number,corrieri(tipo,nome_contratto)')
        .in('id', [...origIds])
      if (eO) return NextResponse.json({ error: 'Contrassegni condivisi non leggibili: riprova.' }, { status: 500 })
      const perTrk = new Map((orig || []).map((o: any) => [o.tracking_number, o]))
      for (const s of spedizioni) {
        const o = s.tracking_number ? perTrk.get(s.tracking_number) : null
        if (o) condivise.set(s.id, o)
      }
    }
  }

  const escluse: { numero: string; motivo: string }[] = []
  const escludi = (s: any, motivo: string) => escluse.push({ numero: s.numero || '', motivo })

  // Chi paga chi: la catena di un master è la stessa per tutte le sue spedizioni, si risale una volta.
  const catene = new Map<string, string[]>()
  const catenaDi = async (mid: string) => {
    if (!catene.has(mid)) catene.set(mid, await risaliCatena(admin, mid))
    return catene.get(mid)!
  }
  const versoCliente: any[] = [], versoRete: { s: any; target: string; catena: string[]; fila?: boolean; ledger?: boolean }[] = []
  const pacchiVisti = new Set<string>()
  // La fila di un contratto è la stessa per tutti i suoi pacchi: si legge una volta per corriere.
  const file = new Map<string, LivelloCondivisione[]>()
  for (const scelta of spedizioni) {
    const o = condivise.get(scelta.id)
    if (o) {
      if (pacchiVisti.has(o.id)) continue          // due gambe dello stesso pacco nella stessa selezione
      pacchiVisti.add(o.id)
      const c: any = Array.isArray(o.corrieri) ? o.corrieri[0] : o.corrieri
      if (!file.has(o.corriere_id)) {
        try { file.set(o.corriere_id, await catenaDaCorriere(admin, o.corriere_id, { master: o.master_id, nomeContratto: c?.nome_contratto || '' })) }
        catch { escludi(scelta, 'contratto non leggibile, riprova'); continue }
      }
      const d = destinatarioCodCondivisione(file.get(o.corriere_id)!, mio, o.cliente_id)
      if (d.fuori) { escludi(scelta, 'fuori dalla tua rete'); continue }
      if (d.ruolo !== 'cliente') {
        if (!d.target_master_id) { escludi(scelta, 'nessun livello sotto di te in questo contratto'); continue }
        versoRete.push({ s: o, target: d.target_master_id, catena: [], fila: true, ledger: d.ledger })
        continue
      }
      // Verso il cliente paga solo il master del pacco: la riga è del cliente, che alcune colonne le può
      // riscrivere, e "primo della fila" deve voler dire davvero "il pacco è mio".
      if (o.master_id !== mio) { escludi(scelta, 'fuori dalla tua rete'); continue }
      if (!d.cliente_id) { escludi(scelta, 'spedizione tua, senza cliente: non c\'è nessuno da pagare'); continue }
      if (o.stato_contrassegno === 'annullato') { escludi(scelta, 'reso: il contrassegno non si incasserà'); continue }
      if (o.distinta_contrassegno_id || (o.stato_contrassegno && o.stato_contrassegno !== 'in_attesa')) { escludi(scelta, 'già in distinta o pagato'); continue }
      versoCliente.push(o)
      continue
    }
    const s = scelta
    const catena = await catenaDi(s.master_id)
    const dest = destinatarioCod(catena, mio, s.cliente_id)
    if (dest.fuori) { escludi(s, 'fuori dalla tua rete'); continue }
    if (dest.target_master_id) { versoRete.push({ s, target: dest.target_master_id, catena }); continue }
    if (!dest.cliente_id) { escludi(s, 'spedizione tua, senza cliente: non c\'è nessuno da pagare'); continue }
    // Verso il cliente vale lo stato della spedizione, che è proprio lo stato del cliente. Lo stesso
    // COD non va in due distinte: l'indice unico uniq_righe_cod_sped_per_master lo garantisce nel
    // database, ma qui si scarta prima, così non si creano teste di distinta a vuoto.
    if (s.stato_contrassegno === 'annullato') { escludi(s, 'reso: il contrassegno non si incasserà'); continue }
    if (s.distinta_contrassegno_id || (s.stato_contrassegno && s.stato_contrassegno !== 'in_attesa')) { escludi(s, 'già in distinta o pagato'); continue }
    versoCliente.push(s)
  }

  // ── ANTICIPO VERSO LA RETE: tre controlli prima di pagare il sotto-master.
  const gruppi = new Map<string, any[]>()   // 'c:<cliente>' | 'm:<sotto-master>'
  for (const s of versoCliente) {
    const k = 'c:' + s.cliente_id
    if (!gruppi.has(k)) gruppi.set(k, [])
    gruppi.get(k)!.push(s)
  }
  if (versoRete.length) {
    const ids = versoRete.map(x => x.s.id)
    // 1) già in una MIA distinta: l'anti-doppio è per livello, come nel file del corriere.
    // 2) già arrivato col file del corriere: sta in "Da caricare" e si carica da lì.
    const giaMie = new Set<string>(), inSosta = new Set<string>()
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300)
      const [r1, r2] = await Promise.all([
        admin.from('distinte_contrassegni_righe').select('spedizione_id').eq('distinta_master_id', mio).in('spedizione_id', chunk),
        admin.from('cod_da_caricare').select('spedizione_id').eq('master_id', mio).in('spedizione_id', chunk),
      ])
      for (const x of (r1.data || [])) giaMie.add((x as any).spedizione_id)
      for (const x of (r2.data || [])) inSosta.add((x as any).spedizione_id)
    }
    // 3) il detentore del contratto deve essere IO o qualcuno SOPRA di me. Se il contratto è di un
    //    sotto-master (i suoi contratti propri: QUICK ne ha 13), il corriere versa a lui, non a me:
    //    anticipandolo pagherei soldi che non mi arriveranno mai.
    const corrIds = [...new Set(versoRete.map(x => x.s.corriere_id).filter(Boolean))]
    const corr = new Map<string, any>()
    for (let i = 0; i < corrIds.length; i += 300) {
      const { data } = await admin.from('corrieri').select('id,master_id,nome_contratto').in('id', corrIds.slice(i, i + 300))
      for (const c of (data || [])) corr.set((c as any).id, c)
    }
    const detentori = new Map<string, string>()
    const detentoreDi = async (c: any) => {
      const k = c.master_id + '|' + nomeContrattoNormalizzato(c.nome_contratto)
      if (!detentori.has(k)) detentori.set(k, (await detentoreContratto(admin, c.master_id, c.nome_contratto)).detentore)
      return detentori.get(k)!
    }
    const nomiMaster = new Map<string, string>()
    for (const { s, target, catena, fila, ledger } of versoRete) {
      if (giaMie.has(s.id)) { escludi(s, 'già in una tua distinta'); continue }
      if (inSosta.has(s.id)) { escludi(s, 'già arrivato col file del corriere: caricalo da Distinte contrassegni'); continue }
      if (s.stato_contrassegno === 'annullato') { escludi(s, 'reso: il contrassegno non si incasserà'); continue }
      // Pacco condiviso: la fila del contratto dice già che i soldi passano da me (sto fra il detentore e
      // chi mi compra), il controllo sul detentore per nome qui sotto non serve e sbaglierebbe.
      if (fila) {
        // Un salto a collegamento (si paga sul ledger) e uno d'albero verso lo stesso master non vanno nella
        // stessa distinta: la compensazione sceglie un conto solo per tutta la distinta.
        const k = (ledger ? 'l:' : 'm:') + target
        if (!gruppi.has(k)) gruppi.set(k, [])
        gruppi.get(k)!.push(s)
        continue
      }
      const c = s.corriere_id ? corr.get(s.corriere_id) : null
      if (!c) { escludi(s, 'contratto non trovato'); continue }
      const det = await detentoreDi(c)
      if (catena.indexOf(det) === -1) { escludi(s, 'contratto non riconosciuto nella tua rete'); continue }
      if (catena.indexOf(det) < catena.indexOf(mio)) {
        if (!nomiMaster.has(det)) {
          const { data: m } = await admin.from('masters').select('nome').eq('id', det).maybeSingle()
          nomiMaster.set(det, (m as any)?.nome || 'un sotto-master')
        }
        escludi(s, `contratto proprio di ${nomiMaster.get(det)}: il contrassegno lo incassa lui`)
        continue
      }
      const k = 'm:' + target
      if (!gruppi.has(k)) gruppi.set(k, [])
      gruppi.get(k)!.push(s)
    }
  }

  const distinte: any[] = []
  for (const [k, sped] of gruppi) {
    const alCliente = k.startsWith('c:')
    const totale = Math.round(sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0) * 100) / 100
    // Numero progressivo PER MASTER (indice unico uniq_distinte_cod_master_numero): se due creazioni
    // concorrenti scelgono lo stesso numero, il secondo riprova col successivo. Stessa regola del
    // caricamento da file/rimessa, cosi' la numerazione resta unica e coerente.
    let distinta: any = null
    for (let tentativo = 0; tentativo < 8 && !distinta; tentativo++) {
      const { data: ultima } = await admin.from('distinte_contrassegni')
        .select('numero').eq('master_id', mio).order('numero', { ascending: false }).limit(1).maybeSingle()
      const numero = Number(ultima?.numero || 1000) + 1 + tentativo
      const { data, error } = await admin.from('distinte_contrassegni').insert({
        master_id: mio, numero,
        cliente_id: alCliente ? k.slice(2) : null,
        target_master_id: alCliente ? null : k.slice(2),
        totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
      }).select('id,numero').single()
      if (!error && data?.id) distinta = data
      else if (error && !String(error.message || '').includes('uniq_distinte_cod_master_numero')) break
    }
    if (!distinta?.id) { sped.forEach(s => escludi(s, 'distinta non creata, riprova')); continue }

    // Le RIGHE devono esistere: se l'indice unico rifiuta l'INSERT (un COD gia' in una mia distinta)
    // la testata va rimossa, altrimenti resta una distinta col totale pieno e zero righe.
    const { error: errRighe } = await admin.from('distinte_contrassegni_righe').insert(sped.map(s => ({
      distinta_id: distinta.id, spedizione_id: s.id,
      numero_spedizione: s.numero, importo_cod: Number(s.contrassegno), importo_sistema: Number(s.contrassegno),
    })))
    if (errRighe) {
      await admin.from('distinte_contrassegni').delete().eq('id', distinta.id)
      sped.forEach(s => escludi(s, 'già in una tua distinta'))
      continue
    }
    if (alCliente) {
      await admin.from('spedizioni').update({
        stato_contrassegno: 'in_distinta', distinta_contrassegno_id: distinta.id,
      }).in('id', sped.map(s => s.id))
    }
    distinte.push(distinta)
  }

  // Mai più "distinta creata" quando non è nato niente: se tutto è stato escluso si dice perché.
  if (!distinte.length) {
    return NextResponse.json({ error: 'Nessuna distinta creata.', escluse }, { status: 400 })
  }
  return NextResponse.json({ success: true, distinte, create: distinte.length, saltate: escluse.length, escluse })
}
