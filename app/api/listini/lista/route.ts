import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data: listini } = await supabase.from('listini_clienti').select('id,nome,created_at').eq('master_id', utente?.master_id).order('nome')
  const ids = (listini || []).map((l: any) => l.id)

  // A chi è assegnato ciascun listino: clienti (clienti.listino_cliente_id) + sotto-master (masters.parent_listino_id).
  const assegnatiMap = new Map<string, string[]>()
  if (ids.length) {
    const { data: cli } = await supabase.from('clienti')
      .select('ragione_sociale,listino_cliente_id').eq('master_id', utente?.master_id).in('listino_cliente_id', ids)
    for (const c of (cli || [])) {
      const k = (c as any).listino_cliente_id
      if (!assegnatiMap.has(k)) assegnatiMap.set(k, [])
      if ((c as any).ragione_sociale) assegnatiMap.get(k)!.push((c as any).ragione_sociale)
    }
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sub } = await admin.from('masters').select('nome,parent_listino_id').in('parent_listino_id', ids)
    for (const m of (sub || [])) {
      const k = (m as any).parent_listino_id
      if (!assegnatiMap.has(k)) assegnatiMap.set(k, [])
      if ((m as any).nome) assegnatiMap.get(k)!.push((m as any).nome)
    }
  }

  const out = (listini || []).map((l: any) => ({ ...l, assegnati: (assegnatiMap.get(l.id) || []).sort((a: string, b: string) => a.localeCompare(b)) }))
  return NextResponse.json(out)
}
