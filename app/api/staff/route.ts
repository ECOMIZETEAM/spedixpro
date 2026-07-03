import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Lista staff del master: utenti + email/ultimo_accesso da auth
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: me } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!me?.master_id) return NextResponse.json([])

  const { data: utenti } = await supabase.from('utenti')
    .select('id,nome,cognome,telefono,ruolo,attivo,created_at')
    .eq('master_id', me.master_id)
    .order('nome', { ascending: true })

  const admin = createAdminSupabase()
  const risultato = []
  for (const u of (utenti || [])) {
    let email = ''
    let ultimoAccesso = null
    try {
      const { data: au } = await admin.auth.admin.getUserById(u.id)
      email = au?.user?.email || ''
      ultimoAccesso = au?.user?.last_sign_in_at || null
    } catch {}
    risultato.push({ ...u, email, ultimo_accesso: ultimoAccesso })
  }
  return NextResponse.json(risultato)
}