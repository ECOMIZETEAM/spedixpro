import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { eTitolareOAdmin } from '@/lib/ruoli'
import { contabilitaAttiva } from '@/lib/contabilita-banca'

// Chi puo' vedere e toccare l'estratto conto (app/api/contabilita/estratti): solo il titolare del master e
// i suoi admin, sui master dove la contabilita' e' accesa. E' il conto in banca dell'azienda.
export async function chiSei() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!u?.master_id || u.cliente_id || !eTitolareOAdmin(u) || !contabilitaAttiva(u.master_id)) {
    return { errore: NextResponse.json({ error: "L'estratto conto lo vedono solo il titolare e i suoi admin." }, { status: 403 }) }
  }
  return { userId: user.id as string, ruolo: u.ruolo as string, masterId: u.master_id as string }
}
