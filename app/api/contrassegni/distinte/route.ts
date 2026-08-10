import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro, bloccaAgente } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
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
  return NextResponse.json(distinte)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  const mio = utente?.master_id
  const body = await req.json()
  const { spedizioneIds } = body
  if (!spedizioneIds?.length) return NextResponse.json({ error: 'Nessuna spedizione' }, { status: 400 })

  // SOLO i contrassegni ANCORA IN ATTESA: non gia' in una distinta e non pagati. Lo stesso COD non
  // va in due distinte — l'indice unico uniq_righe_cod_sped_per_master lo garantisce nel database,
  // ma qui si scartano prima, cosi' non si creano teste di distinta a vuoto (pagabili due volte).
  const { data: spedizioni } = await supabase.from('spedizioni')
    .select('id,cliente_id,contrassegno,numero,stato_contrassegno,distinta_contrassegno_id')
    .in('id', spedizioneIds)
    .eq('master_id', mio)
    .gt('contrassegno', 0)
    .is('distinta_contrassegno_id', null)
    .or('stato_contrassegno.is.null,stato_contrassegno.eq.in_attesa')

  if (!spedizioni?.length) return NextResponse.json({ error: 'Nessun contrassegno in attesa tra quelli selezionati (già in distinta o pagati).' }, { status: 400 })

  // Raggruppa per cliente (i COD propri del master, senza cliente, non fanno una distinta cliente).
  const clientiMap: Record<string, any[]> = {}
  let saltate = 0
  for (const s of spedizioni) {
    if (!s.cliente_id) { saltate++; continue }
    ;(clientiMap[s.cliente_id] ||= []).push(s)
  }

  const distinte: any[] = []
  for (const [clienteId, sped] of Object.entries(clientiMap)) {
    const totale = Math.round(sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0) * 100) / 100
    // Numero progressivo PER MASTER (indice unico uniq_distinte_cod_master_numero): se due creazioni
    // concorrenti scelgono lo stesso numero, il secondo riprova col successivo. Stessa regola del
    // caricamento da file/rimessa, cosi' la numerazione resta unica e coerente.
    let distinta: any = null
    for (let tentativo = 0; tentativo < 8 && !distinta; tentativo++) {
      const { data: ultima } = await supabase.from('distinte_contrassegni')
        .select('numero').eq('master_id', mio).order('numero', { ascending: false }).limit(1).maybeSingle()
      const numero = Number(ultima?.numero || 1000) + 1 + tentativo
      const { data, error } = await supabase.from('distinte_contrassegni').insert({
        master_id: mio, cliente_id: clienteId, numero,
        totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
      }).select('id,numero').single()
      if (!error && data?.id) distinta = data
      else if (error && !String(error.message || '').includes('uniq_distinte_cod_master_numero')) break
    }
    if (!distinta?.id) { saltate += sped.length; continue }

    // Le RIGHE devono esistere: se l'indice unico rifiuta l'INSERT (un COD gia' in una mia distinta)
    // la testata va rimossa, altrimenti resta una distinta col totale pieno e zero righe.
    const { error: errRighe } = await supabase.from('distinte_contrassegni_righe').insert(sped.map(s => ({
      distinta_id: distinta.id, spedizione_id: s.id,
      numero_spedizione: s.numero, importo_cod: Number(s.contrassegno), importo_sistema: Number(s.contrassegno),
    })))
    if (errRighe) {
      await supabase.from('distinte_contrassegni').delete().eq('id', distinta.id)
      saltate += sped.length
      continue
    }
    await supabase.from('spedizioni').update({
      stato_contrassegno: 'in_distinta', distinta_contrassegno_id: distinta.id,
    }).in('id', sped.map(s => s.id))
    distinte.push(distinta)
  }

  return NextResponse.json({ success: true, distinte, create: distinte.length, saltate })
}