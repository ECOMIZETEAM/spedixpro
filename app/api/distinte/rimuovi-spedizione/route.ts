import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

// Toglie UNA spedizione da una distinta (distinta_id -> null), rimettendola nel pool "senza distinta"
// cosi' e' riassegnabile a un'altra distinta. Scelta condivisa 9/9: e' SOLO riorganizzazione, NON
// annulla la trasmissione al corriere (la spedizione e' gia' partita). Si usa il client admin per
// scrivere (la RLS non farebbe passare la scrittura sulle spedizioni della rete), percio' il perimetro
// va RIVERIFICATO a mano (vedi memoria admin-bypassa-rls): la spedizione deve stare nel mio sotto-albero
// e, per l'agente, essere di un suo cliente.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const spedizioneId = body?.spedizioneId
  if (!spedizioneId) return NextResponse.json({ error: 'Spedizione mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id, master_id, cliente_id, distinta_id').eq('id', spedizioneId).maybeSingle()
  if (!sped || !sped.distinta_id) return NextResponse.json({ error: 'Spedizione non in distinta' }, { status: 404 })

  // Perimetro: deve stare nel mio sotto-albero.
  const subtree = await sottoAlberoMasterIds(admin, utente.master_id)
  if (!subtree.includes(sped.master_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  // Agente: solo spedizioni dei suoi clienti.
  if (isAgente(utente as any)) {
    const suoi = idClientiPerFiltro(await clientiAgente(supabase, utente as any))
    if (!sped.cliente_id || !suoi.includes(sped.cliente_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const distintaId = sped.distinta_id
  const { error: errUpd } = await admin.from('spedizioni').update({ distinta_id: null }).eq('id', spedizioneId)
  if (errUpd) return NextResponse.json({ error: errUpd.message }, { status: 400 })

  // Ricalcolo i totali della distinta dalle spedizioni rimaste (l'elenco mostra totale_ldv/colli/peso).
  const { data: rimaste } = await admin.from('spedizioni')
    .select('colli, peso_reale, costo_totale').eq('distinta_id', distintaId)
  const tot = (rimaste || []).reduce((a: any, s: any) => ({
    colli: a.colli + Number(s.colli || 1),
    peso: a.peso + Number(s.peso_reale || 0),
    prezzo: a.prezzo + Number(s.costo_totale || 0),
  }), { colli: 0, peso: 0, prezzo: 0 })
  await admin.from('distinte').update({
    totale_colli: tot.colli, totale_peso: tot.peso, totale_ldv: (rimaste || []).length, prezzo_totale: tot.prezzo,
  }).eq('id', distintaId)

  return NextResponse.json({ success: true, distintaId, rimaste: (rimaste || []).length })
}
