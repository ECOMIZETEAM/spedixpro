import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

const COLONNE = [
  'nome','partita_iva','piva','codice_fiscale','codice_sdi','pec',
  'indirizzo','cap','citta','provincia','paese','telefono',
  'email','email_sede','email_supporto',
  'iban','banca','intestatario',
  'indirizzo_fatturazione','cap_fatturazione','citta_fatturazione','provincia_fatturazione',
  'indirizzo_operativo','cap_operativo','citta_operativo','provincia_operativo','telefono_operativo',
  'logo_url','tipo_contratto'
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
  const { error } = await supabase.from('masters').update(aggiornamento).eq('id', utente?.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}