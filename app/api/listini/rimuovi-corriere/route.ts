import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Rimuove UN contratto (corriere) da un listino CLIENTE: cancella l'aggancio + le fasce peso/zona
// + i supplementi di QUEL corriere in QUEL listino. Non tocca gli altri contratti del listino.
// Lo STORICO delle spedizioni non è toccato: i prezzi già applicati restano nei movimenti.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const { listinoId, corriereId } = await req.json()
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })

  const admin = createAdminSupabase()
  // Il listino dev'essere del master (no cross-tenant).
  const { data: l } = await admin.from('listini_clienti').select('id,nome')
    .eq('id', listinoId).eq('master_id', utente.master_id).maybeSingle()
  if (!l) return NextResponse.json({ error: 'Listino non trovato' }, { status: 404 })

  // SI CANCELLA CON LA SESSIONE DI CHI CLICCA, non con la chiave di servizio. Il registro attivita'
  // scrive come autore l'utente della sessione, e con la chiave di servizio scriveva
  // "sistema/propagazione": il 17/09/2026 tre contratti tolti a mano da un master dal listino di un
  // cliente sembravano un'operazione automatica, e ci e' voluto il confronto dei secondi fra un
  // clic e l'altro per capire chi era stato. Le policy lo permettono gia' allo staff del master
  // sui listini della sua rete (scripts/rls-scritture-staff.sql); il controllo qui sopra resta piu'
  // stretto (solo listini SUOI).
  // Fasce per prime: sono loro che prezzano (il motore legge le fasce anche senza l'aggancio), quindi
  // se qualcosa si ferma a meta' il contratto resta senza prezzo, non con un prezzo orfano.
  await supabase.from('listini_clienti_fasce').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)
  await supabase.from('listini_clienti_supplementi').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)
  await supabase.from('listini_clienti_corrieri').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)

  // Una DELETE che le policy non lasciano passare non da' errore: toglie zero righe. Senza questa
  // verifica il master vedrebbe "fatto" su un contratto ancora al suo posto.
  const resta = async (t: string) => (await admin.from(t).select('id', { count: 'exact', head: true })
    .eq('listino_id', listinoId).eq('corriere_id', corriereId)).count || 0
  const rimaste = (await resta('listini_clienti_fasce')) + (await resta('listini_clienti_supplementi')) + (await resta('listini_clienti_corrieri'))
  if (rimaste > 0) return NextResponse.json({ error: 'Rimozione non completata: permesso negato su una parte del listino. Riprova o contatta l\'assistenza.' }, { status: 403 })

  return NextResponse.json({ ok: true })
}
