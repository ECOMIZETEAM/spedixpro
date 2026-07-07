import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato'}, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()

  // Sotto-master agganciato (id = "m:<masterId>"): mostrato come una scheda cliente
  if (id.startsWith('m:')) {
    const targetId = id.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: m } = await admin.from('masters').select('*').eq('id', targetId).eq('parent_master_id', utente?.master_id).single()
    if (!m) return NextResponse.json({ error: 'Sotto-master non trovato' }, { status: 404 })
    return NextResponse.json({
      ...m, id: 'm:' + m.id, ragione_sociale: m.nome || '—',
      codice_cliente: 'SUB-MASTER', is_master: true,
      listino_cliente_id: (m as any).parent_listino_id || null, listini_clienti: null,
    })
  }

  const { data: cliente } = await supabase
    .from('clienti')
    .select('*, listini_clienti(id,nome)')
    .eq('id', id)
    .eq('master_id', utente?.master_id)
    .single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' },{ status: 404 })
  return NextResponse.json(cliente)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato'}, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { resetPassword, email_conferma, ...datiCliente } = body

  // Modifica di un sotto-master (id = "m:<masterId>"): aggiorna la tabella masters
  if (id.startsWith('m:')) {
    const targetId = id.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: m } = await admin.from('masters').select('id,parent_master_id').eq('id', targetId).single()
    if (!m || m.parent_master_id !== utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    const { error } = await admin.from('masters').update({
      nome: datiCliente.ragione_sociale, telefono: datiCliente.telefono || null,
      piva: datiCliente.piva || null, attivo: datiCliente.attivo ?? true,
      tipo_contratto: datiCliente.tipo_contratto || null,
      parent_listino_id: datiCliente.listino_cliente_id || null,
    }).eq('id', targetId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  const aggiornamento: any = {
    ragione_sociale: datiCliente.ragione_sociale,
    piva: datiCliente.piva||null, cf: datiCliente.cf||null,
    pec: datiCliente.pec||null, cod_sdi: datiCliente.cod_sdi||null,
    rappresentante_legale: datiCliente.rappresentante_legale||null,
    telefono: datiCliente.telefono||null,
    sl_paese: datiCliente.sl_paese||'Italia', sl_indirizzo: datiCliente.sl_indirizzo||null,
    sl_citta: datiCliente.sl_citta||null, sl_provincia: datiCliente.sl_provincia||null, sl_cap: datiCliente.sl_cap||null,
    so_paese: datiCliente.so_paese||'Italia', so_indirizzo: datiCliente.so_indirizzo||null,
    so_citta: datiCliente.so_citta||null, so_provincia: datiCliente.so_provincia||null, so_cap: datiCliente.so_cap||null,
    listino_cliente_id: datiCliente.listino_cliente_id||null,
    tipo_contratto: datiCliente.tipo_contratto||null,
    aliquota_iva: datiCliente.aliquota_iva||null,
    fattura_auto: datiCliente.fattura_auto||false,
    metodo_pagamento: datiCliente.metodo_pagamento||null,
    diritto_fisso: datiCliente.diritto_fisso||false,
    agente: datiCliente.agente||null,
    ritiro_tipo: datiCliente.ritiro_tipo||null, ritiro_fascia: datiCliente.ritiro_fascia||null,
    rimborso_freq: datiCliente.rimborso_freq||null, rimborso_tipo: datiCliente.rimborso_tipo||null,
    iban: datiCliente.iban||null, abi: datiCliente.abi||null, cab: datiCliente.cab||null,
    bic_swift: datiCliente.bic_swift||null, note_rimborso: datiCliente.note_rimborso||null,
    attivo: datiCliente.attivo??true,
    prezzi_in_distinta: datiCliente.prezzi_in_distinta??true,
    visualizza_fatture: datiCliente.visualizza_fatture??true,
    spedizione_custom: datiCliente.spedizione_custom??false,
    vieta_inserimento: datiCliente.vieta_inserimento??false,
    vieta_cancellazione: datiCliente.vieta_cancellazione??false,
    interno_esclusivo: datiCliente.interno_esclusivo??false,
    gestione_logistica: datiCliente.gestione_logistica??false,
    updated_at: new Date().toISOString(),
  }
  if (datiCliente.impostazioni !== undefined) aggiornamento.impostazioni =datiCliente.impostazioni
  const { data: cliente, error } = await supabase.from('clienti').update(aggiornamento)
    .eq('id', id).eq('master_id', utente?.master_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (resetPassword && cliente?.email) {
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const adminClient = createAdminSupabase()
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
      const newPassword = Array.from({length:10}, () => chars[Math.floor(Math.random()*chars.length)]).join('')
      const { data: authUsers } = await adminClient.auth.admin.listUsers()
      const userToReset = authUsers?.users?.find((u: any) => u.email === cliente.email)
      if (userToReset) {
        await adminClient.auth.admin.updateUserById(userToReset.id, { password: newPassword })
        const { inviaCredenzialiCliente } = await import('@/lib/email')
        await inviaCredenzialiCliente({ email: cliente.email, nomeCliente:cliente.ragione_sociale, masterNome: 'MoovExpress', dominio: 'spedixpro.vercel.app', password: newPassword })
      }
    } catch(e) { console.error('Reset password error:', e) }
  }
  return NextResponse.json({ success: true })
}