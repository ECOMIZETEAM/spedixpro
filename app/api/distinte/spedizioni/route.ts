import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const corriereId = p.get('corriereId')
  const dal = p.get('dal')
  const al = p.get('al')
  let db: any = supabase
  let masterFilter: string[] = [utente?.master_id]
  if (masterSel && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds, masterIdsVisibili } = await import('@/lib/rete-masters')
    const admin = createAdminSupabase()
    const mieiDiscendenti = await masterIdsVisibili(admin, utente.master_id)
    masterFilter = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : ['00000000-0000-0000-0000-000000000000']
    db = admin
  }
  let query = db.from('spedizioni')
    .select('id,numero,mitt_nome,dest_nome,dest_citta,dest_cap,dest_provincia,peso_reale,peso_fatturato,colli,created_at,cliente_id,corriere_id,clienti(ragione_sociale)')
    .in('master_id', masterFilter)
    .is('distinta_id', null)
    .order('created_at', { ascending: false })
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (corriereId) query = query.eq('corriere_id', corriereId)
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data } = await query
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const body = await req.json()
  const { spedizioniIds, clienteId, corriereId } = body
  if (!spedizioniIds?.length) return NextResponse.json({ error: 'Nessuna spedizione selezionata' }, { status: 400 })
  // Sotto-master (clienteId = "m:<id>"): le spedizioni sono sue -> admin, cliente_id distinta = null
  const masterSel = typeof clienteId === 'string' && clienteId.startsWith('m:') ? clienteId.slice(2) : null
  // Anche l'agente può chiudere la distinta, ma SOLO per i propri clienti (mai per la rete/sotto-master).
  const agente = isAgente(utente)
  if (agente && masterSel) return NextResponse.json({ error: 'Operazione non consentita: gli agenti non gestiscono la rete.' }, { status: 403 })
  let db: any = supabase
  if (masterSel) { const { createAdminSupabase } = await import('@/lib/supabase-admin'); db = createAdminSupabase() }
  let spedQ = db.from('spedizioni').select('id,colli,peso_reale,costo_totale').in('id', spedizioniIds)
  if (agente) spedQ = spedQ.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  const { data: speds } = masterSel ? await spedQ : await spedQ.eq('master_id', utente?.master_id)
  if (!speds?.length) return NextResponse.json({ error: 'Nessuna spedizione valida da chiudere' }, { status: 400 })
  const spedIdsValidi = speds.map((s: any) => s.id)
  const totaleColli = (speds || []).reduce((s: number, x: any) => s + Number(x.colli || 1), 0)
  const totalePeso = (speds || []).reduce((s: number, x: any) => s + Number(x.peso_reale || 0), 0)
  const prezzoTotale = (speds || []).reduce((s: number, x: any) => s + Number(x.costo_totale || 0), 0)
  const { data: ultima } = await supabase.from('distinte')
    .select('numero').eq('master_id', utente?.master_id).order('created_at', { ascending: false }).limit(1).single()
  let numeroInt = 1000
  if (ultima?.numero) { const n = parseInt(String(ultima.numero).replace(/\D/g, '')); if (!isNaN(n)) numeroInt = n }
  // RETRY sul numero: unico PER MASTER; se due chiusure partono insieme, il secondo insert
  // collide -> riprovo col numero successivo (fino a 5 tentativi) invece di fallire.
  let distinta: any = null, error: any = null
  for (let tent = 1; tent <= 5 && !distinta; tent++) {
    const numeroDistinta = String(numeroInt + tent)
    const r = await supabase.from('distinte').insert({
      master_id: utente?.master_id, cliente_id: masterSel ? null : (clienteId || null), master_rete_id: masterSel || null, corriere_id: corriereId || null,
      numero: numeroDistinta, data: new Date().toISOString().split('T')[0], stato: 'chiusa',
      totale_colli: totaleColli, totale_peso: totalePeso, totale_ldv: (speds||[]).length, prezzo_totale: prezzoTotale,
    }).select().single()
    distinta = r.data; error = r.error
    if (error && !String(error.message || '').includes('duplicate key')) break
  }
  if (error || !distinta) return NextResponse.json({ error: error?.message || 'Errore' }, { status: 400 })
  const numeroDistinta = distinta.numero
  await db.from('spedizioni').update({ distinta_id: distinta.id }).in('id', spedIdsValidi)
  // Distinta = consegnate al corriere → passano a "spedita" (solo quelle ancora "in lavorazione", per
  // non sovrascrivere in_transito/consegnata). Così in elenco si distinguono dalle etichette appena
  // create nella stessa giornata (che restano "in lavorazione").
  await db.from('spedizioni').update({ stato: 'spedita' }).in('id', spedIdsValidi).eq('stato', 'in_lavorazione')
  // Notifica i MARKETPLACE (eBay/Shopify/Woo/PrestaShop/TikTok/Temu): tracking + stato "spedito".
  // Prima lo faceva SOLO la creazione distinta lato CLIENTE: creando la distinta dal MASTER gli ordini
  // marketplace non venivano mai sincronizzati (es. eBay restava "da spedire"). Uso admin per poter
  // leggere/aggiornare gli ordini dei clienti della rete. Best-effort: non blocca la distinta.
  try {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { fulfillMarketplace } = await import('@/lib/fulfillMarketplace')
    await fulfillMarketplace(createAdminSupabase(), spedIdsValidi)
  } catch {}
  // Chiusura borderò/distinta lato corriere (best-effort): Spedisci.online e SpediamoPro (bordereau).
  try { const { chiudiBorderoSpedisci } = await import('@/lib/spedisci'); await chiudiBorderoSpedisci(db, distinta.id) } catch {}
  try { const { chiudiBordereauSpediamopro } = await import('@/lib/spediamopro'); await chiudiBordereauSpediamopro(db, distinta.id) } catch {}
  return NextResponse.json({ success: true, distintaId: distinta.id, numero: numeroDistinta })
}