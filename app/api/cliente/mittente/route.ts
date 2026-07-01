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

  const { data: cliente, error } = await supabase
    .from('clienti').select('*').eq('id', utente.cliente_id).single()
  if (error || !cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  // Legge i campi mittente: prima "sede operativa" (so_*), poi eventuali fallback
  const c: any = cliente
  const mittente = {
    nome: c.ragione_sociale || c.nome || '',
    indirizzo: c.so_indirizzo || c.indirizzo || '',
    citta: c.so_citta || c.citta || '',
    provincia: c.so_provincia || c.provincia || '',
    cap: c.so_cap || c.cap || '',
    email: c.email || '',
    telefono: c.telefono || '',
  }

  return NextResponse.json({ mittente })
}
