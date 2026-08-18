import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Rimuove UN contratto (corriere) da un listino CLIENTE: cancella l'aggancio + le fasce peso/zona
// + i supplementi di QUEL corriere in QUEL listino. Non tocca gli altri contratti del listino.
// Lo STORICO delle spedizioni non è toccato: i prezzi già applicati restano nei movimenti.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const { listinoId, corriereId } = await req.json()
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })

  const admin = createAdminSupabase()
  // Il listino dev'essere del master (no cross-tenant).
  const { data: l } = await admin.from('listini_clienti').select('id,nome')
    .eq('id', listinoId).eq('master_id', utente.master_id).maybeSingle()
  if (!l) return NextResponse.json({ error: 'Listino non trovato' }, { status: 404 })

  await admin.from('listini_clienti_fasce').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)
  await admin.from('listini_clienti_supplementi').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)
  await admin.from('listini_clienti_corrieri').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)

  return NextResponse.json({ ok: true })
}
