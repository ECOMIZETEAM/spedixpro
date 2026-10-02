import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ listino: null, corrieri: [], fasce: [], supplementi: [] })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = sola lettura

  // Ogni corriere ha la SUA riga listini_corrieri (col suo fattore_volume, solo_peso_reale, fasce).
  const { data: listiniMaster } = await supabase.from('listini_corrieri')
    .select('*').eq('master_id', utente?.master_id)
    .order('created_at', { ascending: true, nullsFirst: true }).order('id', { ascending: true })
  const masterListinoIds = [...new Set((listiniMaster || []).map((l: any) => l.id).filter(Boolean))]
  const _inIds = masterListinoIds.length ? masterListinoIds : ['00000000-0000-0000-0000-000000000000']

  const { searchParams } = new URL(req.url)
  const corriereId = searchParams.get('corriere')

  // Elenco corrieri del listino = UNIONE tra le righe listini_corrieri (fonte primaria, una per
  // corriere) e la vecchia tabella di aggancio (storica/incompleta): così nessun contratto resta nascosto.
  const _mappaCorr = new Map<string, any>()
  for (const l of (listiniMaster || [])) { if (l.corriere_id) _mappaCorr.set(l.corriere_id, null) }
  const { data: corrieriAssegnati } = await supabase.from('listini_corrieri_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .in('listino_id', _inIds)
  for (const r of (corrieriAssegnati || [])) { const c = (r as any).corrieri; if (c) _mappaCorr.set(c.id, c) }
  // completa i nomi dei corrieri presenti solo come riga listino (non nell'aggancio)
  const idsSenzaNome = [..._mappaCorr.entries()].filter(([, v]) => !v).map(([k]) => k)
  if (idsSenzaNome.length) {
    const { data: cc } = await supabase.from('corrieri').select('id,nome_contratto,tipo').in('id', idsSenzaNome)
    for (const c of (cc || [])) _mappaCorr.set(c.id, c)
  }
  const { data: tuttiICorrieriRaw } = await supabase.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
  // Corrieri SPENTI dal master PADRE per questo (sotto-)master: nascosti dal Listino Corrieri.
  // In masters_corrieri_abilitati il corriere è quello del listino del padre -> confronto per NOME.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const _admin = createAdminSupabase()
  const { data: _statiM } = await _admin.from('masters_corrieri_abilitati').select('corriere_id,abilitato').eq('master_id', utente?.master_id)
  const _disId = new Set((_statiM || []).filter((s: any) => s.abilitato === false).map((s: any) => s.corriere_id))
  let _disNomi = new Set<string>()
  if (_disId.size) {
    const { data: _dc } = await _admin.from('corrieri').select('nome_contratto').in('id', Array.from(_disId))
    _disNomi = new Set((_dc || []).map((c: any) => (c.nome_contratto || '').trim().toLowerCase()))
  }
  // DUE cose diverse, non piu' accorpate:
  //  - SPENTO DAL PADRE (masters_corrieri_abilitati.abilitato=false): il padre ha TOLTO l'accesso a
  //    questo master -> resta nascosto (non lo possiede).
  //  - SOSPESO A MONTE (un antenato l'ha messo IN PAUSA, sospesoDallaCatena): il MASTER deve comunque
  //    VEDERLO nel suo Listino Corrieri (lo gestisce, ne prepara i prezzi) — e' il CLIENTE finale a non
  //    vederlo (lo filtra /api/cliente/listino-prezzi). Prima erano accorpati e la pausa a monte lo
  //    nascondeva anche al master (segnalato da "The Shipping Company"). Lo si mostra col flag sospeso_sopra.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const _sospesiSopra = await contrattiSospesiSopra(utente?.master_id)
  const _spentoDalPadre = (c: any) => _disId.has(c.id) || _disNomi.has((c.nome_contratto || '').trim().toLowerCase())
  const _sospesoSopra = (c: any) => sospesoDallaCatena(c.nome_contratto, _sospesiSopra)
  const tuttiICorrieri = (tuttiICorrieriRaw || []).filter((c: any) => !_spentoDalPadre(c))
  const posseduti = new Set((tuttiICorrieri || []).map((c:any) => c.id))
  // Mostra SOLO i corrieri realmente POSSEDUTI dal master e non spenti dal padre: no righe/agganci
  // "estranei" (residui di duplicazioni/ereditarietà che puntano a corrieri di altri master).
  const corrieriBase = [..._mappaCorr.values()].filter(Boolean).filter((c:any) => posseduti.has(c.id) && !_spentoDalPadre(c))
  // Marca ogni corriere come PROPRIO o EREDITATO dal master sopra: l'editor blocca i soli ereditati.
  // sospeso_sopra: in pausa da un livello superiore -> lo vede col badge, prezzi in sola lettura (è ereditato).
  const { corrieriEreditatiIds } = await import('@/lib/rete-masters')
  const _ereditatiIds = await corrieriEreditatiIds(_admin, utente?.master_id)
  const corrieri = corrieriBase.map((c:any) => ({ ...c, ereditato: _ereditatiIds.has(c.id), sospeso_sopra: _sospesoSopra(c) }))
  const corrieriDisponibili = (tuttiICorrieri||[]).filter(c => !corrieri.some((x:any) => x.id === c.id))

  const corriereSelezionato = corrieri.find((c:any) => c.id === corriereId) || corrieri[0]

  // La riga del corriere selezionato è la fonte del SUO fattore/solo_peso_reale. Se manca, la creo
  // (ereditando il fattore dalla riga più vecchia come default): da qui in poi è per-corriere.
  let listino = (listiniMaster || []).find((l:any) => l.corriere_id === corriereSelezionato?.id) || null
  if (!listino && corriereSelezionato) {
    const base: any = (listiniMaster || [])[0]
    const { data: nuovo, error: eIns } = await supabase.from('listini_corrieri').insert({
      master_id: utente?.master_id, corriere_id: corriereSelezionato.id,
      nome: base?.nome || 'Listino Corrieri',
      fattore_volume: base?.fattore_volume ?? 5000, solo_peso_reale: false, attivo: true,
    }).select().single()
    // CORSA fra due caricamenti: se un altro render l'ha appena creato (col vincolo unico
    // master_id+corriere_id il doppione è impedito), RILEGGO quello esistente invece di cadere sul
    // placeholder sotto e generare un guscio in più.
    if (nuovo) listino = nuovo
    else if (eIns) {
      const { data: gia } = await supabase.from('listini_corrieri').select('*')
        .eq('master_id', utente?.master_id).eq('corriere_id', corriereSelezionato.id).maybeSingle()
      listino = gia
    }
    if (listino?.id && !masterListinoIds.includes(listino.id)) masterListinoIds.push(listino.id)
  }
  if (!listino) {
    // nessun corriere ancora nel listino: placeholder per non rompere il salvataggio
    const { data: nuovo } = await supabase.from('listini_corrieri').insert({
      master_id: utente?.master_id, nome: 'Listino Corrieri',
    }).select().single()
    listino = nuovo
  }

  let fasce: any[] = []
  let supplementi: any[] = []
  if (corriereSelezionato) {
    const { data: f } = await supabase.from('listini_corrieri_fasce')
      .select('*').in('listino_id', masterListinoIds).eq('corriere_id', corriereSelezionato.id).order('peso_max')
    fasce = f || []
    const { data: s } = await supabase.from('listini_corrieri_supplementi')
      .select('*').in('listino_id', masterListinoIds).eq('corriere_id', corriereSelezionato.id)
    supplementi = s || []
  }

  // SI MOSTRA IL DIVISORE CHE SI PAGA, non quello scritto sulla riga del listino.
  // `fattoreVolumeCorriere` e' la stessa funzione che usa il motore dei prezzi: dentro ha la
  // precedenza vera (override per-corriere, poi default, poi eredita' dalla catena). Leggendo a mano
  // il solo default, sei contratti mostravano un numero diverso da quello con cui venivano prezzati
  // — BRT PF di QUICK diceva 6666 e pagava come 5000, su 187 spedizioni in trenta giorni.
  // Un posto solo decide il divisore: le pagine lo chiedono a lui, non lo ricalcolano.
  let listinoOut = listino
  if (listino && corriereSelezionato?.id) {
    const { fattoreVolumeCorriere } = await import('@/lib/pricing')
    const effettivo = await fattoreVolumeCorriere(supabase, utente!.master_id!, corriereSelezionato.id)
    if (effettivo > 0) listinoOut = { ...listino, fattore_volume: effettivo }
  }

  return NextResponse.json({
    listino: listinoOut, corrieri, corrieriDisponibili,
    corriereSelezionatoId: corriereSelezionato?.id || '',
    corriereEreditato: !!corriereSelezionato?.ereditato,
    fasce, supplementi,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = sola lettura

  const body = await req.json()
  const { listinoId, corriereId, fasce, supplementi, fattore_volume, solo_peso_reale } = body
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  // SOLA LETTURA PER-CONTRATTO: si modificano solo i contratti PROPRI. Quelli EREDITATI da un master
  // sopra (stesso nome_contratto di un antenato) sono in sola lettura ANCHE se il master possiede
  // altri contratti suoi — prima bastava possederne uno per poterli toccare tutti. La guardia sta qui,
  // nel server, non solo nella UI: senza, chi bypassa la pagina riscriverebbe comunque il prezzo
  // ereditato (REGOLE.md: la regola che decide chi paga cosa va dove passano tutte le porte).
  {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { corrieriEreditatiIds } = await import('@/lib/rete-masters')
    const admin = createAdminSupabase()
    const ereditati = await corrieriEreditatiIds(admin, utente?.master_id)
    if (ereditati.has(corriereId)) return NextResponse.json({ error: 'Questo contratto è ereditato dal tuo master: il prezzo è in sola lettura e non puoi modificarlo.' }, { status: 403 })
  }

  await supabase.from('listini_corrieri').update({ fattore_volume, solo_peso_reale: !!solo_peso_reale }).eq('id', listinoId)

  // IL DIVISORE SI SALVA IN DUE POSTI, PERCHE' IL MOTORE NE LEGGE DUE.
  //
  // Qui si scriveva solo il default del listino, ma `fattoreVolumeCorriere` (lib/pricing) guarda
  // PRIMA l'override per-corriere in `listini_corrieri_corrieri`: se c'e', il default non conta.
  // Quindi si salvava 6666, si tornava a vedere 6666, e si continuava a pagare col 5000 di prima —
  // su QUICK/BRT PF sono 187 spedizioni in trenta giorni. Chi cerca un errore nel divisore guarda
  // questa pagina, e la pagina gli dava ragione mentre il conto diceva altro.
  // (Ci sono inciampato anch'io correggendo Poste Delivery Business Triangolazioni a mano: il
  //  default a 6000, l'override rimasto a 5000, e la correzione senza effetto.)
  // Si allinea l'override di QUESTO corriere su tutti i listini del master: il valore salvato e il
  // valore applicato tornano a essere lo stesso numero, qualunque strada legga il motore.
  {
    const { data: _lm } = await supabase.from('listini_corrieri').select('id').eq('master_id', utente?.master_id)
    const _ids = [...new Set([...(_lm || []).map((l: any) => l.id), listinoId].filter(Boolean))]
    if (_ids.length) {
      await supabase.from('listini_corrieri_corrieri')
        .update({ fattore_volume }).in('listino_id', _ids).eq('corriere_id', corriereId)
    }
  }

  // Cancella le fasce/supplementi di questo corriere in TUTTI i listini del master
  // (potevano essere sparse sotto listino_id diversi): evita duplicati/orfani e le riconsolida.
  const { data: listiniMaster } = await supabase.from('listini_corrieri').select('id').eq('master_id', utente?.master_id)
  const masterListinoIds = [...new Set([...(listiniMaster || []).map((l: any) => l.id), listinoId].filter(Boolean))]
  await supabase.from('listini_corrieri_fasce').delete().in('listino_id', masterListinoIds).eq('corriere_id', corriereId)
  await supabase.from('listini_corrieri_supplementi').delete().in('listino_id', masterListinoIds).eq('corriere_id', corriereId)

  // Reinserisci fasce
  if (fasce?.length) {
    const { error } = await supabase.from('listini_corrieri_fasce').insert(
      fasce.map((f:any) => ({ ...f, listino_id: listinoId, corriere_id: corriereId }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Reinserisci supplementi
  const righeSupplementi: any[] = []
  if (supplementi) {
    if (Array.isArray(supplementi.assicurazione)) {
      for (const r of supplementi.assicurazione) {
        if (Number(r.valore_max) > 0) {   // scaglione attivo se ha un valore max (anche costo 0 = gratis); vuoto = non attivo
          righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'assicurazione', valore: Number(r.prezzo_fisso)||0, tipo_calcolo: r.calcolo_su||'totale', descrizione: JSON.stringify(r) })
        }
      }
    }
    if (Array.isArray(supplementi.contrassegno)) {
      for (const r of supplementi.contrassegno) {
        if (Number(r.valore_max) > 0) {   // scaglione attivo se ha un valore max (anche costo 0 = gratis); vuoto = non attivo
          righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'contrassegno', valore: Number(r.prezzo_fisso)||0, tipo_calcolo: r.calcolo_su||'totale', descrizione: JSON.stringify(r) })
        }
      }
    }
    if (Array.isArray(supplementi.servizi)) {
      for (const s of supplementi.servizi) {
        if (s.nome && String(s.nome).trim()) {   // accessorio attivo se ha un nome (anche costo 0 = gratis); vuoto = non attivo
          righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'accessorio', nome: s.nome, valore: Number(s.prezzo)||0, tipo_calcolo: 'fisso', descrizione: JSON.stringify(s) })
        }
      }
    }
    if (supplementi.giacenze) {
      const { servizi: giacenzeServizi, apertura } = supplementi.giacenze
      if (Array.isArray(giacenzeServizi)) {
        for (const s of giacenzeServizi) {
          if (s.nome && String(s.nome).trim()) {   // servizio attivo se ha un nome (anche costo 0 = gratis); vuoto = non attivo
            righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'giacenza', nome: s.nome, valore: Number(s.prezzo)||0, tipo_calcolo: 'fisso', descrizione: JSON.stringify(s) })
          }
        }
      }
      if (Number(apertura) > 0) {
        righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'giacenza_apertura', nome: 'Apertura dossier giacenza', valore: Number(apertura), tipo_calcolo: 'fisso' })
      }
    }
    if (supplementi.ritiro) {
      const { prezzo, perc_nolo } = supplementi.ritiro
      if (Number(prezzo) > 0 || Number(perc_nolo) > 0) {
        righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'ritiro', nome: 'Ritiro', valore: Number(prezzo)||0, tipo_calcolo: 'fisso', descrizione: JSON.stringify({perc_nolo}) })
      }
    }
    // Sponda: sopra "soglia_kg" si aggiunge "prezzo_kg" € per ogni kg oltre la soglia (sul peso fatturato).
    if (supplementi.sponda) {
      const soglia_kg = Number(supplementi.sponda.soglia_kg) || 0
      const prezzo_kg = Number(supplementi.sponda.prezzo_kg) || 0
      if (prezzo_kg > 0 && soglia_kg > 0) {
        righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'sponda', nome: 'Sponda', valore: prezzo_kg, tipo_calcolo: 'per_kg', descrizione: JSON.stringify({ soglia_kg }) })
      }
    }
  }
  if (righeSupplementi.length) {
    const { error } = await supabase.from('listini_corrieri_supplementi').insert(righeSupplementi)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}