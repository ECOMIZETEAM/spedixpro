import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { etichettaRitiriSenzaCodice } from '@/lib/ritiro-codice'


// STATO RITIRI SPEDIAMOPRO: rinfresca best-effort dai pickup live (GET /pickups/{id}).
// Mappa: status >= 4 -> 'elaborato' (preso in carico dal corriere), 1..3 -> 'prenotato'.
// Solo i non-finali col pickup_id, max 40 per giro, batch paralleli: la lista resta veloce.
async function rinfrescaStatiPickup(adminDb: any, lista: any[]) {
  try {
    // Da toccare: stati non finali OPPURE codice CP mancante. SpediamoPro assegna il codice CP
    // in RITARDO (asincrono): se alla prenotazione non era pronto abbiamo salvato l'id numerico
    // -> qui lo recuperiamo appena disponibile, anche su ritiri gia' elaborati.
    const senzaCP = (r: any) => !r.cod_ritiro || /^\d+$/.test(String(r.cod_ritiro))
    const daAggiornare = (lista || []).filter((r: any) => r.pickup_id && (!['elaborato', 'annullato', 'completato'].includes(r.stato) || senzaCP(r))).slice(0, 40)
    if (!daAggiornare.length) return
    const corrIds = Array.from(new Set(daAggiornare.map((r: any) => r.corriere_id).filter(Boolean)))
    const { data: corrs } = await adminDb.from('corrieri').select('id,tipo,credenziali').in('id', corrIds)
    const credPer = new Map((corrs || []).filter((c: any) => c.tipo === 'spediamopro').map((c: any) => [c.id, (c.credenziali || {}).authcode]))
    const { spediamoproGetPickup } = await import('@/lib/spediamopro')
    const BATCH = 8
    for (let i = 0; i < daAggiornare.length; i += BATCH) {
      await Promise.all(daAggiornare.slice(i, i + BATCH).map(async (r: any) => {
        const ac = credPer.get(r.corriere_id)
        if (!ac) return
        try {
          // NB: spediamoproGetPickup ritorna GIÀ il contenuto di data ({status,...}), non l'involucro.
          const j = await spediamoproGetPickup(ac, Number(r.pickup_id))
          const st = Number(j?.status ?? j?.data?.status)
          const nuovo = st >= 4 ? 'elaborato' : (st >= 1 ? 'prenotato' : null)
          const upd: any = {}
          if (nuovo && nuovo !== r.stato) { r.stato = nuovo; upd.stato = nuovo }
          // Recupero del codice CP arrivato dopo la prenotazione (in lista appare subito).
          const code = j?.code ?? j?.pickupCode ?? j?.trackingCode ?? null
          if (code && senzaCP(r) && code !== r.cod_ritiro) { r.cod_ritiro = code; r.tracking_ritiro = code; upd.cod_ritiro = code; upd.tracking_ritiro = code }
          if (Object.keys(upd).length) await adminDb.from('ritiri').update(upd).eq('id', r.id)
        } catch { /* best-effort */ }
      }))
    }
  } catch { /* la lista esce comunque */ }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  // L'autista lavora solo da /api/autista: qui finiva nel ramo del master e leggeva i ritiri di
  // tutta la rete. Il middleware ferma le sue scritture, non le letture.
  if ((utente?.ruolo || '').toLowerCase() === 'autista') return NextResponse.json([])
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente): i suoi ritiri
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const codRitiro = p.get('codRitiro')
  const dal = p.get('dal')
  const al = p.get('al')

  // Cliente: solo i propri ritiri.
  if (utente?.ruolo === 'cliente') {
    const build = () => {
      let q = supabase.from('ritiri').select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
        .eq('master_id', utente.master_id).eq('cliente_id', utente.cliente_id)
        // + id: a parità di data (import in blocco) le pagine da 1000 si accavallano: righe doppie o perse.
        .order('created_at', { ascending: false }).order('id', { ascending: false })
      if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
      if (dal) q = q.gte('created_at', dal)
      if (al) q = q.lte('created_at', al + 'T23:59:59')
      return q
    }
    const lista = await fetchAll(build)
    const { createAdminSupabase: _admR } = await import('@/lib/supabase-admin')
    await rinfrescaStatiPickup(_admR(), lista)
    await etichettaRitiriSenzaCodice(_admR(), lista)
    return NextResponse.json(lista)
  }

  // AGENTE: solo i ritiri dei SUOI clienti. Cadeva nel ramo "Master/admin" qui sotto, che usa il
  // client admin (scavalca la RLS) e allarga a tutta la discendenza: si ritrovava i ritiri di tutti
  // i clienti del master — centinaia, quando lui ne ha tre — con ragioni sociali, indirizzi e
  // volumi. Non ha nemmeno il permesso di vedere la sezione Ritiri, ma la rotta rispondeva lo stesso.
  if (isAgente(utente)) {
    const idsMiei = idClientiPerFiltro(await clientiAgente(supabase, utente))
    const buildAg = () => {
      let q = supabase.from('ritiri').select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
        .eq('master_id', utente!.master_id).in('cliente_id', idsMiei)
        // + id: a parità di data (import in blocco) le pagine da 1000 si accavallano: righe doppie o perse.
        .order('created_at', { ascending: false }).order('id', { ascending: false })
      if (clienteId) q = q.eq('cliente_id', clienteId)
      if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
      if (dal) q = q.gte('created_at', dal)
      if (al) q = q.lte('created_at', al + 'T23:59:59')
      return q
    }
    const listaAg = await fetchAll(buildAg)
    const { createAdminSupabase: _admAg } = await import('@/lib/supabase-admin')
    await etichettaRitiriSenzaCodice(_admAg(), listaAg)
    return NextResponse.json(listaAg)
  }

  // Master/admin: rete = sé + discendenza. Risale la catena ANCHE con "Tutti i clienti".
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
  const admin = createAdminSupabase()
  let masterFilter: string[] = ['00000000-0000-0000-0000-000000000000']
  if (utente?.master_id) {
    if (masterSel) {
      const mieiDiscendenti = await masterIdsVisibili(admin, utente.master_id)
      masterFilter = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : ['00000000-0000-0000-0000-000000000000']
    } else {
      masterFilter = await masterIdsVisibili(admin, utente.master_id)
    }
  }
  const db: any = masterFilter.length > 1 ? admin : supabase

  // VISIBILITA' PER CONTRATTO POSSEDUTO, come nell'Elenco spedizioni: dei sotto-master si vedono i
  // ritiri sui contratti che possiedo o rivendo, non quelli sui loro contratti privati. Senza, MULTI
  // vedeva 1.891 ritiri in due settimane fatti da Velox, GTS e altri sui contratti loro (14/10/2026).
  // Le mie righe stanno sempre sui miei contratti, quindi il filtro non le tocca.
  let posseduti: string[] | null = null
  if (utente?.master_id && masterFilter.some((id) => id !== utente.master_id)) {
    const { contrattiPossedutiNomi } = await import('@/lib/rete-masters')
    const nn = await contrattiPossedutiNomi(admin, utente.master_id)
    posseduti = nn.length ? nn : null
  }

  const build = () => {
    let q = db.from('ritiri')
      .select(`*, clienti(ragione_sociale), ${posseduti ? 'corrieri!inner(nome_contratto)' : 'corrieri(nome_contratto)'}`)
      .in('master_id', masterFilter)
      // Secondo ordine sull'id: fetchAll legge a pagine, e con lo stesso created_at le righe
      // cambiavano posto fra una pagina e l'altra (doppie o perse).
      .order('created_at', { ascending: false }).order('id', { ascending: false })
    if (posseduti) q = q.in('corrieri.nome_contratto', posseduti)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  }
  const data = await fetchAll(build)
  await rinfrescaStatiPickup(admin, data)
  await etichettaRitiriSenzaCodice(admin, data)

  // Etichetta col nome del sotto-master per i ritiri della rete (null per i miei).
  let out = data || []
  if (masterFilter.length > 1) {
    const { data: ms } = await admin.from('masters').select('id,nome').in('id', masterFilter)
    const nomeById = new Map((ms || []).map((m: any) => [m.id, m.nome]))
    out = (data || []).map((r: any) => ({ ...r, master_rete: r.master_id !== utente?.master_id ? (nomeById.get(r.master_id) || null) : null }))
  }
  return NextResponse.json(out)
}

