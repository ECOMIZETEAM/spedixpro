import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
import { SPED_COLS_CLIENTE } from '@/lib/spedizioni-cols'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const p = req.nextUrl.searchParams
  const stato = p.get('stato')
  const dal = p.get('dal')
  const al = p.get('al')
  const contrassegno = p.get('contrassegno')
  const provincia = p.get('provincia')
  const buildBase = () => {
    let q = supabase.from('spedizioni')
      // MAI select('*') su una tabella che il cliente legge: mandava al browser anche
      // costo_spedizione (il costo del MASTER, quindi il suo guadagno), raw_response (dati del
      // provider) e etichetta_url (154 kB di PDF per riga). La pagina non li mostrava, ma
      // bastava aprire gli strumenti per sviluppatori.
      // corrieri(nome_contratto) e distinte(data,bordero_id) servono al report (colonne Corriere/
      // Contratto/Data_distinta/bda). NON esce mai il costo del master: SPED_COLS_CLIENTE gia' toglie
      // costo_spedizione, e non si joina niente che riveli il provider (nome_contratto e' il brand).
      .select(`${SPED_COLS_CLIENTE}, clienti(ragione_sociale), corrieri(nome_contratto)`)
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
    if (stato) q = q.eq('stato', stato)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    if (contrassegno === 'si') q = q.gt('contrassegno', 0)
    if (contrassegno === 'no') q = q.eq('contrassegno', 0)
    if (provincia) q = q.eq('dest_provincia', provincia)
    return q
  }
  // Report COMPLETO a blocchi (il DB tronca a 1000/query). Nessun limite pratico.
  const spedizioni = await fetchAll(buildBase)
  // DATA CONSEGNA (colonna del report): data_evento piu' recente per le CONSEGNATE. Via RLS (supabase):
  // il cliente legge solo gli eventi delle proprie spedizioni.
  const consegnaMap = new Map<string, string>()
  const deliveredIds = (spedizioni || []).filter((s: any) => /conseg/i.test(s.stato || '') && !/in[\s_]?conseg/i.test(s.stato || '')).map((s: any) => s.id)
  for (let i = 0; i < deliveredIds.length; i += 300) {
    const { data: ev } = await supabase.from('tracking_events').select('spedizione_id,data_evento').in('spedizione_id', deliveredIds.slice(i, i + 300))
    for (const e of (ev || [])) {
      const d = (e as any).data_evento; if (!d) continue
      const p = consegnaMap.get((e as any).spedizione_id)
      if (!p || d > p) consegnaMap.set((e as any).spedizione_id, d)
    }
  }
  // DISTINTA (data + bordero) per Data_distinta/bda: nessuna FK spedizioni->distinte, niente embed (che
  // vuoterebbe il report): lookup in blocco per distinta_id. RLS: il cliente legge solo le proprie.
  const distMap = new Map<string, any>()
  const distIds = Array.from(new Set((spedizioni || []).map((s: any) => s.distinta_id).filter(Boolean)))
  for (let i = 0; i < distIds.length; i += 300) {
    const { data: ds } = await supabase.from('distinte').select('id,data,bordero_id').in('id', distIds.slice(i, i + 300))
    for (const d of (ds || [])) distMap.set((d as any).id, { data: (d as any).data, bordero_id: (d as any).bordero_id })
  }
  return NextResponse.json((spedizioni || []).map((s: any) => ({ ...s, data_consegna: consegnaMap.get(s.id) || null, distinte: distMap.get(s.distinta_id) || null })))
}