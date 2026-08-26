import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Elenco degli account demo generati (solo super master). Serve alla pagina di gestione demo.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: mio } = await admin.from('masters').select('is_super_master,parent_master_id').eq('id', utente.master_id).single()
  // SOLO il super-master vero. NON "parent_master_id === null": le demo SONO create come root isolati
  // (parent null), quindi quel ramo le lasciava gestire le altre demo (listare le email, crearne,
  // terminarle). Verificato: 1 solo is_super_master reale, le 2 demo hanno parent null ma non il flag.
  if (!mio?.is_super_master) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { data: demos } = await admin.from('masters')
    .select('id,nome,email,demo_scadenza,created_at')
    .eq('demo', true).order('created_at', { ascending: false }).limit(200)

  const ora = Date.now()
  const lista = (demos || []).map((d: any) => ({
    id: d.id, nome: d.nome, email: d.email, scadenza: d.demo_scadenza, creata: d.created_at,
    scaduta: !!d.demo_scadenza && new Date(d.demo_scadenza).getTime() < ora,
  }))
  return NextResponse.json({ demos: lista })
}
