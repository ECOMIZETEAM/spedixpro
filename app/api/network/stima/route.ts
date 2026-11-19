import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { righeDaStimare, scriviStime } from '@/lib/network-stima'

export const maxDuration = 60

// QUANTO RECUPERI, ALL'APERTURA DI «DAL MIO NETWORK» (lib/network-stima). Il giro automatico passa ogni 5 minuti: se il
// master apre la pagina prima, le sue rettifiche nuove si stimano adesso, fino a 45 secondi, e la pagina si ricarica.
// Solo le sue (target = il suo master), solo la frase sulla riga.
export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  try {
    const { senza } = await righeDaStimare(admin, utente.master_id)
    const fatte = senza.length ? await scriviStime(admin, senza, Date.now() + 45 * 1000) : 0
    return NextResponse.json({ ok: true, fatte, restano: Math.max(0, senza.length - fatte) })
  } catch (e: any) {
    console.error('[STIMA] apertura pagina:', e?.message || e)
    return NextResponse.json({ error: 'Calcolo non riuscito' }, { status: 500 })
  }
}
