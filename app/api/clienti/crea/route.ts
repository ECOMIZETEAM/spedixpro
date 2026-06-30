import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { inviaCredenzialiCliente } from '@/lib/email'

function generaPassword(len = 10): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  return Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id, masters(nome,slug)').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const email = body.email?.toLowerCase().trim()
  const ragioneSociale = body.ragione_sociale
  if (!email) return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
  if (!ragioneSociale) return NextResponse.json({ error: 'Ragione sociale obbligatoria' }, { status: 400 })
  const { data: existing } = await supabase.from('clienti').select('id').eq('email', email).single()
  if (existing) return NextResponse.json({ error: 'Email già registrata' }, { status: 400 })
  const { count } = await supabase.from('clienti').select('*', {count:'exact',head:true}).eq('master_id', utente.master_id)
  const codice = `CLI-${String((count||0)+1).padStart(4,'0')}`
  const password = generaPassword()
  const { data: nuovoCliente, error } = await supabase.from('clienti').insert({
    master_id: utente.master_id,
    ragione_sociale: ragioneSociale,
    piva: body.piva||null, cf: body.cf||null, pec: body.pec||null,
    cod_sdi: body.cod_sdi||null, rappresentante_legale: body.rappresentante_legale||null,
    telefono: body.telefono||null, email,
    sl_paese: body.sl_paese||'Italia', sl_indirizzo: body.sl_indirizzo||null,
    sl_citta: body.sl_citta||null, sl_provincia: body.sl_provincia||null, sl_cap: body.sl_cap||null,
    so_paese: body.so_paese||'Italia', so_indirizzo: body.so_indirizzo||null,
    so_citta: body.so_citta||null, so_provincia: body.so_provincia||null, so_cap: body.so_cap||null,
    listino_cliente_id: body.listino_cliente_id||null,
    tipo_contratto: body.tipo_contratto||'credito_scalare',
    aliquota_iva: body.aliquota_iva||'22',
    fattura_auto: body.fattura_auto||false,
    metodo_pagamento: body.metodo_pagamento||'sepa',
    diritto_fisso: body.diritto_fisso||false,
    agente: body.agente||null,
    ritiro_tipo: body.ritiro_tipo||null, ritiro_fascia: body.ritiro_fascia||null,
    rimborso_freq: body.rimborso_freq||null, rimborso_tipo: body.rimborso_tipo||null,
    iban: body.iban||null, abi: body.abi||null, cab: body.cab||null,
    bic_swift: body.bic_swift||null, note_rimborso: body.note_rimborso||null,
    codice_cliente: codice, attivo: true,
  }).select().single()
  if (error || !nuovoCliente) return NextResponse.json({ error: error?.message||'Errore creazione' }, { status: 400 })
  try {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const adminClient = createAdminSupabase()
    const { data: authUser } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true })
    if (authUser?.user) {
      await supabase.from('utenti').insert({ id: authUser.user.id, ruolo: 'cliente', master_id: utente.master_id, cliente_id: nuovoCliente.id, nome: ragioneSociale, attivo: true })
    }
  } catch(e) { console.error('Auth error:', e) }
  try {
    const master = (utente as any).masters
    await inviaCredenzialiCliente({ email, nomeCliente: ragioneSociale, masterNome: master?.nome||'SpedixPro', dominio: 'spedixpro.vercel.app', password })
  } catch(e) { console.error('Email error:', e) }
  return NextResponse.json({ id: nuovoCliente.id, codice })
}
