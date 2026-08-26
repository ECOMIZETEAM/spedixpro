import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'
import { noloCliente, noloMaster, addebitaResi, pagatoDaMaster, type RigaReso } from '@/lib/reso-prezzi'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const clienteIdRaw = req.nextUrl.searchParams.get('cliente_id')
  // "m:<masterId>" = sotto-master agganciato: le sue distinte hanno target_master_id
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (masterSel) query = query.eq('target_master_id', masterSel)
  else if (clienteId) query = query.eq('cliente_id', clienteId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  const { data } = await query
  // Ramo catena (cliente_id NULL, target_master_id valorizzato): in pagina va mostrato il
  // SOTTO-MASTER destinatario del reso, altrimenti la riga resta anonima ('-').
  const lista = data || []
  const targetIds = [...new Set(lista.map((d: any) => d.target_master_id).filter(Boolean))]
  if (targetIds.length) {
    const adminDb = createAdminSupabase()
    const { data: ms } = await adminDb.from('masters').select('id,nome').in('id', targetIds)
    const nomi = new Map((ms || []).map((m: any) => [m.id, m.nome]))
    for (const d of lista) if ((d as any).target_master_id) (d as any).sottomaster = nomi.get((d as any).target_master_id) || null
  }
  return NextResponse.json(lista)
}

// LE RIGHE DELLA PROPRIA CATENA.
//
// Chi scansiona il pacco rientrato apre la catena, ma finora non veniva addebitato di niente: il
// reso gli compariva a carico solo se era passato dalla giacenza. Il costo pero' esiste comunque —
// il corriere il rientro glielo fa pagare — e va registrato come per ogni altro livello, salendo
// fino a chi possiede davvero il contratto.
// Non c'e' rischio di doppio addebito: se un livello e' gia' stato addebitato (per esempio perche'
// il padre gli ha gia' girato la distinta) l'indice unico nel database lo respinge.
async function righeCatenaPropria(adminDb: any, mioMasterId: string, voci: any[]): Promise<RigaReso[]> {
  const { catenaContratto } = await import('@/lib/giacenza-cascata')
  const righe: RigaReso[] = []
  const cache = new Map<string, { masterId: string; corriereId: string }[]>()
  for (const v of (voci || [])) {
    const { data: sp } = await adminDb.from('spedizioni')
      .select('id,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta,corrieri(nome_contratto,master_id)')
      .eq('id', v.id).maybeSingle()
    const nome = (sp as any)?.corrieri?.nome_contratto || null
    const owner = (sp as any)?.corrieri?.master_id || null
    if (!sp || !nome || !owner) continue
    if (!cache.has(nome)) cache.set(nome, await catenaContratto(adminDb, mioMasterId, owner, nome))
    for (const liv of cache.get(nome)!) {
      righe.push({
        spedizione_id: sp.id, master_target_id: liv.masterId, master_owner_id: liv.masterId,
        corriere_id: liv.corriereId,
        nolo: (await noloMaster(adminDb, liv.masterId, liv.corriereId, sp)) || 0,
        pagato: await pagatoDaMaster(adminDb, sp.id, liv.masterId),
      })
    }
  }
  return righe
}

