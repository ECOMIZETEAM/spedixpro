import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vettoreFisico } from '@/lib/vettore'

// Listino POD del master: quanto paga il cliente per ogni richiesta di prova di consegna.
// Solo il MASTER gestisce le proprie regole (mai cliente/agente). Tutto via service-role con
// controllo esplicito del perimetro (cliente/corriere devono essere del master). Vedi lib/pod-prezzo.

// Chi puo' gestire: un master (ha master_id, non e' cliente ne' agente).
async function masterCorrente() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || u.cliente_id || ruolo === 'cliente' || ruolo === 'agente') {
    return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  }
  return { masterId: u.master_id as string, userId: user.id }
}

// GET: le regole del master + gli elenchi (clienti, corrieri propri) per le tendine.
export async function GET() {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const M = ctx.masterId

  const [rg, cl, co] = await Promise.all([
    admin.from('pod_prezzi').select('id,cliente_id,corriere_id,vettore,prezzo,attivo,updated_at').eq('master_id', M),
    admin.from('clienti').select('id,ragione_sociale').eq('master_id', M).order('ragione_sociale'),
    admin.from('corrieri').select('id,nome_contratto,tipo').eq('master_id', M).eq('attivo', true).order('nome_contratto'),
  ])
  // Il VETTORE lo calcola il server (lib/vettore.ts): la pagina non deve reinventare la regola che
  // dice quali contratti sono "GLS" — sui contratti diretti non sta scritto nel nome.
  const corrieri = (co.data || []).map((c: any) => ({ id: c.id, nome_contratto: c.nome_contratto, vettore: vettoreFisico(c) }))
  return NextResponse.json({
    regole: rg.data || [],
    clienti: cl.data || [],
    corrieri,
    vettori: [...new Set(corrieri.map((c: any) => c.vettore))].sort(),
  })
}

