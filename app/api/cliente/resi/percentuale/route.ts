import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { percentualeResiCliente } from '@/lib/resi-analisi'
import { periodoValido } from '@/lib/resi-percentuale'

// LA PERCENTUALE RESI DEL CLIENTE, nel suo portale (dashboard e sezione Resi): solo la sua, dal cliente
// della sessione. Lo stesso conteggio e gli stessi colori che vede il suo master.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const giorni = periodoValido(req.nextUrl.searchParams.get('giorni'))
  try {
    return NextResponse.json(await percentualeResiCliente(createAdminSupabase(), utente.cliente_id, giorni))
  } catch (e: any) {
    console.error('[RESI][PERCENTUALE CLIENTE]', e?.message)
    return NextResponse.json({ error: 'Percentuale resi non disponibile, riprova tra poco' }, { status: 500 })
  }
}
