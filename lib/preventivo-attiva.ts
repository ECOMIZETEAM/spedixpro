import { randomInt } from 'crypto'

// ATTIVAZIONE di un preventivo accettato: crea la POSIZIONE (cliente o sotto-master, nuovo o esistente)
// + le credenziali d'accesso + aggancia il listino-bozza come listino reale, e mette stato='accettato'.
//
// Questa logica PRIMA stava dentro l'accettazione pubblica (il destinatario cliccava Accetta e si creava
// tutto all'istante). Ora l'accettazione pubblica mette solo il preventivo IN ATTESA
// (stato='accettato_da_confermare') e questa funzione la chiama la RICONFERMA del master dal suo portale
// — così è il master a decidere quando aprire davvero la posizione e mandare le credenziali.
//
// Ritorna { ok: true } oppure { error, status } (niente NextResponse: la usano più rotte).

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
  // accettato_il lo scrive l'accettazione pubblica (il momento vero in cui il destinatario ha accettato):
  // qui NON lo si sovrascrive, si registra solo l'attivazione (listino/cliente creati) e lo stato finale.
  await admin.from('preventivi').update({ stato: 'accettato', listino_creato_id: draftId, cliente_creato_id: clienteCreatoId, updated_at: now }).eq('id', p.id)
  try {
    await admin.from('notifiche').insert({
      master_id: p.master_id, cliente_id: null, gruppi: ['Amministratore', 'Operatore'],
      oggetto: 'Preventivo attivato', messaggio: `Posizione attivata per ${p.dest_nome || ''}${p.oggetto ? ' — ' + p.oggetto : ''}`.trim(),
      link: '/dashboard/preventivi', created_by: p.created_by,
    })
  } catch {}
}

type Esito = { ok: true } | { error: string, status: number }

export async function attivaPreventivo(admin: any, p: any): Promise<Esito> {
  if (!p.listino_template_id) return { error: 'Preventivo senza prezzi.', status: 400 }
  const draftId = p.listino_template_id as string
  const rinomina = async () => { await admin.from('listini_clienti').update({ preventivo_id: null, nome: `Listino ${p.dest_nome || 'preventivo'}`.slice(0, 120) }).eq('id', draftId) }

  // ── Sotto-master ESISTENTE: il listino diventa il suo contratto (parent_listino_id). ──
  if (p.dest_tipo === 'master') {
    if (!p.master_target_id) return { error: 'Destinatario non valido.', status: 400 }
    const { data: tgt } = await admin.from('masters').select('id,parent_master_id').eq('id', p.master_target_id).maybeSingle()
    if (!tgt || tgt.parent_master_id !== p.master_id) return { error: 'Destinatario non valido.', status: 400 }
    await rinomina()
    await admin.from('masters').update({ parent_listino_id: draftId }).eq('id', p.master_target_id)
    await finalizza(admin, p, draftId, null)
    return { ok: true }
  }

  // ── Sotto-master NUOVO: crea il sotto-master + accesso sotto il master del preventivo. ──
  if (p.dest_tipo === 'master_nuovo') {
    const email = String(p.dest_email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email mancante: chiedi al destinatario la sua email.', status: 400 }
    let masterId: string | null = null
    const { data: giaM } = await admin.from('masters').select('id,parent_master_id').eq('email', email).maybeSingle()
    if (giaM) {
      if (giaM.parent_master_id !== p.master_id) return { error: 'Questa email è già usata da un altro operatore.', status: 400 }
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
          return { error: 'Questa email è già in uso.', status: 400 }
        }
        console.error('[preventivo/attiva] insert master', error)
        return { error: 'Non riusciamo a creare l\'account.', status: 500 }
      }
      if (creato) {
        masterId = creato.id
        const password = generaPassword()
        const { data: au, error: aErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
        if (!aErr && au?.user) {
          const { error: uErr } = await admin.from('utenti').insert({ id: au.user.id, ruolo: 'master', master_id: creato.id, cliente_id: null, nome, attivo: true })
          if (uErr) { await admin.auth.admin.deleteUser(au.user.id).catch(() => {}) }
          else {
            try {
              const { inviaCredenzialiCliente } = await import('@/lib/email')
              const { data: mm } = await admin.from('masters').select('nome').eq('id', p.master_id).maybeSingle()
              // areaStaff: è un sotto-MASTER, il link va al Control Center, non a /cliente (che lo respinge).
              await inviaCredenzialiCliente({ email, nomeCliente: nome, masterNome: mm?.nome || 'MoovExpress', dominio: 'moovexpress.com', password, areaStaff: true })
            } catch {}
          }
        }
      }
    }
    if (!masterId) return { error: 'Non riusciamo a completare l\'attivazione.', status: 500 }
    await rinomina()
    await admin.from('masters').update({ parent_listino_id: draftId }).eq('id', masterId)
    await finalizza(admin, p, draftId, null)
    return { ok: true }
  }

  // ── Cliente esistente. ──
  let clienteId: string | null = null
  let clienteCreatoId: string | null = null
  if (p.dest_tipo === 'cliente') {
    if (!p.cliente_id) return { error: 'Destinatario non valido.', status: 400 }
    const { data: c } = await admin.from('clienti').select('id,master_id').eq('id', p.cliente_id).maybeSingle()
    if (!c || c.master_id !== p.master_id) return { error: 'Destinatario non valido.', status: 400 }
    clienteId = c.id
  } else {
    // ── Cliente NUOVO: crea cliente + accesso sotto il master del preventivo. ──
    const email = String(p.dest_email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email mancante: chiedi al destinatario la sua email.', status: 400 }
    const { data: gia } = await admin.from('clienti').select('id,master_id').eq('email', email).maybeSingle()
    if (gia) {
      clienteId = gia.id
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
        console.error('[preventivo/attiva] insert cliente', error)
        return { error: 'Non riusciamo a creare l\'account del cliente.', status: 500 }
      }
      if (nuovo) {
        clienteId = nuovo.id; clienteCreatoId = nuovo.id
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

  if (!clienteId) return { error: 'Non riusciamo a completare l\'attivazione.', status: 500 }
  await rinomina()
  await admin.from('clienti').update({ listino_cliente_id: draftId }).eq('id', clienteId).eq('master_id', p.master_id)
  await finalizza(admin, p, draftId, clienteCreatoId)
  return { ok: true }
}