// POST: crea o aggiorna le regole di UN prezzo su PIU' bersagli e PIU' clienti in una volta sola.
// `cliente_ids` = i clienti scelti (vuoto = "tutti i clienti", la regola generica),
// `corriere_ids` = singoli contratti, `vettori` = tutti i contratti di quel vettore (anche i futuri),
// nessuno dei due = "tutti i corrieri" (predefinito).
// Si scrive una regola per ogni COPPIA cliente × bersaglio: "10 clienti, tutti i BRT, 3 €" = 10 regole.
// Prima si poteva salvare un bersaglio alla volta, e un cliente alla volta: con 38 contratti e 10
// clienti significava rifare 380 volte la stessa regola a mano.
export async function POST(req: NextRequest) {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const M = ctx.masterId
  const body = await req.json().catch(() => ({}))

  // `cliente_id` singolo resta accettato: una pagina aperta prima del rilascio manda ancora quello,
  // e rifiutarla vorrebbe dire rompere il salvataggio a chi non ha ancora ricaricato.
  const clienteIds: string[] = [...new Set<string>([
    ...(Array.isArray(body?.cliente_ids) ? body.cliente_ids : []),
    body?.cliente_id,
  ].filter(Boolean).map((x: any) => String(x)))]
  const corriereIds: string[] = [...new Set<string>((Array.isArray(body?.corriere_ids) ? body.corriere_ids : [])
    .filter(Boolean).map((x: any) => String(x)))]
  const vettori: string[] = [...new Set<string>((Array.isArray(body?.vettori) ? body.vettori : [])
    .filter(Boolean).map((v: any) => String(v).toUpperCase()))]
  const prezzo = Math.round(Number(body?.prezzo) * 100) / 100
  const attivo = body?.attivo === undefined ? true : !!body.attivo
  if (!isFinite(prezzo) || prezzo < 0) return NextResponse.json({ error: 'Prezzo non valido' }, { status: 400 })

  // Perimetro: cliente e contratti, se indicati, devono essere del master (mai di un altro). I vettori
  // devono essere fra quelli che il master ha davvero: una regola su un vettore inesistente non
  // sbaglia i soldi, ma resta lì a far credere che copra qualcosa.
  if (clienteIds.length) {
    const { data } = await admin.from('clienti').select('id').eq('master_id', M).in('id', clienteIds)
    const miei = new Set((data || []).map((c: any) => c.id))
    const estranei = clienteIds.filter(id => !miei.has(id))
    if (estranei.length) return NextResponse.json({ error: `${estranei.length > 1 ? 'Clienti non validi' : 'Cliente non valido'}` }, { status: 400 })
  }
  const { data: mieiCorr } = await admin.from('corrieri').select('id,nome_contratto,tipo').eq('master_id', M)
  const idsMiei = new Set((mieiCorr || []).map((c: any) => c.id))
  const vettoriMiei = new Set((mieiCorr || []).map((c: any) => vettoreFisico(c)))
  for (const id of corriereIds) if (!idsMiei.has(id)) return NextResponse.json({ error: 'Corriere non valido' }, { status: 400 })
  for (const v of vettori) if (!vettoriMiei.has(v)) return NextResponse.json({ error: `Vettore non valido: ${v}` }, { status: 400 })

  // Un bersaglio per regola. Nessuna selezione = la regola predefinita (tutti i corrieri).
  const bersagli: { corriere_id: string | null; vettore: string | null }[] = [
    ...corriereIds.map(id => ({ corriere_id: id, vettore: null })),
    ...vettori.map(v => ({ corriere_id: null, vettore: v })),
  ]
  if (!bersagli.length) bersagli.push({ corriere_id: null, vettore: null })

  // Ogni COPPIA cliente × bersaglio e' una regola. Nessun cliente scelto = una riga sola col cliente
  // nullo, cioe' "vale per tutti".
  const clientiBersaglio: (string | null)[] = clienteIds.length ? clienteIds : [null]
  const coppie = clientiBersaglio.flatMap(cli => bersagli.map(b => ({ cliente_id: cli, ...b })))

  // TETTO. Un master con 600 clienti che spunta tutto insieme a 38 contratti chiederebbe 22.800
  // regole in una richiesta sola: la pagina va in timeout a meta' lavoro e restano scritte solo le
  // prime. Meglio dirlo prima, e ricordare che "tutti i clienti" si ottiene NON scegliendone nessuno.
  const TETTO = 1000
  if (coppie.length > TETTO) {
    return NextResponse.json({
      error: `Sono ${coppie.length} regole in un colpo solo (${clientiBersaglio.length} clienti × ${bersagli.length} bersagli): troppe. `
        + `Per valere su tutti i clienti non sceglierne nessuno — è una regola sola. Altrimenti falle a gruppi, massimo ${TETTO} per volta.`,
    }, { status: 400 })
  }

  // Le gemelle si cercano TUTTE IN UNA VOLTA, non una query per regola: a 300 regole erano 600
  // andate e ritorno al database dentro una richiesta che ne ha 60 di tempo. La unique e' su
  // un'espressione (coalesce dei NULL), quindi l'upsert del database non si puo' usare: la
  // corrispondenza la si fa qui, su una chiave costruita a mano.
  const chiave = (c: any) => `${c.cliente_id || ''}|${c.corriere_id || ''}|${c.vettore || ''}`
  const { data: esistenti, error: errLettura } = await admin.from('pod_prezzi')
    .select('id,cliente_id,corriere_id,vettore').eq('master_id', M)
  if (errLettura) return NextResponse.json({ error: errLettura.message }, { status: 400 })
  const idDi = new Map((esistenti || []).map((r: any) => [chiave(r), r.id as string]))

  const daAggiornare: string[] = []
  const daCreare: any[] = []
  for (const c of coppie) {
    const id = idDi.get(chiave(c))
    if (id) daAggiornare.push(id)
    else daCreare.push({ master_id: M, cliente_id: c.cliente_id, corriere_id: c.corriere_id, vettore: c.vettore, prezzo, attivo })
  }

  // Il prezzo e' lo stesso per tutte: un solo UPDATE su tutti gli id, non uno per riga.
  const aPezzi = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
  for (const pezzo of aPezzi(daAggiornare, 500)) {
    const { error } = await admin.from('pod_prezzi')
      .update({ prezzo, attivo, updated_at: new Date().toISOString() }).in('id', pezzo)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  for (const pezzo of aPezzi(daCreare, 500)) {
    const { error } = await admin.from('pod_prezzi').insert(pezzo)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    create: daCreare.length,
    aggiornate: daAggiornare.length,
    totale: coppie.length,
    clienti: clienteIds.length,
  })
}

// PATCH: sospende/riattiva una regola. Per id: il bersaglio (cliente/contratto/vettore) non si tocca,
// quindi non c'e' bisogno di rimandarlo indietro e non si rischia di crearne una nuova per sbaglio.
export async function PATCH(req: NextRequest) {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const body = await req.json().catch(() => ({}))
  const id = String(body?.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Id mancante' }, { status: 400 })
  const { error } = await admin.from('pod_prezzi')
    .update({ attivo: !!body?.attivo, updated_at: new Date().toISOString() })
    .eq('id', id).eq('master_id', ctx.masterId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

// DELETE: rimuove una regola del master (solo le proprie).
export async function DELETE(req: NextRequest) {
  const ctx = await masterCorrente()
  if ('err' in ctx) return ctx.err
  const admin = createAdminSupabase()
  const M = ctx.masterId
  const body = await req.json().catch(() => ({}))
  // Uno o piu' id: dalla tabella si possono spuntare piu' regole e toglierle in un colpo.
  const ids: string[] = [...new Set<string>([...(Array.isArray(body?.ids) ? body.ids : []), body?.id]
    .filter(Boolean).map((x: any) => String(x)))]
  if (!ids.length) return NextResponse.json({ error: 'Id mancante' }, { status: 400 })
  const { error } = await admin.from('pod_prezzi').delete().in('id', ids).eq('master_id', M)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, eliminate: ids.length })
}
