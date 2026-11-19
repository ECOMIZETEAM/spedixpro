import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Il voto sulla nuova versione (Lorenzo 19/11): GET il proprio voto (per ritrovarlo nella scheda), POST lo salva o lo
// cambia. Uno per persona. La tabella grafica_voti non è leggibile né scrivibile da anon e authenticated: passa tutto
// da qui, col client di servizio, e chi vota è SEMPRE l'utente della sessione (master e cliente li prende dal suo
// profilo, non da quello che arriva nella richiesta).
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data } = await createAdminSupabase().from('grafica_voti').select('voto,commento').eq('utente_id', user.id).maybeSingle()
  return NextResponse.json(data || {})
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const corpo = await req.json().catch(() => null)
  const voto = Number(corpo?.voto)
  if (!Number.isInteger(voto) || voto < 1 || voto > 5) return NextResponse.json({ error: 'Il voto va da 1 a 5' }, { status: 400 })
  const commento = typeof corpo?.commento === 'string' ? corpo.commento.trim().slice(0, 2000) : ''
  const pagina = typeof corpo?.pagina === 'string' ? corpo.pagina.slice(0, 200) : null
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).maybeSingle()
  const adesso = new Date().toISOString()
  const { error } = await createAdminSupabase().from('grafica_voti').upsert({
    utente_id: user.id, master_id: utente?.master_id || null, cliente_id: utente?.cliente_id || null, ruolo: utente?.ruolo || null,
    voto, commento: commento || null, pagina, aggiornato_il: adesso,
  }, { onConflict: 'utente_id' })
  if (error) return NextResponse.json({ error: 'Voto non salvato' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
