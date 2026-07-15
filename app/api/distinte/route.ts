import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const dal = p.get('dal')
  const al = p.get('al')
  let query = supabase.from('distinte')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
  // Agente: solo le distinte dei suoi clienti.
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data } = await query
  const distinte = data || []

  // Etichetta "Cliente" leggibile anche quando cliente_id è NULL:
  //  - distinta di un SOTTO-MASTER (master_rete_id) -> nome del sotto-master;
  //  - distinta multi-cliente / spedizione propria -> ricavo dalle spedizioni (Più clienti / Spedizione propria).
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
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
  const out = distinte.map((d: any) => {
    let cliente_label = d.clienti?.ragione_sociale || null
    if (!cliente_label && d.master_rete_id) cliente_label = 'Rete: ' + (nomeRete.get(d.master_rete_id) || 'sotto-master')
    if (!cliente_label) {
      const set = clientiPerDistinta.get(d.id)
      if (!set || set.size === 0) cliente_label = 'Spedizione propria'
      else if (set.size === 1) cliente_label = Array.from(set)[0]
      else cliente_label = `Più clienti (${set.size})`
    }
    return { ...d, cliente_label }
  })
  return NextResponse.json(out)
}