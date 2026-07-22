import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Badge "Giacenze" del menu cliente (come il pallino rosso dell'assistenza):
// GET  -> quante giacenze NUOVE (entrate DOPO l'ultima visita alla pagina Giacenze)
// POST -> segna viste adesso (chiamata all'apertura della pagina Giacenze)
// Il "visto" vive in clienti.impostazioni.giacenze_viste_al (merge, non sovrascrive le altre impostazioni).

async function clienteId(supabase: any): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  return utente?.cliente_id || null
}

export async function GET() {
  const supabase = await createServerSupabase()
  const id = await clienteId(supabase)
  if (!id) return NextResponse.json({ count: 0 })
  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti').select('impostazioni').eq('id', id).maybeSingle()
  const vistoAl = (cli?.impostazioni as any)?.giacenze_viste_al || '1970-01-01T00:00:00Z'
  const { count } = await admin.from('spedizioni')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', id)
    .eq('stato', 'in_giacenza')
    .gt('giacenza_data', vistoAl)
  return NextResponse.json({ count: count || 0 })
}

export async function POST() {
  const supabase = await createServerSupabase()
  const id = await clienteId(supabase)
  if (!id) return NextResponse.json({ ok: false }, { status: 401 })
  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti').select('impostazioni').eq('id', id).maybeSingle()
  const imp = { ...((cli?.impostazioni as any) || {}), giacenze_viste_al: new Date().toISOString() }
  await admin.from('clienti').update({ impostazioni: imp }).eq('id', id)
  return NextResponse.json({ ok: true })
}
