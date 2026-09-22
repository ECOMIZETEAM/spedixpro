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
    // Il master vede lo stato PER LIVELLO (ricalcolato sotto), diverso da quello salvato: pre-filtrare
    // qui farebbe sparire proprio le righe in cui i due divergono. Per agente e cliente resta a DB.
    if (statoContrassegno && (!utente?.master_id || isAgente(utente))) q = q.eq('stato_contrassegno', statoContrassegno)
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

  // Chi vede lo stato PER LIVELLO (il master) prende anche il numero di distinta da lì, sotto.
  const perLivello = !!utente?.master_id && !isAgente(utente)
  // Numero della distinta contrassegni per le spedizioni gia' in distinta (colonna "N. Dist.").
  const distIds = perLivello ? [] : [...new Set((lista as any[]).map((s: any) => s.distinta_contrassegno_id).filter(Boolean))]
  if (distIds.length) {
    const { data: dist } = await db.from('distinte_contrassegni').select('id,numero').in('id', distIds)
    const numById = new Map((dist || []).map((d: any) => [d.id, d.numero]))
    for (const s of (lista as any[])) if (s.distinta_contrassegno_id) s.distinta_numero = numById.get(s.distinta_contrassegno_id) ?? null
  }

  // OGNI LIVELLO VEDE I SUOI SOLDI (lib/contrassegni-stato-livello.ts): verde solo quando ha incassato
  // lui. Chi ha qualcuno sopra guarda la distinta in entrata, il detentore la propria. Lo stato salvato
  // sulla spedizione resta quello del cliente finale, che è quello che vede il cliente nel suo portale.
  if (perLivello) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { statiCodPerLivello } = await import('@/lib/contrassegni-stato-livello')
    const stati = await statiCodPerLivello(createAdminSupabase(), utente!.master_id, lista as any[])
    for (const s of (lista as any[])) {
      const v = stati.get(s.id); if (!v) continue
      s.stato_contrassegno = v.stato
      s.cod_selezionabile = v.selezionabile
      // "N. Dist." = la MIA distinta (quella con cui pago chi sta sotto); se non l'ho ancora fatta,
      // quella con cui mi paga il livello sopra: sono i due numeri che il master cerca.
      const d = v.mia || v.inEntrata
      s.distinta_contrassegno_id = d?.id ?? null
      s.distinta_numero = d?.numero ?? null
    }
    // Il filtro stato è stato tolto dalla query (vedi sopra): si applica ORA, sullo stato per livello.
    if (statoContrassegno) {
      return NextResponse.json((lista as any[]).filter(s => (s.stato_contrassegno || 'in_attesa') === statoContrassegno))
    }
  }
  return NextResponse.json(lista)
}