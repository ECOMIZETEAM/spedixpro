import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contaBadgeRete } from '@/lib/badge-rete'

// CONTEGGI PER I DUE BADGE DELLA RETE ("Dal mio network" e "Rettifica Costi"): cosa contano e perche'
// sta in lib/badge-rete.ts. Qui resta il cancello: solo lo staff di rete, e solo sul master della
// sessione — il conteggio legge col client di servizio, quindi il perimetro lo decide questa rotta.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  // Stessa guardia di ricevuti: il ruolo, non l'elenco di quelli da escludere (l'autista ha un master_id).
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ daAccettare: 0, daConfermare: 0 })
  }
  return NextResponse.json(await contaBadgeRete(createAdminSupabase(), utente.master_id))
}
