import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })   // elimina contratto+listini: solo chi gestisce la rete

  // Solo un corriere di PROPRIETÀ del master (o sotto-master loggato)
  const { data: corr } = await supabase.from('corrieri').select('id').eq('id', id).eq('master_id', utente.master_id).maybeSingle()
  if (!corr) return NextResponse.json({ error: 'Contratto non trovato o non tuo' }, { status: 404 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // BLOCCO: se il contratto è usato da spedizioni/ritiri/distinte non si può eliminare (perderesti lo
  // storico). La configurazione (zone, listini, fasce, supplementi, abilitazioni) cade con lui per i
  // vincoli del database, nella stessa istruzione: lib/elimina-contratto.ts.
  const { eliminaContrattiSenzaStorico } = await import('@/lib/elimina-contratto')
  const r = await eliminaContrattiSenzaStorico(admin, [id])
  if (!r.ok) {
    const s = r.storico
    const uso = s && ([['spedizioni', s.spedizioni], ['ritiri', s.ritiri], ['distinte', s.distinte]] as [string, number][]).find(([, n]) => n > 0)
    if (uso) return NextResponse.json({ error: `Contratto usato da ${uso[1]} ${uso[0]}: non eliminabile (perderesti lo storico). Disattivalo dalle Impostazioni.` }, { status: 400 })
    return NextResponse.json({ error: r.reason }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // Il PATCH cambia la config del corriere (attivo/multicollo/settings): era guardato dal solo
  // master_id, che ce l'hanno anche cliente/agente/autista. Solo chi gestisce la rete.
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json()
  const campi: any = {}
  if (body.attivo !== undefined) campi.attivo = body.attivo
  if (body.multicollo !== undefined) campi.multicollo = body.multicollo
  if (body.inserimento_ritiri !== undefined) campi.inserimento_ritiri = body.inserimento_ritiri
  if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
    // UNIRE, NON SOSTITUIRE. Il popup "Impostazioni" manda solo i suoi campi (mittente, misure, pesi,
    // colli) e qui si salvavano al posto dell'intero blocco: ogni salvataggio cancellava le altre
    // impostazioni del contratto — `consegna` del locker InPost, `tipo_servizio` FedEx (senza, la
    // creazione si ferma), `somma_lati_max` del PDB (un limite su un fornitore senza annullo).
    // Trovato il 13/10/2026. Una chiave si spegne mandandola a null, come gia' fa il popup.
    const { data: attuale, error: eLett } = await supabase.from('corrieri').select('settings').eq('id', id).eq('master_id', utente.master_id).maybeSingle()
    if (eLett) return NextResponse.json({ error: eLett.message }, { status: 400 })
    if (!attuale) return NextResponse.json({ error: 'Contratto non trovato o non tuo' }, { status: 404 })
    campi.settings = { ...((attuale as any).settings || {}), ...body.settings }
  }
  const { error } = await supabase
    .from('corrieri')
    .update(campi)
    .eq('id', id)
    .eq('master_id', utente.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}