// Voci gia' chiuse in una distinta di reso di questo master: si scartano.
// Senza questo, un secondo invio dello stesso elenco — il POST che va in timeout su una distinta
// lunga e l'operatore che riclicca — creava una seconda distinta e riaddebitava tutto. L'indice
// unico nel database impedisce il doppio movimento, ma la distinta doppia restava.
async function escludiGiaInDistinta(adminDb: any, masterId: string, voci: any[]): Promise<any[]> {
  const { data } = await adminDb.from('distinte_resi').select('voci').eq('master_id', masterId)
  const gia = new Set<string>()
  for (const d of (data || [])) for (const v of (Array.isArray(d?.voci) ? d.voci : [])) if (v?.id) gia.add(v.id)
  return (voci || []).filter((v: any) => !gia.has(v?.id))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  // Un cliente non chiude distinte di reso: le sue le fa il suo master (come in network/resi/accetta).
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })   // POST addebita il reso: solo chi gestisce la rete (il GET sopra resta con isAgente)
  const body = await req.json()
  // `voci` viene filtrato piu' sotto alle sole spedizioni della propria rete: serve riassegnabile.
  const { spedizioniIds, clienteId, targetMasterId, totale } = body
  let voci = body.voci
  const adminDb = createAdminSupabase()

  // ── RAMO CATENA: reso verso un master figlio (addebito del prezzo che LUI ha pagato) ──
  if (targetMasterId && !clienteId) {
    // Il master bersaglio arriva dal browser e finora non veniva MAI verificato, mentre tutte le
    // scritture di questo ramo usano il client amministrativo che scavalca l'isolamento: si poteva
    // quindi addebitare un reso a QUALSIASI master, compreso il proprio padre (il suo importo e'
    // ricavabile dai movimenti di catena gia' scritti). Qui si richiede che il bersaglio sia un
    // DISCENDENTE di chi chiama, come si fa gia' in /api/movimenti/crea e in /api/spedizioni/crea.
    {
      let cur: string | null = targetMasterId
      let discendente = false
      for (let i = 0; i < 20 && cur; i++) {
        const { data: p } = await adminDb.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        cur = (p as any)?.parent_master_id || null
        if (cur && cur === utente?.master_id) { discendente = true; break }
      }
      if (!discendente) return NextResponse.json({ error: 'Master non autorizzato' }, { status: 403 })
    }
    // Le voci arrivano anch'esse dal browser: si tengono solo le spedizioni passate DAL BERSAGLIO,
    // non genericamente dalla rete di chi chiama.
    //
    // Con il sotto-albero del chiamante due rami fratelli si confondevano: un master con due
    // sotto-master A e B poteva addebitare ad A i resi delle spedizioni di B — spedizioni che ad A
    // non sono mai passate — e A se li vedeva scalare dal credito, calcolati sul suo listino.
    // Legandole al bersaglio il controllo diventa piu' stretto senza perdere un caso legittimo:
    // una spedizione di un sotto-sotto-master sta comunque nel sotto-albero della sua prima linea.
    {
      const ids = (voci || []).map((v: any) => v?.id).filter(Boolean)
      if (!ids.length) return NextResponse.json({ error: 'Nessuna spedizione nella distinta' }, { status: 400 })
      const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
      const reteTarget = await sottoAlberoMasterIds(adminDb, targetMasterId)
      const { data: ok } = await adminDb.from('spedizioni').select('id').in('id', ids).in('master_id', reteTarget)
      const consentiti = new Set((ok || []).map((r: any) => r.id))
      const scartate = ids.length - consentiti.size
      if (scartate > 0) console.warn('[RESI][CATENA] voci non passate dal bersaglio, scartate:', scartate)
      voci = (voci || []).filter((v: any) => consentiti.has(v?.id))
      if (!voci.length) return NextResponse.json({ error: 'Nessuna spedizione valida nella distinta' }, { status: 400 })
      voci = await escludiGiaInDistinta(adminDb, utente!.master_id!, voci)
      if (!voci.length) return NextResponse.json({ error: 'Queste LDV sono già in una distinta di reso' }, { status: 409 })
    }
    const { count: cM } = await supabase.from('distinte_resi').select('*', {count:'exact',head:true}).eq('master_id', utente?.master_id)
    const numeroM = (cM||0) + 1
    // Il totale della distinta di RETE = quanto viene ADDEBITATO al sotto-master (il prezzo che
    // LUI aveva pagato), NON il prezzo del cliente finale: ogni livello vede il proprio prezzo.
    // Si calcola voce per voce nel loop e si scrive alla fine (il 'totale' della UI e' a prezzo cliente).
    let totaleCatena = 0
    const { data: distintaM, error: errM } = await supabase.from('distinte_resi').insert({
      master_id: utente?.master_id, cliente_id: null, target_master_id: targetMasterId,
      numero: numeroM, totale_ldv: (voci||[]).length, totale: 0, voci, stato: 'chiusa',
    }).select().single()
    if (errM) return NextResponse.json({ error: errM.message }, { status: 400 })
    // Il prezzo lo decide il listino corrieri DEL SOTTO-MASTER; quanto aveva pagato l'andata resta
    // il ripiego per chi il reso non ce l'ha configurato. La regola e l'anti-doppio-addebito stanno
    // nel database, e tutte le voci si scrivono in una transazione sola.
    const righe: RigaReso[] = []
    for (const v of (voci || [])) {
      await adminDb.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', v.id)
      const { data: spD } = await adminDb.from('spedizioni')
        .select('colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta,corrieri(nome_contratto)')
        .eq('id', v.id).maybeSingle()
      const nomeContratto = (spD as any)?.corrieri?.nome_contratto || null
      const suoCorriere = await corriereDiMasterPerNome(adminDb, targetMasterId, nomeContratto)
      righe.push({
        spedizione_id: v.id,
        master_target_id: targetMasterId,
        master_owner_id: utente!.master_id!,
        corriere_id: suoCorriere,
        nolo: (suoCorriere && spD ? await noloMaster(adminDb, targetMasterId, suoCorriere, spD) : null) || 0,
        pagato: await pagatoDaMaster(adminDb, v.id, targetMasterId),
      })
    }
    try {
      for (const e of await addebitaResi(adminDb, righe, user.id)) totaleCatena += Number(e.importo || 0)
      // ...e la catena di chi scansiona, dal suo livello fino al detentore del contratto.
      await addebitaResi(adminDb, await righeCatenaPropria(adminDb, utente!.master_id!, voci), user.id)
    } catch (e) { console.error('Errore addebito reso master:', e) }
    await supabase.from('distinte_resi').update({ totale: totaleCatena }).eq('id', distintaM.id)
    return NextResponse.json({ id: distintaM.id, numero: numeroM })
  }
  // ── RAMO CLIENTE ──
  // Anche qui le voci arrivano dal browser: devono essere spedizioni DI QUEL cliente e della
  // propria rete, altrimenti si potrebbero addebitare a un cliente le LDV di un altro.
  {
    const ids = (voci || []).map((v: any) => v?.id).filter(Boolean)
    if (!clienteId || !ids.length) return NextResponse.json({ error: 'Nessuna spedizione nella distinta' }, { status: 400 })
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(adminDb, utente!.master_id!)
    const { data: ok } = await adminDb.from('spedizioni').select('id')
      .in('id', ids).eq('cliente_id', clienteId).in('master_id', rete)
    const consentiti = new Set((ok || []).map((r: any) => r.id))
    if (ids.length !== consentiti.size) console.warn('[RESI][CLIENTE] voci non del cliente o fuori rete, scartate:', ids.length - consentiti.size)
    voci = (voci || []).filter((v: any) => consentiti.has(v?.id))
    if (!voci.length) return NextResponse.json({ error: 'Nessuna spedizione valida nella distinta' }, { status: 400 })
    voci = await escludiGiaInDistinta(adminDb, utente!.master_id!, voci)
    if (!voci.length) return NextResponse.json({ error: 'Queste LDV sono già in una distinta di reso' }, { status: 409 })
  }
  const { count } = await supabase.from('distinte_resi').select('*', {count:'exact',head:true}).eq('master_id', utente?.master_id)
  const numero = (count||0) + 1
  const { data: cliRec } = await supabase.from('clienti').select('listino_cliente_id').eq('id', clienteId).single()
  // Il NOLO lo calcola il motore tariffe (qui), la PERCENTUALE e l'addebito li fa il database:
  // stessa regola dello svincolo giacenza, e tutte le voci in una transazione sola.
  const righeCli: RigaReso[] = []
  for (const v of (voci || [])) {
    await supabase.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', v.id)
    const { data: sp } = await supabase.from('spedizioni')
      .select('costo_totale,dest_provincia,dest_cap,dest_paese,dest_citta,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,corriere_id')
      .eq('id', v.id).single()
    const nolo = await noloCliente(adminDb, sp, cliRec?.listino_cliente_id)
    righeCli.push({
      spedizione_id: v.id,
      cliente_id: clienteId,
      master_owner_id: utente!.master_id!,
      corriere_id: sp?.corriere_id || null,
      // ripiego se il listino non e' calcolabile: il costo totale, mai negativo
      nolo: nolo != null ? nolo : Math.max(0, Number(sp?.costo_totale || 0)),
    })
  }

  const { data: distinta, error } = await supabase.from('distinte_resi').insert({
    master_id: utente?.master_id,
    cliente_id: clienteId,
    numero,
    totale_ldv: spedizioniIds.length,
    totale: 0,   // scritto dopo l'addebito: in distinta va quello che e' stato addebitato davvero
    voci,
    stato: 'chiusa',
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  let totaleReso = 0
  try {
    for (const e of await addebitaResi(adminDb, righeCli, user.id)) totaleReso += Number(e.importo || 0)
    // ...e la catena dei master, dal master del cliente fino al detentore del contratto.
    await addebitaResi(adminDb, await righeCatenaPropria(adminDb, utente!.master_id!, voci), user.id)
  } catch (e) { console.error('Errore addebito reso cliente:', e) }
  await supabase.from('distinte_resi').update({ totale: totaleReso }).eq('id', distinta.id)
  return NextResponse.json({ id: distinta.id, numero })
}