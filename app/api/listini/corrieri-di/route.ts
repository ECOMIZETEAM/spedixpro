import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Corrieri presenti in un LISTINO CLIENTE del master, con le fasce (prezzo minimo per fascia).
// Serve a "⧉ Da listino esistente": scegliere un corriere da un altro listino per copiarlo qui,
// seminando l'editor markup con i prezzi di partenza (come "€ Da costo", ma la base è il listino).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const listinoId = req.nextUrl.searchParams.get('listino')
  if (!listinoId) return NextResponse.json({ error: 'listino mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  // Il listino dev'essere del master (l'admin bypassa RLS: il controllo tenant lo rifaccio a mano).
  const { data: lst } = await admin.from('listini_clienti').select('id')
    .eq('id', listinoId).eq('master_id', utente.master_id).maybeSingle()
  if (!lst) return NextResponse.json({ error: 'Listino non trovato' }, { status: 404 })

  const { data: lcc } = await admin.from('listini_clienti_corrieri').select('corriere_id').eq('listino_id', listinoId)
  const corrIds = [...new Set((lcc || []).map((r: any) => r.corriere_id))]
  if (!corrIds.length) return NextResponse.json({ corrieri: [] })

  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto').in('id', corrIds).eq('master_id', utente.master_id)
  const { data: fasce } = await admin.from('listini_clienti_fasce')
    .select('corriere_id,tipo,peso_max,prezzo').eq('listino_id', listinoId).in('corriere_id', corrIds)

  // fascia = (tipo, peso_max); costo rappresentativo = prezzo MINIMO fra le zone (come "€ Da costo").
  const byCorr = new Map<string, Map<string, { tipo: string; peso: number; costi: number[] }>>()
  for (const f of (fasce || [])) {
    const cid = (f as any).corriere_id
    const tipo = (f as any).tipo === 'oltre' ? 'oltre' : 'fino_a'
    const peso = Number((f as any).peso_max)
    const pr = parseFloat((f as any).prezzo)
    if (!byCorr.has(cid)) byCorr.set(cid, new Map())
    const m = byCorr.get(cid)!; const k = `${tipo}_${peso}`
    if (!m.has(k)) m.set(k, { tipo, peso, costi: [] })
    if (isFinite(pr) && pr > 0) m.get(k)!.costi.push(pr)
  }

  const out = (corr || []).map((c: any) => {
    const m = byCorr.get(c.id) || new Map()
    const ff = Array.from(m.values())
      .sort((a: any, b: any) => a.tipo === 'oltre' ? 1 : b.tipo === 'oltre' ? -1 : a.peso - b.peso)
      .map((g: any) => ({ tipo: g.tipo, peso: g.peso, costo: g.costi.length ? Math.min(...g.costi) : 0, costoMax: g.costi.length ? Math.max(...g.costi) : 0 }))
    return { id: c.id, nome_contratto: c.nome_contratto, fasce: ff }
  }).filter((c: any) => c.fasce.length > 0)
  // SOLO i corrieri con prezzi veri: un corriere agganciato ma SENZA fasce, offerto qui come sorgente
  // di copia, produceva un duplicato VUOTO che si auto-alimentava (copio un vuoto → ottengo un vuoto).
  return NextResponse.json({ corrieri: out })
}
