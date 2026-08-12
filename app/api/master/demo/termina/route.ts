import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Termina SUBITO una prova demo (solo super master): porta la scadenza a ora → login e operazioni
// bloccati all'istante. Non cancella i dati (sono isolati e innocui): è una chiusura sicura e
// reversibile. La pulizia definitiva, se serve, è un lavoro a parte.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: mio } = await admin.from('masters').select('is_super_master,parent_master_id').eq('id', utente.master_id).single()
  if (!(mio?.is_super_master || mio?.parent_master_id === null)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

  // Solo su account effettivamente demo: mai toccare un master reale.
  const { data: t } = await admin.from('masters').select('id,demo').eq('id', id).single()
  if (!t?.demo) return NextResponse.json({ error: 'Non è un account demo' }, { status: 400 })

  const { error } = await admin.from('masters').update({ demo_scadenza: new Date().toISOString() }).eq('id', id).eq('demo', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
