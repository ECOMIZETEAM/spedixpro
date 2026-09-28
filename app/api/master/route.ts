import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

const COLONNE = [
  'nome','partita_iva','piva','codice_fiscale','codice_sdi','pec',
  'indirizzo','cap','citta','provincia','paese','telefono',
  'email','email_sede','email_supporto',
  'iban','banca','intestatario',
  'indirizzo_fatturazione','cap_fatturazione','citta_fatturazione','provincia_fatturazione',
  'indirizzo_operativo','cap_operativo','citta_operativo','provincia_operativo','telefono_operativo',
  'logo_url','tipo_contratto',
  'colore_primario','colore_secondario',
  'impostazioni',   // JSON impostazioni del master (es. formato_stampa etichette)
]

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data: master } = await supabase.from('masters').select('*').eq('id', utente?.master_id).single()
  if (!master) return NextResponse.json({})
  const out: any = { ...master, ragione_sociale: master.nome || '' }
  return NextResponse.json(out)
}

export async function PUT(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  if (body.ragione_sociale !== undefined && body.nome === undefined) {
    body.nome = body.ragione_sociale
  }
  const aggiornamento: any = {}
  for (const k of COLONNE) {
    if (body[k] !== undefined) aggiornamento[k] = body[k]
  }
  aggiornamento.updated_at = new Date().toISOString()

  // CHI SI RINOMINA DEVE RINOMINARSI DAVUNQUE. Il nome dell'ACCOUNT non e' lo stesso campo del nome
  // del master: un sotto-master che entra con un'utenza intestata alla ragione sociale continuava a
  // firmare i messaggi di assistenza col nome di prima, anche sulle richieste aperte dopo il cambio.
  // Successo il 16/09/2026: rinominato in "C&V EXPRESS LOGISITCS", ma in chat restava "Central Poste
  // di Cervasio L." — e il master ha dovuto segnalarlo due volte.
  //
  // Si aggiornano SOLO le utenze il cui nome e' ESATTAMENTE il vecchio nome del master: quelle
  // intestate a una persona ("Mario Rossi") non coincidono e non si toccano, altrimenti si
  // cancellerebbe chi ha risposto.
  const { data: prima } = await supabase.from('masters').select('nome').eq('id', utente?.master_id).single()
  const nomeVecchio = String(prima?.nome || '').trim()

  const { error } = await supabase.from('masters').update(aggiornamento).eq('id', utente?.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const nomeNuovo = String(aggiornamento.nome || '').trim()
  if (nomeNuovo && nomeVecchio && nomeNuovo !== nomeVecchio) {
    // service-role: l'utente non puo' scrivere la propria riga `utenti`. Il perimetro si rifa' a
    // mano (master_id + nome esatto), perche' con questa chiave il database non isola piu' nulla.
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { error: eU } = await admin.from('utenti').update({ nome: nomeNuovo })
      .eq('master_id', utente?.master_id).eq('nome', nomeVecchio)
    if (eU) console.error('[MASTER][RINOMINA] utenze non allineate', eU.message)
  }

  return NextResponse.json({ success: true })
}