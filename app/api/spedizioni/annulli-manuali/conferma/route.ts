import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'

// Il DETENTORE del contratto conferma che l'annullo Spedisci è stato eseguito (via assistenza):
// la spedizione passa ad 'annullata' + storno credito. Solo l'owner può confermare.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const spedizioneId = req.nextUrl.searchParams.get('id') || (await req.json().catch(() => ({}))).id
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,stato,annullamento_owner_id,annullamento_da')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  if (sped.stato !== 'annullamento_manuale') return NextResponse.json({ error: 'La spedizione non è in coda annullo manuale.' }, { status: 400 })
  if (sped.annullamento_owner_id !== utente.master_id) return NextResponse.json({ error: 'Solo il detentore del contratto può confermare questo annullo.' }, { status: 403 })

  const { error } = await admin.from('spedizioni').update({ stato: 'annullata', annullamento_errore: null }).eq('id', spedizioneId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await rimborsaAnnulloSpedizione(admin, sped as any, (sped as any).annullamento_da || null)
  return NextResponse.json({ success: true })
}
