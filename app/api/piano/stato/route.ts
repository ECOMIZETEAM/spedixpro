import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { rispostaStatoPiano } from '@/lib/limite-piano'

// Quanto del piano e' stato consumato questo mese, per l'avviso in cima alle pagine. Chi vede cosa
// (lo staff i numeri, cliente e agente solo "si puo' spedire o no") sta in rispostaStatoPiano.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  return NextResponse.json(await rispostaStatoPiano(createAdminSupabase(), utente))
}
