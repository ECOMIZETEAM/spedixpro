import { NextRequest, NextResponse } from 'next/server'
import { sessioneCliente } from '../comune'

// L'elenco dei report archiviati dal cliente. Un errore di lettura si dice: prima tornava un elenco
// vuoto e la pagina scriveva "Nessun report generato" anche a chi ne aveva.
export async function GET(req: NextRequest) {
  const s = await sessioneCliente()
  if ('errore' in s) return s.errore
  const tipo = req.nextUrl.searchParams.get('tipo')
  let query = s.supabase.from('reports_generati')
    .select('*')
    .eq('cliente_id', s.clienteId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (tipo) query = query.eq('tipo', tipo)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}
