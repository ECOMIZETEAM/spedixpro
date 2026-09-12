import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { attorePreventivi } from '@/lib/preventivo-attore'
import { normalizzaMarkup, creaApplicaMarkup } from '@/lib/markup-fasce'
import { fetchAll } from '@/lib/fetch-all'

export const runtime = 'nodejs'

// "DA COSTO" DELL'AGENTE: riprezza la bozza del preventivo partendo dal COSTO dell'agente (il suo
// listino assegnato, utenti.listino_agente_id) + una maggiorazione (markup), come fa il master con
// costo-in-cliente ma SENZA mai toccare/vedere i prezzi del master. Idempotente: ogni applicazione
// riparte dal costo (non si accumula). Struttura (corrieri + supplementi + fuel) resta quella della
// bozza (già copiata dal listino agente in crea_listino); qui si riprezzano SOLO le fasce peso/zona.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const s = await attorePreventivi(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (!s.isAgente || !s.listinoAgenteId) {
    return NextResponse.json({ error: 'Il "Da costo" agente vale solo per gli agenti con un listino assegnato.' }, { status: 400 })
  }
  const { id } = await params
  const admin = createAdminSupabase()

  const { data: p } = await admin.from('preventivi').select('id,master_id,agente,stato,listino_template_id').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id || p.agente !== s.agenteNome) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  if (p.stato === 'accettato') return NextResponse.json({ error: 'Preventivo già accettato.' }, { status: 400 })
  if (!p.listino_template_id) return NextResponse.json({ error: 'Crea prima il listino del preventivo.' }, { status: 400 })

  const bozzaId = p.listino_template_id as string
  const costoId = s.listinoAgenteId

  const b = await req.json().catch(() => ({}))
  const applicaMarkup = creaApplicaMarkup(normalizzaMarkup(b.markup))

  // COSTO dell'agente: le fasce del suo listino assegnato (peso/zona/fuel/prezzo), per tutti i corrieri.
  const fasceCosto = await fetchAll(() => admin.from('listini_clienti_fasce')
    .select('corriere_id,zona_id,peso_min,peso_max,tipo,fuel,prezzo').eq('listino_id', costoId).order('id', { ascending: true }))
  if (!fasceCosto.length) return NextResponse.json({ error: 'Il tuo listino non ha prezzi: chiedi al master.' }, { status: 400 })

  // Riprezzo la bozza: cancello le fasce e le riscrivo dal costo + markup (idempotente).
  await admin.from('listini_clienti_fasce').delete().eq('listino_id', bozzaId)
  const nuove = fasceCosto.map((f: any) => ({
    listino_id: bozzaId, corriere_id: f.corriere_id, zona_id: f.zona_id,
    peso_min: f.peso_min, peso_max: f.peso_max, tipo: f.tipo, fuel: f.fuel,
    prezzo: applicaMarkup(f.prezzo, f.tipo, f.peso_max),
  }))
  for (let i = 0; i < nuove.length; i += 1000) {
    const { error } = await admin.from('listini_clienti_fasce').insert(nuove.slice(i, i + 1000))
    if (error) return NextResponse.json({ error: 'Riprezzatura non riuscita: ' + error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, fasce: nuove.length })
}
