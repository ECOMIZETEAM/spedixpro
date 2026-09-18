import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { fetchAll } from '@/lib/fetch-all'
import { vettoreFisico } from '@/lib/vettore'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const dal = p.get('dal')
  const al = p.get('al')
  const ruolo = (utente?.ruolo || '').toLowerCase()

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // ── Rete: un master vede anche le distinte dei sotto-master (tutta la discendenza),
  //    etichettate con la PROPRIA PRIMA LINEA (il figlio diretto sotto cui discendono). ──
  const mine = utente?.master_id
  let masterIds: string[] = mine ? [mine] : []
  const primaLineaId = new Map<string, string>()   // master discendente -> figlio diretto (prima linea)
  const nomeMaster = new Map<string, string>()      // master id -> nome
  const isMasterRete = ruolo !== 'cliente' && ruolo !== 'agente' && !!mine
  if (isMasterRete) {
    let frontier = [mine as string]
    for (let i = 0; i < 12 && frontier.length; i++) {
      const { data: figli } = await admin.from('masters').select('id,nome,parent_master_id').in('parent_master_id', frontier)
      const nuovi: string[] = []
      for (const c of (figli || [])) {
        if (masterIds.includes((c as any).id)) continue
        nomeMaster.set((c as any).id, (c as any).nome)
        primaLineaId.set((c as any).id, (c as any).parent_master_id === mine ? (c as any).id : (primaLineaId.get((c as any).parent_master_id) || (c as any).id))
        masterIds.push((c as any).id); nuovi.push((c as any).id)
      }
      frontier = nuovi
    }
  }

  const filtroAgente = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null

  // Arricchimento (uguale per lista storica e pagina): etichette cliente/rete/contratto/vettore.
  async function arricchisci(distinte: any[]): Promise<any[]> {
    // Etichetta "Cliente" leggibile anche quando cliente_id è NULL:
    //  - distinta di un SOTTO-MASTER (master_rete_id) -> nome del sotto-master;
    //  - distinta multi-cliente / spedizione propria -> ricavo dalle spedizioni (Più clienti / Spedizione propria).
    const reteIds = Array.from(new Set(distinte.filter((d: any) => d.master_rete_id).map((d: any) => d.master_rete_id)))
    const nomeRete = new Map<string, string>()
    if (reteIds.length) {
      const { data: ms } = await admin.from('masters').select('id,nome').in('id', reteIds)
      for (const m of (ms || [])) nomeRete.set((m as any).id, (m as any).nome)
    }
    // Distinte senza cliente e senza rete -> deriva dalle spedizioni
    const daDerivare = distinte.filter((d: any) => !d.cliente_id && !d.master_rete_id).map((d: any) => d.id)
    const clientiPerDistinta = new Map<string, Set<string>>()
    if (daDerivare.length) {
      const { data: sp } = await admin.from('spedizioni').select('distinta_id, clienti(ragione_sociale)').in('distinta_id', daDerivare)
      for (const s of (sp || [])) {
        const did = (s as any).distinta_id
        if (!clientiPerDistinta.has(did)) clientiPerDistinta.set(did, new Set())
        const nome = (s as any).clienti?.ragione_sociale
        if (nome) clientiPerDistinta.get(did)!.add(nome)
      }
    }
    // Etichetta "Contratto" per le distinte MISTE (corriere_id null, es. merge di più contratti GLS):
    // la derivo dai contratti reali delle spedizioni -> "GLS (N contratti)".
    const distMiste = distinte.filter((d: any) => !d.corriere_id).map((d: any) => d.id)
    const contrattiPerDistinta = new Map<string, Set<string>>()
    const vettoriPerDistinta = new Map<string, Set<string>>()
    if (distMiste.length) {
      const { data: spc } = await admin.from('spedizioni').select('distinta_id, corrieri(nome_contratto,tipo)').in('distinta_id', distMiste)
      for (const s of (spc || [])) {
        const did = (s as any).distinta_id; const c = (s as any).corrieri
        if (!did || !c) continue
        if (!contrattiPerDistinta.has(did)) { contrattiPerDistinta.set(did, new Set()); vettoriPerDistinta.set(did, new Set()) }
        if (c.nome_contratto) contrattiPerDistinta.get(did)!.add(c.nome_contratto)
        vettoriPerDistinta.get(did)!.add(vettoreFisico(c))
      }
    }
    return distinte.map((d: any) => {
      let cliente_label = d.clienti?.ragione_sociale || null
      if (!cliente_label && d.master_rete_id) cliente_label = 'Rete: ' + (nomeRete.get(d.master_rete_id) || 'sotto-master')
      if (!cliente_label) {
        const set = clientiPerDistinta.get(d.id)
        if (!set || set.size === 0) cliente_label = 'Spedizione propria'
        else if (set.size === 1) cliente_label = Array.from(set)[0]
        else cliente_label = `Più clienti (${set.size})`
      }
      // Distinta creata da un SOTTO-MASTER della rete: etichetta con la mia prima linea.
      let master_rete: string | null = null
      if (d.master_id && d.master_id !== mine) {
        const flId = primaLineaId.get(d.master_id)
        master_rete = flId ? (nomeMaster.get(flId) || nomeMaster.get(d.master_id) || null) : (nomeMaster.get(d.master_id) || null)
      }
      // Contratto: singolo dal corriere della distinta, oppure — se MISTA — "Vettore (N contratti)".
      let contratto_label = d.corrieri?.nome_contratto || null
      let vettore: string | null = d.corrieri ? vettoreFisico(d.corrieri) : null
      if (!contratto_label && !d.corriere_id) {
        const set = contrattiPerDistinta.get(d.id); const vset = vettoriPerDistinta.get(d.id)
        const vett = vset && vset.size === 1 ? Array.from(vset)[0] : (vset && vset.size ? 'Misto' : '')
        if (!vettore) vettore = vett || null
        if (set && set.size) contratto_label = `${vett} (${set.size} contratt${set.size === 1 ? 'o' : 'i'})`.trim()
      }
      return { ...d, cliente_label, master_rete, contratto_label, vettore }
    })
  }

  const noMaster = ['00000000-0000-0000-0000-000000000000']
  const pageParam = parseInt(p.get('page') || '0') || 0

  // ── MODALITÀ STORICA (nessun ?page): lista completa, comportamento invariato ──
  // Un CLIENTE resta SEMPRE su questo ramo, col client user-scoped (RLS): la modalità paginata usa
  // l'RPC service-role (bypassa la RLS) e filtra solo per master_id — e il master_id ce l'ha anche il
  // cliente. Il portale cliente ha comunque il suo /api/cliente/distinte; questa è la rotta del master.
  if (pageParam < 1 || ruolo === 'cliente') {
    const db: any = (isMasterRete && masterIds.length > 1) ? admin : supabase
    const build = () => {
      let q = db.from('distinte')
        .select('*, clienti(ragione_sociale), corrieri(nome_contratto,tipo)')
        .in('master_id', masterIds.length ? masterIds : noMaster)
        .order('created_at', { ascending: false })
      if (filtroAgente) q = q.in('cliente_id', filtroAgente)
      if (dal) q = q.gte('created_at', dal)
      if (al) q = q.lte('created_at', al + 'T23:59:59')
      return q
    }
    const distinte = await fetchAll(build)
    return NextResponse.json(await arricchisci(distinte))
  }

  // ── MODALITÀ PAGINATA (?page=N): filtri + paginazione nel DB, arricchimento solo sulla pagina.
  // Migliaia di distinte (record ~26.000 sul super-master) non si scaricano più tutte a ogni visita.
  const perPage = Math.min(200, Math.max(1, parseInt(p.get('perPage') || '10') || 10))
  const cerca = (p.get('cerca') || '').replace(/[%_]/g, ' ').trim()   // % e _ sono jolly di ilike: neutralizzati
  const fVettore = (p.get('vettore') || '').trim()
  const fContratto = (p.get('contratto') || '').trim()
  const dalISO = dal ? new Date(dal + 'T00:00:00.000Z').toISOString() : null
  const alISO = al ? new Date(al + 'T23:59:59.999Z').toISOString() : null

  // Corrieri della rete → mappa vettore (vettoreFisico resta in JS, niente regex in SQL).
  const corrNet = await fetchAll(() => admin.from('corrieri').select('id,tipo,nome_contratto').in('master_id', masterIds.length ? masterIds : noMaster))
  const vettDiCorr = new Map<string, string>()
  for (const c of (corrNet || [])) vettDiCorr.set((c as any).id, vettoreFisico(c as any))

  // Set di corriere_id che soddisfano i filtri Vettore/Contratto (null = nessun filtro corriere).
  let corrIds: string[] | null = null
  if (fVettore || fContratto) {
    corrIds = (corrNet || []).filter((c: any) => (!fVettore || vettDiCorr.get(c.id) === fVettore) && (!fContratto || c.nome_contratto === fContratto)).map((c: any) => c.id)
  }

  const { data: res, error } = await admin.rpc('distinte_page_v1', {
    p_masters: masterIds.length ? masterIds : noMaster,
    p_dal: dalISO, p_al: alISO, p_cerca: cerca,
    p_corr_ids: corrIds, p_cliente_ids: filtroAgente,
    p_page: pageParam, p_perpage: perPage,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const j: any = res || {}

  const rows = await arricchisci(j.rows || [])
  // Menu Vettore/Contratto: dai corrieri USATI nel periodo (mappati al vettore fisico in JS).
  const usati: any[] = j.corrieriUsati || []
  const vettoriSet = new Set<string>(), contrattiArr: { nome: string; vettore: string }[] = []
  const contrVisti = new Set<string>()
  for (const c of usati) {
    const v = vettoreFisico(c)
    if (v) vettoriSet.add(v)
    if (c.nome_contratto && !contrVisti.has(c.nome_contratto)) { contrVisti.add(c.nome_contratto); contrattiArr.push({ nome: c.nome_contratto, vettore: v }) }
  }

  return NextResponse.json({
    rows, total: Number(j.total || 0),
    vettori: Array.from(vettoriSet).sort(),
    contratti: contrattiArr.sort((a, b) => a.nome.localeCompare(b.nome)),
  })
}
