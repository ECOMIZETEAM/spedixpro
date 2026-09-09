import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  // GLI ORDINI NON DEVONO RESTARE ORFANI.
  //
  // Non c'e' nessuna FK da ordini_ecommerce a integrazioni: cancellando l'integrazione, gli ordini
  // restavano con un integrazione_id che non punta piu' a niente. E i redact GDPR li risolvevano
  // proprio passando da li', quindi quegli ordini — con nome, indirizzo, email e telefono di
  // clienti finali — diventavano IRRAGGIUNGIBILI da qualsiasi cancellazione, per sempre.
  // Il 9/09/2026 erano 4.147 su 40.691.
  // Adesso il dominio del negozio resta scritto sull'ordine (colonna `shop`), quindi il redact li
  // trova comunque; ma la cosa giusta e' non crearli proprio.
  const { data: daEliminare } = await supabase
    .from('integrazioni').select('identificativo')
    .eq('id', id).eq('cliente_id', utente.cliente_id).maybeSingle()

  const { error } = await supabase
    .from('integrazioni')
    .delete()
    .eq('id', id)
    .eq('cliente_id', utente.cliente_id)   // isolamento

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Dopo la cancellazione: si allineano gli ordini rimasti indietro, cosi' il dominio c'e' anche
  // sulle righe scritte prima che la colonna esistesse. Best-effort: l'integrazione e' gia' via.
  if ((daEliminare as any)?.identificativo) {
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      await createAdminSupabase().from('ordini_ecommerce')
        .update({ shop: (daEliminare as any).identificativo })
        .eq('integrazione_id', id).is('shop', null)
    } catch { /* il redact ha comunque il ripiego per integrazione_id */ }
  }
  return NextResponse.json({ ok: true })
}
