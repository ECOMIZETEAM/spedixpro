import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// L'interruttore della grafica nuova (v11): /api/grafica?v=nuova|vecchia&torna=/dashboard/…
// Lorenzo 27/10: prima si fanno e si controllano TUTTE le pagine, poi ogni master e cliente avrà il pulsante per
// provarla e votarla. Fino ad allora l'interruttore funziona solo per il super master; per gli altri è come se non
// esistesse (e il layout ignora il biscotto: vedi app/dashboard/layout.tsx).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/', req.url))
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).maybeSingle()
  const { data: m } = utente?.master_id
    ? await supabase.from('masters').select('is_super_master').eq('id', utente.master_id).maybeSingle()
    : { data: null }
  // solo percorsi interni del portale: un «torna» verso un altro sito sarebbe un rimbalzo aperto
  const torna = req.nextUrl.searchParams.get('torna') || '/dashboard'
  const dove = torna.startsWith('/dashboard') ? torna : '/dashboard'
  const r = NextResponse.redirect(new URL(dove, req.url))
  const prova = (process.env.GRAFICA_PROVA_MASTER_IDS || '').split(',').map(x => x.trim()).filter(Boolean)
  if (!m?.is_super_master && !(utente?.master_id && prova.includes(utente.master_id))) return r
  if (req.nextUrl.searchParams.get('v') === 'nuova') r.cookies.set('mx_grafica', 'nuova', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  else r.cookies.delete('mx_grafica')
  // la v12 (27/10) non è piaciuta e non c'è più: il suo biscotto, se è rimasto nel browser, se ne va
  r.cookies.delete('mx_versione')
  // &plancia=a|b|c|d: una delle quattro proposte di Plancia del 27/10 (Lorenzo: «4 versioni differenti, completamente
  // diverse»); &plancia=attuale torna alla v11
  const plancia = req.nextUrl.searchParams.get('plancia')
  if (plancia && ['a', 'b', 'c', 'd'].includes(plancia)) r.cookies.set('mx_plancia', plancia, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  else if (plancia === 'attuale') r.cookies.delete('mx_plancia')
  return r
}
