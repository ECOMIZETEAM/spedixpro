import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { staffDelMaster, zoneNonModificabili } from '@/lib/zone-catena'

// I CAP di una zona li porta alle copie il DATABASE (scripts/zone-catena-trigger.sql, 26/11/2026): ogni contratto che
// compra questo riceve la differenza, livello per livello. Prima lo faceva lib/propaga-zona dopo ogni modifica, per
// NOME e nel sottoalbero: le correzioni fatte via SQL non scendevano, e un errore nella propagazione si perdeva in
// un log mentre il portale rispondeva "fatto".

// GET: elenca le regioni (zone_cap) di una zona
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  // TUTTE le righe, a pagine e in ordine fisso. Prima una lettura sola, che PostgREST ferma a 1.000: una zona da 3.580
  // CAP si vedeva ed esportava a metà, e reimportare il file con "sostituisci" toglieva il resto (a tutta la catena).
  const tutte: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('zone_cap').select('*').eq('zona_id', id).order('id', { ascending: true }).range(from, from + 999)
    if (error) return NextResponse.json({ error: 'Regioni della zona non leggibili: riprova tra poco.' }, { status: 503 })
    tutte.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  tutte.sort((a, b) => String(a.paese || '').localeCompare(String(b.paese || '')) || String(a.provincia || '').localeCompare(String(b.provincia || '')) || String(a.cap || '').localeCompare(String(b.cap || '')))
  return NextResponse.json(tutte)
}

// Si possono cambiare i CAP di questa zona? Solo sulle zone dei contratti PROPRI del master: su un contratto comprato
// sono quelle del fornitore. Il database già non lo lascia fare, ma una DELETE o una UPDATE bloccate così toccano
// zero righe senza errore, e il portale rispondeva "fatto".
async function bloccata(supabase: any, userId: string, zonaId: string): Promise<{ errore: string; stato: number } | null> {
  const masterId = await staffDelMaster(supabase, userId)
  if (!masterId) return { errore: 'Solo lo staff del master può modificare le zone.', stato: 403 }
  const { data: zona } = await supabase.from('zone').select('corriere_id,master_id').eq('id', zonaId).maybeSingle()
  if (!zona || zona.master_id !== masterId) return { errore: 'Zona non trovata.', stato: 404 }
  const msg = await zoneNonModificabili(createAdminSupabase(), zona.corriere_id, masterId)
  return msg ? { errore: msg, stato: 403 } : null
}

// POST: aggiunge una regione alla zona
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await bloccata(supabase, user.id, id)
  if (b) return NextResponse.json({ error: b.errore }, { status: b.stato })
  const body = await req.json()
  const paese = (body.paese || '').toUpperCase().trim()
  const provincia = (body.provincia || '*').toUpperCase().trim() || '*'
  const cap = (body.cap || '*').trim() || '*'
  const citta = (body.citta || '*').trim() || '*'
  if (!paese) return NextResponse.json({ error: 'Paese obbligatorio' }, { status: 400 })
  const { data, error } = await supabase.from('zone_cap').insert({
    zona_id: id, paese, provincia, cap, citta,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// PATCH: modifica una regione esistente (body: { capId, paese, provincia, cap, citta })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await bloccata(supabase, user.id, id)
  if (b) return NextResponse.json({ error: b.errore }, { status: b.stato })
  const body = await req.json()
  const capId = body.capId
  if (!capId) return NextResponse.json({ error: 'capId mancante' }, { status: 400 })
  const paese = (body.paese || '').toUpperCase().trim()
  if (!paese) return NextResponse.json({ error: 'Paese obbligatorio' }, { status: 400 })
  const patch = {
    paese,
    provincia: (body.provincia || '*').toUpperCase().trim() || '*',
    cap: (body.cap || '*').trim() || '*',
    citta: (body.citta || '*').trim() || '*',
  }
  // .eq('zona_id'): la riga dev'essere di QUESTA zona (quella controllata qui sopra).
  const { data, error } = await supabase.from('zone_cap').update(patch).eq('id', capId).eq('zona_id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Regione non trovata in questa zona.' }, { status: 404 })
  return NextResponse.json(data)
}

// La chiave di una riga: paese, provincia, cap, città (un valore mancante è diverso da uno vuoto), come il database.
const chiaveRiga = (r: any) => [r.paese, r.provincia, r.cap, r.citta].map(v => (v === null || v === undefined) ? '\u0002' : String(v)).join('\u0001')

