import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente } from '@/lib/agente'

// Pacchi predefiniti (misure + peso) di UN cliente, per la Nuova Spedizione lato master/agente.
// Scoped: il cliente deve appartenere alla rete del master (o essere un cliente dell'agente).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json([])

  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti').select('id,master_id,agente').eq('id', id).maybeSingle()
  if (!cli) return NextResponse.json([])
  // Il cliente deve stare nella rete del master
  const sub = await sottoAlberoMasterIds(admin, utente.master_id)
  if (!sub.includes(cli.master_id)) return NextResponse.json([])
  // Agente: solo suoi clienti
  if (isAgente(utente as any)) {
    const miei = await clientiAgente(supabase, utente as any)
    if (!miei.includes(id)) return NextResponse.json([])
  }
  const { data } = await admin.from('pacchi_predefiniti').select('*').eq('cliente_id', id).order('created_at', { ascending: true })
  return NextResponse.json(data || [])
}
