import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { vedeLaRete } from '@/lib/ruoli'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // Gli estratti dei contrassegni incassati sono documenti interni del master: dicono quanto il
  // corriere gli ha girato e quando. Senza questo controllo bastava `master_id` — che hanno anche le
  // utenze cliente — per scaricarsi l'elenco.
  if (!vedeLaRete(utente)) return NextResponse.json([])
  const { data } = await supabase.from('cod_files').select('*').eq('master_id', utente?.master_id).order('created_at', { ascending: false }).limit(20)
  return NextResponse.json(data || [])
}