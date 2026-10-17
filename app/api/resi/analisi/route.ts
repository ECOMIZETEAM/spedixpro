import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/ruoli'
import { isAgente, clientiAgente } from '@/lib/agente'
import { analisiResiRete } from '@/lib/resi-analisi'
import { periodoValido } from '@/lib/resi-percentuale'

// ANALISI RESI DEL PORTALE MASTER: la percentuale resi dei clienti della propria rete (clienti diretti e
// sotto-master coi loro clienti). La usano la sezione Resi > Analisi resi e il blocco in dashboard
// (?riepilogo=1: solo totale, conteggi e peggiori, senza l'albero).
// Perimetro: la rete del master di chi chiama; l'agente solo i suoi clienti. Il cliente non entra qui:
// la sua percentuale la da' /api/cliente/resi/percentuale.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id || !vedeLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const giorni = periodoValido(req.nextUrl.searchParams.get('giorni'))
  const riepilogo = req.nextUrl.searchParams.get('riepilogo') === '1'
  const admin = createAdminSupabase()
  try {
    const opz = isAgente(utente) ? { soloClienti: await clientiAgente(supabase, utente) } : {}
    const a = await analisiResiRete(admin, utente.master_id, giorni, opz)
    if (riepilogo) return NextResponse.json({ giorni: a.giorni, totale: a.totale, allarmi: a.allarmi, peggiori: a.peggiori.slice(0, 5) })
    return NextResponse.json(a)
  } catch (e: any) {
    console.error('[RESI][ANALISI]', e?.message)
    return NextResponse.json({ error: 'Analisi resi non disponibile, riprova tra poco' }, { status: 500 })
  }
}
