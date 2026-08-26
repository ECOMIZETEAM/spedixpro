import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
export const dynamic = 'force-dynamic'

// Lista movimenti con PAGINAZIONE SERVER (?page=1&perPage=25): i target grandi hanno migliaia di
// movimenti (record attuale ~7.900) e scaricarli tutti bloccava la pagina per decine di secondi.
// Filtri server: ?cerca= (descrizione/riferimento) e ?corriere= (nome contratto via join spedizioni).
// ?somma=1 aggiunge il totale dell'intero filtro (query leggera sui soli importi).
// Senza ?page → comportamento storico (lista completa), mantenuto per compatibilità.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()

  // L'agente non vede movimenti/credito (dati del master).
  if ((utente?.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non disponibile per gli agenti.' }, { status: 403 })

  const p = req.nextUrl.searchParams
  const self = p.get('self')
  const page = Math.max(0, parseInt(p.get('page') || '0') || 0)          // 0 = modalità storica (tutto)
  const perPage = Math.min(200, Math.max(1, parseInt(p.get('perPage') || '25') || 25))
  const cerca = (p.get('cerca') || '').replace(/[,()%]/g, ' ').trim()     // sanificato per la sintassi or()
  const corriere = (p.get('corriere') || '').trim()
  const gruppo = (p.get('gruppo') || '').trim()   // solo E&A: filtra i movimenti per portale/sotto-account
  const conSomma = p.get('somma') === '1'

  // Corrieri del gruppo scelto (valorizzato nel ramo self di E&A): filtra i movimenti-spedizione a
  // quel portale/sotto-account. Le ricariche (senza spedizione) restano fuori dai gruppi (stanno nelle card).
  let corriereIdsGruppo: string[] | null = null

  // Query base per (client, colonna target): filtri identici su lista, conteggio e somma.
  const buildQ = (db: any, col: string, val: string, select = '*', conteggio = false) => {
    let sel = select
    if (corriere) sel = `${sel}, spedizioni!inner(corrieri!inner(nome_contratto))`
    else if (corriereIdsGruppo) sel = `${sel}, spedizioni!inner(corriere_id)`
    let q = db.from('movimenti').select(sel, conteggio ? { count: 'exact' } : undefined).eq(col, val)
    if (cerca) q = q.or(`descrizione.ilike.%${cerca}%,riferimento.ilike.%${cerca}%`)
    if (corriere) q = q.eq('spedizioni.corrieri.nome_contratto', corriere)
    else if (corriereIdsGruppo) q = q.in('spedizioni.corriere_id', corriereIdsGruppo.length ? corriereIdsGruppo : ['00000000-0000-0000-0000-000000000000'])
    return q
  }

  // Carica secondo la modalità: paginata (page>0) o storica completa.
  const carica = async (db: any, col: string, val: string) => {
    if (!page) {
      const movimenti = await fetchAll(() => buildQ(db, col, val).order('created_at', { ascending: false }))
      return { movimenti: movimenti || [], total: (movimenti || []).length, somma: null as number | null }
    }
    const from = (page - 1) * perPage
    // SOLO le righe della pagina: niente count:'exact', che rifaceva lo scan del filtro a ogni pagina.
    const { data } = await buildQ(db, col, val, '*', false)
      .order('created_at', { ascending: false }).range(from, from + perPage - 1)
    // TOTALE (serve alla paginazione) + SOMMA in UNA query aggregata sull'indice: prima la somma era
    // un fetchAll di TUTTI gli importi del filtro (per E&A ~64k righe, ~65 viaggi HTTP) ripetuto a
    // OGNI click/keystroke — era la lentezza della lista. La RPC applica gli stessi filtri di buildQ
    // (verificato: numeri identici alla query diretta) ed e' SECURITY INVOKER (stessa RLS di adesso).
    const { data: tot } = await db.rpc('movimenti_totali', {
      p_col: col, p_val: val,
      p_cerca: cerca || null,
      p_corriere_nome: corriere || null,
      p_corriere_ids: corriereIdsGruppo,
    })
    const row: any = Array.isArray(tot) ? tot[0] : tot
    const total = Number(row?.total || 0)
    const somma = conSomma ? Math.round(Number(row?.somma || 0) * 100) / 100 : null
    return { movimenti: data || [], total, somma }
  }

  // Arricchimento nome corriere (solo sulle righe restituite: poche).
  const conCorriere = async (movs: any[]) => {
    const spedIds = Array.from(new Set(movs.map((mv: any) => mv.spedizione_id).filter(Boolean)))
    if (!spedIds.length) return movs.map((mv: any) => ({ ...mv, corriere: null }))
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const nomePerSped = new Map<string, string | null>()
    for (let i = 0; i < spedIds.length; i += 300) {
      const { data: speds } = await admin.from('spedizioni').select('id,corrieri(nome_contratto)').in('id', spedIds.slice(i, i + 300))
      for (const s of (speds || [])) nomePerSped.set(s.id, (s.corrieri as any)?.nome_contratto || null)
    }
    return movs.map((mv: any) => ({ ...mv, corriere: mv.spedizione_id ? (nomePerSped.get(mv.spedizione_id) || null) : null }))
  }

  if (self === '1') {
    if (utente?.ruolo === 'cliente' || !utente?.master_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    // Filtro per GRUPPO (E&A): i movimenti-spedizione del portale/sotto-account scelto. Il gruppo è
    // il tipo del corriere (spediamopro/easyparcel/gls/interno) o, per Spedisci, il master_domain.
    if (gruppo) {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const adm = createAdminSupabase()
      const { data: cs } = await adm.from('corrieri').select('id,tipo,credenziali').eq('master_id', utente.master_id)
      corriereIdsGruppo = (cs || []).filter((c: any) =>
        ['spediamopro', 'easyparcel', 'gls', 'interno'].includes(gruppo)
          ? c.tipo === gruppo
          : c.tipo === 'spedisci' && ((c.credenziali as any)?.master_domain === gruppo)
      ).map((c: any) => c.id)
    }
    const { movimenti, total, somma } = await carica(supabase, 'master_target_id', utente.master_id)
    const { data: m } = await supabase
      .from('masters').select('credito, nome, credito_proprio, commissioni_moovexpress').eq('id', utente.master_id).single()
    // Chi porta contratti SUOI ha due conti, e finora ne vedeva uno: i costi dei suoi contratti
    // scendevano da un saldo che nessuna pagina mostrava. Il secondo si manda solo a chi ce l'ha
    // davvero, cosi' per tutti gli altri la pagina resta identica.
    const { haContoProprio } = await import('@/lib/cascata')
    const dueConti = await haContoProprio(utente.master_id)
    // Opzioni del filtro corriere: i nomi contratto sono condivisi in rete → bastano i MIEI.
    const { data: miei } = await supabase.from('corrieri').select('nome_contratto').eq('master_id', utente.master_id)
    const corrieriDisponibili = Array.from(new Set((miei || []).map((c: any) => c.nome_contratto).filter(Boolean))).sort()
    return NextResponse.json({
      movimenti: await conCorriere(movimenti),
      total, somma, page: page || undefined, perPage,
      corrieriDisponibili,
      saldo: Number(m?.credito || 0),
      saldoProprio: dueConti ? Number((m as any)?.credito_proprio || 0) : undefined,
      // Commissioni MoovExpress accumulate sui contratti propri (0,05 €/spedizione): lista/saldo a
      // parte, si mostra solo a chi ha contratti propri. Negativo = dovuto a MoovExpress.
      saldoCommissioni: dueConti ? Number((m as any)?.commissioni_moovexpress || 0) : undefined,
      cliente: m?.nome || null,
    })
  }

  let clienteId: string | null = null
  if (utente?.ruolo === 'cliente') {
    clienteId = utente.cliente_id
    if (!clienteId) return NextResponse.json({ error: 'Cliente non associato' }, { status: 400 })
  } else {
    clienteId = p.get('clienteId')
    if (!clienteId) return NextResponse.json({ error: 'clienteId mancante' }, { status: 400 })
    // L'id del SOTTO-MASTER può arrivare ancora percent-encoded ("m%3A<id>"): la scheda lo
    // prende dall'indirizzo della pagina, dove il browser codifica i due punti, e lo rispedisce
    // codificato una seconda volta. Senza normalizzarlo il prefisso "m:" non veniva riconosciuto
    // e la richiesta finiva nel ramo dei clienti → 403 e lista vuota su OGNI sotto-master.
    if (clienteId.includes('%')) { try { clienteId = decodeURIComponent(clienteId) } catch {} }

    // Sotto-master (clienteId = "m:<masterId>"): movimenti tra master + saldo del sotto-master
    if (clienteId.startsWith('m:')) {
      const targetId = clienteId.slice(2)
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const admin = createAdminSupabase()
      const { data: sub } = await admin.from('masters').select('id,parent_master_id,credito,nome').eq('id', targetId).single()
      // Autorizzato se il mio master è un ANTENATO (figlio diretto o più in basso nella rete).
      let cur: string | null = sub?.parent_master_id || null
      let autorizzato = false
      for (let i = 0; i < 20 && cur; i++) {
        if (cur === utente?.master_id) { autorizzato = true; break }
        const { data: pm } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        cur = pm?.parent_master_id || null
      }
      if (!sub || !autorizzato) {
        console.warn('[MOVIMENTI][403] sotto-master', { viewer: utente?.master_id, ruolo: utente?.ruolo, targetId })
        return NextResponse.json({ error: `I movimenti di ${sub?.nome || 'questo master'} sono visibili solo a chi lo ha nella propria rete.` }, { status: 403 })
      }
      const { movimenti, total, somma } = await carica(admin, 'master_target_id', targetId)
      return NextResponse.json({ movimenti, total, somma, page: page || undefined, perPage, saldo: Number(sub.credito || 0), cliente: sub.nome || null })
    }

    const { data: cli } = await supabase
      .from('clienti').select('id, master_id').eq('id', clienteId).single()
    if (!cli || cli.master_id !== utente?.master_id) {
      // Fallback: id di un SOTTO-MASTER inviato senza prefisso m: → ne mostro movimenti/saldo
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const admin = createAdminSupabase()
      const { data: sub } = await admin.from('masters').select('id,parent_master_id,credito,nome').eq('id', clienteId).maybeSingle()
      if (sub) {
        let cur: string | null = sub.parent_master_id || null
        let autorizzato = false
        for (let i = 0; i < 20 && cur; i++) {
          if (cur === utente?.master_id) { autorizzato = true; break }
          const { data: pm } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
          cur = pm?.parent_master_id || null
        }
        if (autorizzato) {
          const { movimenti, total, somma } = await carica(admin, 'master_target_id', clienteId)
          return NextResponse.json({ movimenti, total, somma, page: page || undefined, perPage, saldo: Number(sub.credito || 0), cliente: sub.nome || null })
        }
      }
      // Messaggio esplicito: il cliente di un sotto-master NON è leggibile da chi sta più in
      // alto (mostrerebbe il prezzo finale di vendita del sotto-master). Senza questo testo la
      // pagina restava muta e sembrava un archivio vuoto.
      const { data: altro } = await admin.from('clienti')
        .select('ragione_sociale,masters:master_id(nome)').eq('id', clienteId).maybeSingle()
      const errore = altro
        ? `I movimenti di ${(altro as any).ragione_sociale} sono visibili solo al suo master (${(altro as any).masters?.nome || 'rete'}).`
        : 'Cliente non trovato o non autorizzato'
      console.warn('[MOVIMENTI][403]', { viewer: utente?.master_id, ruolo: utente?.ruolo, clienteId })
      return NextResponse.json({ error: errore }, { status: 403 })
    }
  }
  const { movimenti, total, somma } = await carica(supabase, 'cliente_id', clienteId!)
  const { data: cli } = await supabase
    .from('clienti').select('credito, ragione_sociale').eq('id', clienteId!).single()
  return NextResponse.json({
    movimenti, total, somma, page: page || undefined, perPage,
    saldo: Number(cli?.credito || 0),
    cliente: cli?.ragione_sociale || null,
  })
}
