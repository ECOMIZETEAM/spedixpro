import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createAdminSupabase } from '@/lib/supabase-admin'

// ACCETTA PREVENTIVO (pubblico, per token). All'accettazione: il listino-BOZZA diventa il listino
// reale del cliente; se il destinatario e' un cliente NUOVO, si crea l'account sotto il master (come
// la registrazione pubblica). Idempotente: un preventivo gia' accettato non ricrea nulla.
export const dynamic = 'force-dynamic'

function generaPassword(len = 14): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  let out = ''; for (let i = 0; i < len; i++) out += chars[randomInt(chars.length)]; return out
}
function slugify(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'master'
}
function suffisso(): string {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let o = ''; for (let i = 0; i < 5; i++) o += c[randomInt(c.length)]; return o
}

async function finalizza(admin: any, p: any, draftId: string, clienteCreatoId: string | null) {
  const now = new Date().toISOString()
  await admin.from('preventivi').update({ stato: 'accettato', accettato_il: now, listino_creato_id: draftId, cliente_creato_id: clienteCreatoId, updated_at: now }).eq('id', p.id)
  try {
    await admin.from('notifiche').insert({
      master_id: p.master_id, cliente_id: null, gruppi: ['Amministratore', 'Operatore'],
      oggetto: 'Preventivo accettato', messaggio: `${p.dest_nome || ''} ha accettato il preventivo${p.oggetto ? ' — ' + p.oggetto : ''}`.trim(),
      link: '/dashboard/preventivi', created_by: p.created_by,
    })
  } catch {}
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const token = String(b.token || '').trim()
  if (!/^[a-f0-9]{20,40}$/.test(token)) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('*').eq('token', token).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  if (p.stato === 'accettato') return NextResponse.json({ ok: true, gia: true })
  if (p.stato === 'rifiutato') return NextResponse.json({ error: 'Preventivo non più valido.' }, { status: 400 })
  if (p.valido_fino && new Date(p.valido_fino) < new Date(new Date().toDateString())) return NextResponse.json({ error: 'Preventivo scaduto.' }, { status: 400 })
  if (!p.listino_template_id) return NextResponse.json({ error: 'Preventivo senza prezzi.' }, { status: 400 })

  const draftId = p.listino_template_id as string
  const rinomina = async () => { await admin.from('listini_clienti').update({ preventivo_id: null, nome: `Listino ${p.dest_nome || 'preventivo'}`.slice(0, 120) }).eq('id', draftId) }

  // ── Sotto-master ESISTENTE: il listino diventa il suo contratto (parent_listino_id). ──
  if (p.dest_tipo === 'master') {
    if (!p.master_target_id) return NextResponse.json({ error: 'Destinatario non valido.' }, { status: 400 })
    // Dev'essere un MIO sotto-master (difesa: non toccare i master di altri).
    const { data: tgt } = await admin.from('masters').select('id,parent_master_id').eq('id', p.master_target_id).maybeSingle()
    if (!tgt || tgt.parent_master_id !== p.master_id) return NextResponse.json({ error: 'Destinatario non valido.' }, { status: 400 })
    await rinomina()
    await admin.from('masters').update({ parent_listino_id: draftId }).eq('id', p.master_target_id)
    await finalizza(admin, p, draftId, null)
    return NextResponse.json({ ok: true })
  }

  // ── Sotto-master NUOVO: crea il sotto-master + accesso sotto il master del preventivo. ──
  if (p.dest_tipo === 'master_nuovo') {
    const email = String(p.dest_email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Email mancante: chiedi al mittente di reinviare il preventivo con la tua email.' }, { status: 400 })
    let masterId: string | null = null
    const { data: giaM } = await admin.from('masters').select('id,parent_master_id').eq('email', email).maybeSingle()
    if (giaM) {
      // Email gia' di un master: riuso SOLO se e' gia' un mio sotto-master, altrimenti rifiuto.
      if (giaM.parent_master_id !== p.master_id) return NextResponse.json({ error: 'Questa email è già usata da un altro operatore. Contatta il mittente.' }, { status: 400 })
      masterId = giaM.id
    } else {
      const nome = p.dest_nome || email
      let creato: { id: string } | null = null
      for (let t = 0; t < 6 && !creato; t++) {
        const slug = `${slugify(nome)}-${suffisso()}`.slice(0, 60)
        const { data, error } = await admin.from('masters').insert({
          nome, slug, email, parent_master_id: p.master_id, parent_listino_id: draftId, attivo: true, tipo_contratto: 'credito_scalare',
        }).select('id').single()
        if (!error && data) { creato = data; break }
        if (error?.code === '23505' && /slug/.test(error.message || '')) continue
        if (error?.code === '23505' && /email/.test(error.message || '')) {
          const { data: g2 } = await admin.from('masters').select('id,parent_master_id').eq('email', email).maybeSingle()
          if (g2 && g2.parent_master_id === p.master_id) { masterId = g2.id; break }
          return NextResponse.json({ error: 'Questa email è già in uso. Contatta il mittente.' }, { status: 400 })
        }
        console.error('[preventivo/accetta] insert master', error)
        return NextResponse.json({ error: 'Non riusciamo a creare l\'account. Contatta il mittente.' }, { status: 500 })
      }
      if (creato) {
        masterId = creato.id
        // Accesso (best-effort: se fallisce, il sotto-master resta e il mittente lo attiva).
        const password = generaPassword()
        const { data: au, error: aErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
        if (!aErr && au?.user) {
          const { error: uErr } = await admin.from('utenti').insert({ id: au.user.id, ruolo: 'master', master_id: creato.id, cliente_id: null, nome, attivo: true })
          if (uErr) { await admin.auth.admin.deleteUser(au.user.id).catch(() => {}) }
          else {
            try {
              const { inviaCredenzialiCliente } = await import('@/lib/email')
              const { data: mm } = await admin.from('masters').select('nome').eq('id', p.master_id).maybeSingle()
              await inviaCredenzialiCliente({ email, nomeCliente: nome, masterNome: mm?.nome || 'MoovExpress', dominio: 'moovexpress.com', password })
            } catch {}
          }
        }
      }
    }
    if (!masterId) return NextResponse.json({ error: 'Non riusciamo a completare l\'accettazione. Contatta il mittente.' }, { status: 500 })
    await rinomina()
    await admin.from('masters').update({ parent_listino_id: draftId }).eq('id', masterId)
    await finalizza(admin, p, draftId, null)
    return NextResponse.json({ ok: true })
  }

  // ── Cliente esistente. ──
  let clienteId: string | null = null
  let clienteCreatoId: string | null = null
  if (p.dest_tipo === 'cliente') {
    if (!p.cliente_id) return NextResponse.json({ error: 'Destinatario non valido.' }, { status: 400 })
    const { data: c } = await admin.from('clienti').select('id,master_id').eq('id', p.cliente_id).maybeSingle()
    if (!c || c.master_id !== p.master_id) return NextResponse.json({ error: 'Destinatario non valido.' }, { status: 400 })
    clienteId = c.id
  } else {
    // ── Cliente NUOVO: crea cliente + accesso sotto il master del preventivo. ──
    const email = String(p.dest_email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Email mancante: chiedi al mittente di reinviare il preventivo con la tua email.' }, { status: 400 })
    const { data: gia } = await admin.from('clienti').select('id,master_id').eq('email', email).maybeSingle()
    if (gia) {
      clienteId = gia.id   // email gia' cliente: uso quello, niente doppioni
    } else {
      let nuovo: { id: string } | null = null
      for (let t = 0; t < 6 && !nuovo; t++) {
        const { data: ultimi } = await admin.from('clienti').select('codice_cliente').eq('master_id', p.master_id).order('codice_cliente', { ascending: false }).limit(1)
        let prossimo = 1; const n = parseInt(String(ultimi?.[0]?.codice_cliente || '').replace(/\D/g, ''), 10); if (!isNaN(n)) prossimo = n + 1 + t
        const codice = `CLI-${String(prossimo).padStart(4, '0')}`
        const { data, error } = await admin.from('clienti').insert({
          master_id: p.master_id, ragione_sociale: p.dest_nome || email, email,
          listino_cliente_id: draftId, tipo_contratto: 'credito_scalare', codice_cliente: codice, attivo: true,
        }).select('id').single()
        if (!error && data) { nuovo = data; break }
        if (error?.code === '23505' && String(error.message).includes('email')) { const { data: g2 } = await admin.from('clienti').select('id').eq('email', email).maybeSingle(); if (g2) { clienteId = g2.id; break } }
        if (error?.code === '23505' && String(error.message).includes('codice')) continue
        console.error('[preventivo/accetta] insert cliente', error)
        return NextResponse.json({ error: 'Non riusciamo a creare il tuo account. Contatta il mittente.' }, { status: 500 })
      }
      if (nuovo) {
        clienteId = nuovo.id; clienteCreatoId = nuovo.id
        // Accesso (best-effort: se fallisce, il cliente resta e il master lo attiva).
        const password = generaPassword()
        const { data: au, error: aErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
        if (!aErr && au?.user) {
          const { error: uErr } = await admin.from('utenti').insert({ id: au.user.id, ruolo: 'cliente', master_id: p.master_id, cliente_id: nuovo.id, nome: p.dest_nome || email, attivo: true })
          if (uErr) { await admin.auth.admin.deleteUser(au.user.id).catch(() => {}) }
          else {
            try {
              const { inviaCredenzialiCliente } = await import('@/lib/email')
              const { data: mm } = await admin.from('masters').select('nome').eq('id', p.master_id).maybeSingle()
              await inviaCredenzialiCliente({ email, nomeCliente: p.dest_nome || email, masterNome: mm?.nome || 'MoovExpress', dominio: 'moovexpress.com', password })
            } catch {}
          }
        }
      }
    }
  }

  if (!clienteId) return NextResponse.json({ error: 'Non riusciamo a completare l\'accettazione. Contatta il mittente.' }, { status: 500 })
  await rinomina()
  await admin.from('clienti').update({ listino_cliente_id: draftId }).eq('id', clienteId).eq('master_id', p.master_id)
  await finalizza(admin, p, draftId, clienteCreatoId)
  return NextResponse.json({ ok: true })
}
