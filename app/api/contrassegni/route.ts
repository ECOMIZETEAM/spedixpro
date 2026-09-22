import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { fetchAll } from '@/lib/fetch-all'
import { vedeLaRete } from '@/lib/perimetro'
import { SPED_COLS } from '@/lib/spedizioni-cols'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente)
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const stato = p.get('stato')
  const statoContrassegno = p.get('statoContrassegno')
  const vettore = p.get('vettore')
  const contratto = p.get('contratto')
  const numero = p.get('numero')            // ricerca N. Spedizione: la pagina NON manda la data
  const dal = p.get('dal')
  const al = p.get('al')
  const sanitizza = (v: string) => v.replace(/[,()"\\%]/g, ' ').trim()

  let db: any = supabase
  let subtreeSel: string[] | null = null
  if (masterSel && vedeLaRete(utente)) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(adminDb, utente.master_id)
    subtreeSel = mieiDiscendenti.includes(masterSel)
      ? await sottoAlberoMasterIds(adminDb, masterSel)
      : ['00000000-0000-0000-0000-000000000000']
    db = adminDb
  }

  // Agente: solo contrassegni dei suoi clienti (calcolato una volta, fuori dal loop).
  const agIds = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  const buildBase = () => {
    // Filtro su corrieri (vettore/contratto) → il join deve essere INNER, altrimenti passa tutto.
    const embCorr = (vettore || contratto) ? 'corrieri!inner(nome_contratto)' : 'corrieri(nome_contratto)'
    // Colonne LEGGERE (SPED_COLS): niente raw_response/etichetta/colli_dettaglio (blob da ~300KB/riga)
    // — era la causa della lentezza. Tutte le colonne che la pagina usa ci sono.
    let q = db.from('spedizioni')
      .select(`${SPED_COLS}, clienti(ragione_sociale), ${embCorr}`)
      .gt('contrassegno', 0)
      .order('created_at', { ascending: false })
    if (subtreeSel) q = q.in('master_id', subtreeSel)
    else q = q.eq('master_id', utente?.master_id)
    if (agIds) q = q.in('cliente_id', agIds)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    if (stato) q = q.eq('stato', stato)
    // Nella rete lo stato si ricalcola per livello (sotto): il filtro si applica dopo, non qui.
    if (statoContrassegno && !subtreeSel) q = q.eq('stato_contrassegno', statoContrassegno)
    if (contratto) q = q.eq('corrieri.nome_contratto', contratto)                        // contratto esatto
    if (vettore) q = q.ilike('corrieri.nome_contratto', `${sanitizza(vettore)}%`)          // vettore = prima parola
    // N. Spedizione: cerca su TUTTO lo storico (la pagina non manda dal/al quando c'e' il numero).
    if (numero) q = q.ilike('numero', `%${sanitizza(numero)}%`)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  }
  // Carico TUTTI i contrassegni (prima .limit(500) tagliava): sono spedizioni normali.
  const lista = await fetchAll(buildBase)

  // Numero della distinta contrassegni per le spedizioni gia' in distinta (colonna "N. Dist.").
  const distIds = [...new Set((lista as any[]).map(s => s.distinta_contrassegno_id).filter(Boolean))]
  if (distIds.length) {
    const { data: dist } = await db.from('distinte_contrassegni').select('id,numero').in('id', distIds)
    const numById = new Map((dist || []).map((d: any) => [d.id, d.numero]))
    for (const s of (lista as any[])) if (s.distinta_contrassegno_id) s.distinta_numero = numById.get(s.distinta_contrassegno_id) ?? null
  }

  // OGNI LIVELLO VEDE IL COLORE DELLA SUA DISTINTA.
  //
  // Sulla spedizione lo stato del contrassegno è quello del CLIENTE finale (lo muove chi paga il
  // cliente). Il detentore che guarda la rete di un sotto-master non paga il cliente: paga il
  // sotto-master. Per lui "pagato" vuol dire "ho pagato il sotto-master", e prima vedeva invece lo
  // stato del cliente: verde perché il sotto-master aveva anticipato ai suoi clienti, quando lui non
  // aveva ancora pagato niente. E dopo il suo anticipo il contrassegno restava grigio e selezionabile.
  // Qui, per le spedizioni della rete, lo stato è quello della MIA distinta: nessuna = in attesa,
  // in lavorazione = arancio, pagata = verde.
  const altrui = subtreeSel ? (lista as any[]).filter(s => s.master_id !== utente?.master_id) : []
  if (altrui.length) {
    const mieRighe = new Map<string, string>()   // spedizione → mia distinta
    const ids = altrui.map(s => s.id)
    for (let i = 0; i < ids.length; i += 300) {
      const { data: r } = await db.from('distinte_contrassegni_righe').select('spedizione_id,distinta_id')
        .eq('distinta_master_id', utente?.master_id).in('spedizione_id', ids.slice(i, i + 300))
      for (const x of (r || [])) mieRighe.set((x as any).spedizione_id, (x as any).distinta_id)
    }
    const mieDist = new Map<string, any>()
    const mieIds = [...new Set(mieRighe.values())]
    for (let i = 0; i < mieIds.length; i += 300) {
      const { data: d } = await db.from('distinte_contrassegni').select('id,numero,stato').in('id', mieIds.slice(i, i + 300))
      for (const x of (d || [])) mieDist.set((x as any).id, x)
    }
    for (const s of altrui) {
      const d = mieDist.get(mieRighe.get(s.id) || '')
      if (d) {
        s.stato_contrassegno = d.stato === 'pagata' ? 'pagato' : 'in_distinta'
        s.distinta_contrassegno_id = d.id
        s.distinta_numero = d.numero
      } else {
        // Il reso resta reso: quel contrassegno non si incasserà a nessun livello.
        s.stato_contrassegno = s.stato_contrassegno === 'annullato' ? 'annullato' : 'in_attesa'
        s.distinta_contrassegno_id = null
        s.distinta_numero = null
      }
    }
  }
  if (statoContrassegno && subtreeSel) {
    return NextResponse.json((lista as any[]).filter(s => (s.stato_contrassegno || 'in_attesa') === statoContrassegno))
  }
  return NextResponse.json(lista)
}