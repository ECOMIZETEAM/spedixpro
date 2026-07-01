import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { data: cliente } = await supabase
    .from('clienti').select('listino_cliente_id').eq('id', utente.cliente_id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ corrieri: [] })

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', cliente.listino_cliente_id)

  // Corrieri distinti presenti nel listino
  const map = new Map<string, { id: string; nome: string; tipo: string }>()
  for (const f of fasce || []) {
    const c = (f as any).corrieri
    if (c?.id && !map.has(c.id)) {
      map.set(c.id, { id: c.id, nome: c.nome_contratto || 'Corriere', tipo: c.tipo })
    }
  }

  return NextResponse.json({ corrieri: Array.from(map.values()) })
}
