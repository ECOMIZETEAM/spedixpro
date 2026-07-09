import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  // Solo un corriere di PROPRIETÀ del master (o sotto-master loggato)
  const { data: corr } = await supabase.from('corrieri').select('id').eq('id', id).eq('master_id', utente.master_id).maybeSingle()
  if (!corr) return NextResponse.json({ error: 'Contratto non trovato o non tuo' }, { status: 404 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // BLOCCO: se il contratto è usato da spedizioni/ritiri/distinte non si può eliminare (perderesti lo storico).
  const usi: [string, string][] = [['spedizioni', 'spedizioni'], ['ritiri', 'ritiri'], ['distinte', 'distinte']]
  for (const [tab, label] of usi) {
    const { count } = await admin.from(tab).select('*', { count: 'exact', head: true }).eq('corriere_id', id)
    if ((count || 0) > 0) {
      return NextResponse.json({ error: `Contratto usato da ${count} ${label}: non eliminabile (perderesti lo storico). Disattivalo dalle Impostazioni.` }, { status: 400 })
    }
  }

  // Rimuovo le dipendenze di CONFIGURAZIONE (FK NO ACTION) prima del corriere.
  await admin.from('listini_clienti_supplementi').delete().eq('corriere_id', id)
  await admin.from('listini_clienti_corrieri').delete().eq('corriere_id', id)
  await admin.from('listini_clienti_fasce').delete().eq('corriere_id', id)
  await admin.from('listini_corrieri_supplementi').delete().eq('corriere_id', id)
  await admin.from('listini_corrieri_corrieri').delete().eq('corriere_id', id)
  await admin.from('listini_corrieri_fasce').delete().eq('corriere_id', id)
  await admin.from('zone').delete().eq('corriere_id', id)

  // Elimino il corriere (CASCADE su listini_corrieri, abilitati, corrieri_cliente/condivisi).
  const { error } = await admin.from('corrieri').delete().eq('id', id).eq('master_id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const campi: any = {}
  if (body.attivo !== undefined) campi.attivo = body.attivo
  if (body.multicollo !== undefined) campi.multicollo = body.multicollo
  if (body.inserimento_ritiri !== undefined) campi.inserimento_ritiri = body.inserimento_ritiri
  if (body.settings !== undefined) campi.settings = body.settings
  const { error } = await supabase
    .from('corrieri')
    .update(campi)
    .eq('id', id)
    .eq('master_id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}