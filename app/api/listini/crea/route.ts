import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  const body = await req.json()
  const { nome, corriereIds, listinoId } = body
  if (!nome) return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 })

  if (listinoId) {
    // Listino già esistente: stiamo solo "agganciando" altri contratti, nessuna riga extra necessaria
    // perché i contratti vengono mostrati in base ai dati salvati su listini_clienti_fasce/supplementi.
    // Qui ci limitiamo a confermare l'operazione.
    return NextResponse.json({ id: listinoId, nome })
  }

  const { data: listino, error } = await supabase.from('listini_clienti').insert({
    master_id: utente?.master_id,
    nome,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(listino)
}