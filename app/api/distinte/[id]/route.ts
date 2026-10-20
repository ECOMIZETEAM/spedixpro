import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { vedeLaRete } from '@/lib/ruoli'
import { ledgerFornitoriDaNascondere } from '@/lib/gambe-visibilita'
import { borderoSenzaDettaglio } from '@/lib/report-spedizioni-cols'

// Dettaglio di UNA distinta (header + righe spedizioni) per la pagina /dashboard/distinte/[id].
// NB: /api/distinte/dettaglio (senza id in path) resta e serve ai generatori PDF/Excel; qui torna una
// forma piu' ricca {distinta, spedizioni} con l'id spedizione e il contratto per riga (serve al tasto
// "togli dalla distinta" e a mostrare le distinte MISTE, dove ogni riga puo' avere un contratto diverso).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome,cliente_id').eq('id', user.id).single()
  if (!id || !utente?.master_id) return NextResponse.json({ error: 'Non trovata' }, { status: 404 })
  const eCliente = (utente.ruolo || '').toLowerCase() === 'cliente'

  const admin = createAdminSupabase()
  const { data: distinta } = await admin.from('distinte')
    .select('id, numero, data, stato, corriere_id, cliente_id, master_id, master_rete_id, confermata_vettore, data_conferma, bordero_id, totale_colli, totale_peso, totale_ldv, prezzo_totale, created_at, clienti(ragione_sociale), corrieri(nome_contratto)')
    .eq('id', id).maybeSingle()
  if (!distinta) return NextResponse.json({ error: 'Non trovata' }, { status: 404 })

  // IL RUOLO PRIMA DEL SOTTO-ALBERO. Si controllava solo che la distinta stesse nella rete del master
  // dell'utente, e il master_id ce l'hanno anche il cliente e l'autista: con l'id di una distinta
  // qualunque della rete ne leggevano le righe, destinatari e citta' di clienti non loro. Il cliente
  // vede soltanto la PROPRIA distinta, e dentro solo le sue spedizioni; l'autista nessuna.
  if (eCliente) {
    if (!utente.cliente_id || (distinta as any).cliente_id !== utente.cliente_id) return NextResponse.json({ error: 'Non autorizzata' }, { status: 403 })
  } else if (!vedeLaRete(utente)) {
    return NextResponse.json({ error: 'Non autorizzata' }, { status: 403 })
  } else {
    // Perimetro: la distinta deve stare nel mio sotto-albero (mie + rete).
    const subtree = await sottoAlberoMasterIds(admin, utente.master_id)
    if (!subtree.includes((distinta as any).master_id)) return NextResponse.json({ error: 'Non autorizzata' }, { status: 403 })
  }

  const cols = 'id, numero, tracking_number, stato, mitt_nome, dest_nome, dest_citta, dest_cap, dest_provincia, peso_reale, colli, cliente_id, corriere_id, corrieri(nome_contratto)'
  let q = admin.from('spedizioni').select(cols).eq('distinta_id', id).order('created_at', { ascending: true })
  if (eCliente) q = q.eq('cliente_id', utente.cliente_id)
  // NASCONDI-FORNITORI, come /api/distinte/dettaglio e l'elenco spedizioni: qui mancava, e nel dettaglio
  // della distinta uscivano anche le gambe di chi vende al master (cliente = ledger d'acquisto).
  const ledgerNascosti = !eCliente && !isAgente(utente as any) ? await ledgerFornitoriDaNascondere(admin, utente.master_id) : []
  if (ledgerNascosti.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${ledgerNascosti.join(',')})`)
  // Agente: solo le spedizioni dei suoi clienti dentro la distinta.
  if (isAgente(utente as any)) q = q.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
  const { data: spedizioni } = await q

  // Etichetta contratto: singolo dal corriere della distinta, oppure — se la distinta e' MISTA
  // (corriere_id null) — derivata dai contratti reali delle spedizioni ("N contratti").
  let contratto_label = (distinta as any).corrieri?.nome_contratto || null
  if (!contratto_label) {
    const nomi = Array.from(new Set((spedizioni || []).map((s: any) => s?.corrieri?.nome_contratto).filter(Boolean)))
    contratto_label = nomi.length === 1 ? String(nomi[0]) : nomi.length ? `${nomi.length} contratti` : '—'
  }

  return NextResponse.json({ distinta: { ...distinta, bordero_id: borderoSenzaDettaglio((distinta as any).bordero_id), contratto_label }, spedizioni: spedizioni || [] })
}
