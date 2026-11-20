import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { eArgomento } from '@/app/components/grafica/argomenti'

// Il voto sulla nuova versione (Lorenzo 19/11): GET il proprio voto (per ritrovarlo nella scheda), POST lo salva o lo
// cambia. Uno per persona e per argomento (la nuova versione; dal 20/11 anche la Nuova spedizione, app/components/
// grafica/argomenti.ts). La tabella grafica_voti non è leggibile né scrivibile da anon e authenticated: passa tutto
// da qui, col client di servizio, e chi vota è SEMPRE l'utente della sessione (master e cliente li prende dal suo
// profilo, non da quello che arriva nella richiesta).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const argomento = req.nextUrl.searchParams.get('argomento') || 'versione'
  if (!eArgomento(argomento)) return NextResponse.json({ error: 'Argomento sconosciuto' }, { status: 400 })
  const { data } = await createAdminSupabase().from('grafica_voti').select('voto,commento')
    .eq('utente_id', user.id).eq('argomento', argomento).maybeSingle()
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
  const argomento = corpo?.argomento ?? 'versione'
  if (!eArgomento(argomento)) return NextResponse.json({ error: 'Argomento sconosciuto' }, { status: 400 })
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).maybeSingle()
  const adesso = new Date().toISOString()
  const { error } = await createAdminSupabase().from('grafica_voti').upsert({
    utente_id: user.id, master_id: utente?.master_id || null, cliente_id: utente?.cliente_id || null, ruolo: utente?.ruolo || null,
    voto, commento: commento || null, pagina, argomento, aggiornato_il: adesso,
  }, { onConflict: 'utente_id,argomento' })
  if (error) return NextResponse.json({ error: 'Voto non salvato' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
