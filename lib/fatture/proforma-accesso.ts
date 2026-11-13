import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { getPermessiUtente, haPermesso, nonStaffMaster } from '@/lib/permessi'

// CHI PUO' USARE LE PROFORME. Le rotte leggono e scrivono col client di servizio (la tabella e' chiusa
// a tutti), quindi il perimetro e' tutto qui: lo staff del master (titolare, admin, operatore) col
// permesso delle fatture, e il master e' sempre quello di chi e' loggato, mai uno passato dalla pagina.
//
// Fuori clienti e agenti, anche se il default dei permessi da' all'agente "Visualizza fatture": una
// proforma dice quanto il master vende a un cliente, e l'agente vede solo i suoi.
export async function accessoProforma(
  permesso: 'admin.invoice.index' | 'admin.invoice.create',
): Promise<{ ok: true; masterId: string; userId: string } | { ok: false; risposta: NextResponse }> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, risposta: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (nonStaffMaster(utente)) return { ok: false, risposta: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  const p = await getPermessiUtente()
  if (!haPermesso(p, permesso)) return { ok: false, risposta: NextResponse.json({ error: 'Non hai il permesso per le fatture' }, { status: 403 }) }
  return { ok: true, masterId: utente!.master_id as string, userId: user.id }
}