// PUT: import massivo di regioni (formato spedisci.online: country_id/province/cap/city).
// body: { rows: [{paese,provincia,cap,citta}], replace?: boolean }
// replace=true: alla fine la zona ha esattamente queste righe. Si scrive solo la DIFFERENZA: svuotare e riempire
// faceva rifare ogni CAP in ogni copia (la zona più grande ha 3.580 CAP: per cambiarne uno se ne riscrivevano due
// volte 3.580 in ogni contratto che la compra) e, a metà strada, la zona restava vuota per chi spediva in quel momento.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await bloccata(supabase, user.id, id)
  if (b) return NextResponse.json({ error: b.errore }, { status: b.stato })
  const body = await req.json()
  const rows = Array.isArray(body.rows) ? body.rows : []
  const puliti = rows
    .map((r: any) => ({
      zona_id: id,
      paese: (r.paese || '').toUpperCase().trim(),
      provincia: (r.provincia || '*').toUpperCase().trim() || '*',
      cap: (r.cap || '*').toString().trim() || '*',
      citta: (r.citta || '*').toString().trim() || '*',
    }))
    .filter((r: any) => r.paese)
  if (!puliti.length) return NextResponse.json({ error: 'Nessuna riga valida da importare' }, { status: 400 })

  if (!body.replace) {
    const { data, error } = await supabase.from('zone_cap').insert(puliti).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ inserite: data?.length || 0, aggiunte: data?.length || 0, tolte: 0 })
  }

  // Le righe di oggi, tutte (in ordine fisso: le pagine non si accavallano).
  const esistenti: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('zone_cap').select('id,paese,provincia,cap,citta').eq('zona_id', id)
      .order('id', { ascending: true }).range(from, from + 999)
    if (error) return NextResponse.json({ error: 'Regioni della zona non leggibili: niente è stato cambiato.' }, { status: 503 })
    esistenti.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  // Differenza contando i doppioni: una riga che c'è due volte nel file deve esserci due volte nella zona.
  const voluti = new Map<string, number>()
  for (const r of puliti) voluti.set(chiaveRiga(r), (voluti.get(chiaveRiga(r)) || 0) + 1)
  const daTogliere: string[] = []
  for (const r of esistenti) {
    const k = chiaveRiga(r), n = voluti.get(k) || 0
    if (n > 0) voluti.set(k, n - 1)
    else daTogliere.push(r.id)
  }
  const daAggiungere: any[] = []
  const rimasti = new Map(voluti)
  for (const r of puliti) {
    const k = chiaveRiga(r), n = rimasti.get(k) || 0
    if (n > 0) { daAggiungere.push(r); rimasti.set(k, n - 1) }
  }
  // Un import che TOGLIE regioni si conferma prima, con i numeri: le stesse regioni spariscono da ogni contratto che
  // compra questo. Senza conferma si risponde con l'anteprima e non si scrive niente.
  if (daTogliere.length > 0 && body.conferma !== true) {
    return NextResponse.json({ anteprima: true, inserite: puliti.length, aggiunte: daAggiungere.length, tolte: daTogliere.length, oggi: esistenti.length })
  }
  // Prima si aggiunge, poi si toglie: per un momento la zona ha qualche CAP in più, mai uno in meno.
  for (let i = 0; i < daAggiungere.length; i += 1000) {
    const { error } = await supabase.from('zone_cap').insert(daAggiungere.slice(i, i + 1000))
    if (error) return NextResponse.json({ error: 'Import interrotto: ' + error.message }, { status: 400 })
  }
  for (let i = 0; i < daTogliere.length; i += 200) {
    const { error } = await supabase.from('zone_cap').delete().in('id', daTogliere.slice(i, i + 200)).eq('zona_id', id)
    if (error) return NextResponse.json({ error: 'Import interrotto: ' + error.message }, { status: 400 })
  }
  return NextResponse.json({ inserite: puliti.length, aggiunte: daAggiungere.length, tolte: daTogliere.length })
}

// DELETE: rimuove una regione (passando ?capId=...)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await bloccata(supabase, user.id, id)
  if (b) return NextResponse.json({ error: b.errore }, { status: b.stato })
  const capId = req.nextUrl.searchParams.get('capId')
  if (!capId) return NextResponse.json({ error: 'capId mancante' }, { status: 400 })
  const { data, error } = await supabase.from('zone_cap').delete().eq('id', capId).eq('zona_id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data?.length) return NextResponse.json({ error: 'Regione non trovata in questa zona.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
