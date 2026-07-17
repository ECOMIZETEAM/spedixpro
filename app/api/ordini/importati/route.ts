import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lista degli ordini importati da file (CSV/Excel) del cliente in sessione.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  // Escludo 'raw' (JSON completo, pesante)
  const ordini = await fetchAll(() => supabase
    .from('ordini_importati')
    .select('id,destinatario,indirizzo,cap,localita,provincia,country,telefono,email_destinatario,peso,colli,contrassegno,contenuto,sku,note,rif_mittente,rif_destinatario,order_id,totale_ordine,fonte,stato,errore,spedizione_id,created_at')
    .eq('cliente_id', utente.cliente_id)
    .order('created_at', { ascending: false }))
  return NextResponse.json({ ordini })
}
