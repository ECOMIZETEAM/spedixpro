import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const id = req.nextUrl.searchParams.get('id')
  if (!id || !utente?.master_id) return NextResponse.json([])

  const admin = createAdminSupabase()
  const cols = 'numero,dest_nome,dest_indirizzo,dest_cap,dest_citta,dest_provincia,rif_destinatario,assicurazione,contrassegno,colli,peso_reale'

  // Autorizzazione: la distinta deve appartenere al mio sotto-albero (mie + rete).
  const { data: dist } = await admin.from('distinte').select('master_id').eq('id', id).maybeSingle()
  if (!dist) return NextResponse.json([])
  const subtree = await sottoAlberoMasterIds(admin, utente.master_id)
  if (!subtree.includes((dist as any).master_id)) return NextResponse.json([])

  let q = admin.from('spedizioni').select(cols).eq('distinta_id', id).order('created_at', { ascending: true })
  // Agente: solo le spedizioni dei suoi clienti dentro la distinta.
  if (isAgente(utente as any)) q = q.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
  const { data } = await q
  return NextResponse.json(data || [])
}
