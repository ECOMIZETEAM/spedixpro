import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente, isAgente, clientiAgente } from '@/lib/agente'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato'}, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()

  // Sotto-master agganciato (id = "m:<masterId>"): mostrato come una scheda cliente.
  // L'agente non vede la rete/sotto-master.
  if (id.startsWith('m:')) {
    const _v = bloccaAgente(utente, 'Non disponibile per gli agenti.'); if (_v) return _v
    const targetId = id.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: m } = await admin.from('masters').select('*').eq('id', targetId).eq('parent_master_id', utente?.master_id).single()
    if (!m) return NextResponse.json({ error: 'Sotto-master non trovato' }, { status: 404 })
    const mm = m as any
    return NextResponse.json({
      ...m, id: 'm:' + m.id, ragione_sociale: m.nome || '—',
      codice_cliente: 'SUB-MASTER', is_master: true,
      listino_cliente_id: mm.parent_listino_id || null, listini_clienti: null,
      // Dati fiscali/sedi mappati dai nomi-colonna di `masters` a quelli attesi dalla scheda cliente
      cf: mm.codice_fiscale || null, cod_sdi: mm.codice_sdi || null,
      sl_paese: mm.paese || null, sl_indirizzo: mm.indirizzo || null,
      sl_citta: mm.citta || null, sl_provincia: mm.provincia || null, sl_cap: mm.cap || null,
      so_paese: mm.paese_operativo || null, so_indirizzo: mm.indirizzo_operativo || null,
      so_citta: mm.citta_operativo || null, so_provincia: mm.provincia_operativo || null, so_cap: mm.cap_operativo || null,
    })
  }

  let qCli = supabase
    .from('clienti')
    .select('*, listini_clienti(id,nome)')
    .eq('id', id)
    .eq('master_id', utente?.master_id)
  // Agente: può vedere SOLO un cliente a lui assegnato.
  if (isAgente(utente)) qCli = qCli.eq('agente', (((utente?.nome)||'')+' '+((utente?.cognome)||'')).trim())
  const { data: cliente } = await qCli.single()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' },{ status: 404 })
  return NextResponse.json(cliente)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato'}, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  const body = await req.json()
  const { resetPassword, email_conferma, ...datiCliente } = body

  // Modifica di un sotto-master (id = "m:<masterId>"): aggiorna la tabella masters
  if (id.startsWith('m:')) {
    const targetId = id.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: m } = await admin.from('masters').select('id,parent_master_id,email').eq('id', targetId).single()
    if (!m || m.parent_master_id !== utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    // Aggiorno solo i campi presenti nel body (così Anagrafica e Impostazioni non si sovrascrivono a vicenda)
    const upd: any = {}
    // Cambio email di accesso del sotto-master (login = email su auth + utenti + masters)
    const emVecchia = ((m as any).email || '').trim().toLowerCase()
    const emNuova = (datiCliente.email || '').trim().toLowerCase()
    if (emNuova && emNuova !== emVecchia) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emNuova)) return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
      const { data: giaUsata } = await admin.from('masters').select('id').eq('email', emNuova).neq('id', targetId).maybeSingle()
      if (giaUsata) return NextResponse.json({ error: 'Questa email è già usata da un altro account' }, { status: 409 })
      // Login del sotto-master = utenti con ruolo 'master' (l'email vive su auth.users, non su utenti).
      const { data: uSub } = await admin.from('utenti').select('id').eq('master_id', targetId).eq('ruolo', 'master')
      let authErr: string | null = null
      for (const u of (uSub || [])) {
        const { error: e } = await admin.auth.admin.updateUserById((u as any).id, { email: emNuova, email_confirm: true })
        if (e) authErr = e.message
      }
      if (authErr) return NextResponse.json({ error: 'Impossibile aggiornare l\'email di accesso: ' + authErr }, { status: 400 })
      upd.email = emNuova
    }
    if (datiCliente.ragione_sociale !== undefined) upd.nome = datiCliente.ragione_sociale
    if (datiCliente.telefono !== undefined) upd.telefono = datiCliente.telefono || null
    if (datiCliente.piva !== undefined) upd.piva = datiCliente.piva || null
    if (datiCliente.attivo !== undefined) upd.attivo = datiCliente.attivo ?? true
    if (datiCliente.tipo_contratto !== undefined) upd.tipo_contratto = datiCliente.tipo_contratto || null
    if (datiCliente.listino_cliente_id !== undefined) upd.parent_listino_id = datiCliente.listino_cliente_id || null
    // Stesse impostazioni del cliente (colonne aggiunte a masters)
    if (datiCliente.impostazioni !== undefined) upd.impostazioni = datiCliente.impostazioni
    if (datiCliente.prezzi_in_distinta !== undefined) upd.prezzi_in_distinta = datiCliente.prezzi_in_distinta
    if (datiCliente.visualizza_fatture !== undefined) upd.visualizza_fatture = datiCliente.visualizza_fatture
    if (datiCliente.vieta_inserimento !== undefined) upd.vieta_inserimento = datiCliente.vieta_inserimento
    if (datiCliente.vieta_cancellazione !== undefined) upd.vieta_cancellazione = datiCliente.vieta_cancellazione
    const { error } = await admin.from('masters').update(upd).eq('id', targetId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    // Se è stato (ri)assegnato un listino, RI-SINCRONIZZA subito il Listino Corrieri del sotto-master
    // (force: sovrascrive il vecchio, altrimenti "già configurato" lo salterebbe e vedrebbe il vecchio)
    // e propaga a cascata a tutta la sua discendenza. Così appena salvo l'assegnazione è già attiva.
    if (datiCliente.listino_cliente_id) {
      try {
        const { copiaListinoAlSottoMaster, propagaListinoACascata } = await import('@/lib/copia-listino-submaster')
        await copiaListinoAlSottoMaster(admin, targetId, { force: true })
        await propagaListinoACascata(admin, datiCliente.listino_cliente_id)
      } catch (e) { console.error('Copia listino sotto-master (modifica):', e) }
    }
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

  // ── Cambio email di accesso (login) ────────────────────────────────
  // L'email è anche lo username di login: se cambia va aggiornata su auth + utenti + clienti.
  const { data: cliCorr } = await supabase.from('clienti').select('email').eq('id', id).eq('master_id', utente?.master_id).maybeSingle()
  if (!cliCorr) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })
  const emailVecchia = (cliCorr.email || '').trim().toLowerCase()
  const emailNuova = (datiCliente.email || '').trim().toLowerCase()
  const cambioEmail = !!emailNuova && emailNuova !== emailVecchia
  if (cambioEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNuova)) return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    // Non deve essere già usata da un altro cliente (l'email login vive su auth.users, non su utenti).
    const { data: giaUsata } = await admin.from('clienti').select('id').eq('email', emailNuova).neq('id', id).maybeSingle()
    if (giaUsata) return NextResponse.json({ error: 'Questa email è già usata da un altro account' }, { status: 409 })
    // Aggiorno l'email di accesso sull'utente auth collegato al cliente (se esiste un login).
    const { data: uCli } = await admin.from('utenti').select('id').eq('cliente_id', id)
    let authErr: string | null = null
    for (const u of (uCli || [])) {
      const { error: e } = await admin.auth.admin.updateUserById((u as any).id, { email: emailNuova, email_confirm: true })
      if (e) authErr = e.message
    }
    if (authErr) return NextResponse.json({ error: 'Impossibile aggiornare l\'email di accesso: ' + authErr }, { status: 400 })
    aggiornamento.email = emailNuova
  }

  const { data: cliente, error } = await supabase.from('clienti').update(aggiornamento)
    .eq('id', id).eq('master_id', utente?.master_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  let emailInviata = false
  if (resetPassword) {
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const adminClient = createAdminSupabase()
      // Email di destinazione = quella NUOVA se cambiata in questo salvataggio, altrimenti l'attuale.
      const emailFinale = (aggiornamento.email || emailVecchia || cliente?.email || '').trim()
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
      const newPassword = 'Mv' + Array.from({length:9}, () => chars[Math.floor(Math.random()*chars.length)]).join('')
      // Utente di login del cliente (utenti.id == id auth). Se NON esiste (cliente importato/creato
      // senza accesso), lo CREO ora: così "reset password" vale anche come "attiva accesso".
      let { data: uLogin } = await adminClient.from('utenti').select('id').eq('cliente_id', id).limit(1).maybeSingle()
      let loginCreato = false
      if (!uLogin?.id && emailFinale) {
        const { data: authNew, error: cErr } = await adminClient.auth.admin.createUser({ email: emailFinale, password: newPassword, email_confirm: true })
        if (cErr) return NextResponse.json({ error: 'Impossibile creare l\'accesso: ' + cErr.message }, { status: 400 })
        if (authNew?.user?.id) {
          await adminClient.from('utenti').insert({ id: authNew.user.id, ruolo: 'cliente', master_id: utente?.master_id, cliente_id: id, nome: cliente?.ragione_sociale || emailFinale, attivo: true })
          uLogin = { id: authNew.user.id }; loginCreato = true
        }
      }
      if (uLogin?.id && emailFinale) {
        // Se appena creato ha già email+password; altrimenti aggiorno email attiva + password.
        if (!loginCreato) await adminClient.auth.admin.updateUserById(uLogin.id, { email: emailFinale, email_confirm: true, password: newPassword })
        const { inviaCredenzialiCliente } = await import('@/lib/email')
        await inviaCredenzialiCliente({ email: emailFinale, nomeCliente: cliente?.ragione_sociale || '', masterNome: 'MoovExpress', dominio: 'moovexpress.com', password: newPassword })
        emailInviata = true
      }
    } catch(e) { console.error('Reset password error:', e) }
  }
  return NextResponse.json({ success: true, emailInviata })
}

// Elimina un cliente DIRETTO del master. Bloccato se ha spedizioni (storico/fatturazione).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (utente?.ruolo || '').toLowerCase()
  if (!utente?.master_id || ruolo === 'cliente' || ruolo === 'agente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // ── Sotto-master (id = "m:<uuid>"): eliminabile anche se ha spedizioni ──
  // Il master GENITORE ASSORBE le spedizioni del sotto-master: restano registrate e
  // continuano a contare per tutta la catena sopra (i movimenti degli altri master, che
  // hanno master_id proprio, NON vengono toccati). Si rimuove solo lo strato/profilo del
  // sotto-master. I suoi corrieri sono copie di quelli del genitore: le spedizioni vengono
  // rimappate sul corriere gemello del genitore (stesso nome_contratto).
  if (id.startsWith('m:')) {
    const subId = id.slice(2)
    const { data: sub } = await admin.from('masters').select('id,parent_master_id').eq('id', subId).maybeSingle()
    if (!sub || sub.parent_master_id !== utente.master_id) {
      return NextResponse.json({ error: 'Sotto-master non trovato o non è un tuo sotto-master diretto' }, { status: 403 })
    }
    const parentId = sub.parent_master_id
    // I clienti / sotto-master collegati vanno gestiti prima (non li cancelliamo a cascata).
    const { count: nSubM } = await admin.from('masters').select('id', { count: 'exact', head: true }).eq('parent_master_id', subId)
    if (nSubM && nSubM > 0) return NextResponse.json({ error: `Ha ${nSubM} sotto-master collegati: rimuovili prima di eliminarlo.` }, { status: 409 })
    const { count: nCli } = await admin.from('clienti').select('id', { count: 'exact', head: true }).eq('master_id', subId)
    if (nCli && nCli > 0) return NextResponse.json({ error: `Ha ${nCli} clienti collegati: rimuovili prima di eliminarlo.` }, { status: 409 })

    // Rimappa le spedizioni sul corriere gemello del genitore; i corrieri del sotto-master
    // senza gemello passano al genitore (per non lasciare le spedizioni senza corriere).
    const { data: subCorr } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', subId)
    const { data: parCorr } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', parentId)
    const parByNome = new Map((parCorr || []).map((c: any) => [c.nome_contratto, c.id]))
    const corrGemelli: string[] = []  // corrieri del sotto-master rimpiazzati (eliminabili in cascade)
    for (const c of (subCorr || [])) {
      const twin = parByNome.get((c as any).nome_contratto)
      if (twin) {
        try { await admin.from('spedizioni').update({ corriere_id: twin }).eq('corriere_id', (c as any).id) } catch {}
        corrGemelli.push((c as any).id)
      } else {
        try { await admin.from('corrieri').update({ master_id: parentId }).eq('id', (c as any).id) } catch {}
      }
    }
    // Il genitore assorbe le spedizioni; staccale dalle distinte del sotto-master.
    try {
      const { data: subDist } = await admin.from('distinte').select('id').eq('master_id', subId)
      const distIds = (subDist || []).map((d: any) => d.id)
      if (distIds.length) await admin.from('spedizioni').update({ distinta_id: null }).in('distinta_id', distIds)
    } catch {}
    try { await admin.from('spedizioni').update({ master_id: parentId }).eq('master_id', subId) } catch {}

    // Svuota le dipendenze SOLO dei corrieri rimpiazzati (verranno rimossi in cascade con la
    // riga masters). Quelli passati al genitore mantengono i loro listini/fasce.
    if (corrGemelli.length) {
      for (const t of ['listini_corrieri_supplementi', 'listini_corrieri_fasce', 'listini_corrieri_corrieri', 'listini_clienti_supplementi', 'listini_clienti_corrieri', 'listini_clienti_fasce', 'listini_fasce', 'zone']) {
        try { await admin.from(t).delete().in('corriere_id', corrGemelli) } catch {}
      }
    }

    // Rimuove lo strato/ledger + operativi PROPRI del sotto-master (i movimenti degli altri
    // master della catena restano: hanno master_id diverso).
    try { await admin.from('clienti').update({ promosso_a_master_id: null }).eq('promosso_a_master_id', subId) } catch {}
    try { await admin.from('movimenti').delete().eq('master_id', subId) } catch {}
    try { await admin.from('movimenti').delete().eq('master_target_id', subId) } catch {}
    for (const t of ['movimenti_clienti', 'movimenti_credito', 'spedizioni_margini', 'ritiri', 'distinte_contrassegni', 'distinte', 'cod_files']) {
      try { await admin.from(t).delete().eq('master_id', subId) } catch {}
    }
    // Login del sotto-master (auth + utenti)
    try {
      const { data: uSub } = await admin.from('utenti').select('id').eq('master_id', subId)
      for (const u of (uSub || [])) {
        try { await admin.auth.admin.deleteUser((u as any).id) } catch {}
        try { await admin.from('utenti').delete().eq('id', (u as any).id) } catch {}
      }
    } catch {}
    // Profilo del sotto-master (cascade: corrieri rimpiazzati, listini, zone, permessi, notifiche).
    const { error } = await admin.from('masters').delete().eq('id', subId)
    if (error) return NextResponse.json({ error: `Impossibile eliminare: ${error.message}` }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  // Dev'essere un cliente DIRETTO di questo master.
  const { data: cli } = await admin.from('clienti').select('id,master_id,email').eq('id', id).maybeSingle()
  if (!cli || cli.master_id !== utente.master_id) {
    return NextResponse.json({ error: 'Cliente non trovato o non è un tuo cliente diretto' }, { status: 403 })
  }

  // Blocco: se ha spedizioni non si elimina (protegge storico e movimenti).
  const { count: nSped } = await admin.from('spedizioni').select('id', { count: 'exact', head: true }).eq('cliente_id', id)
  if (nSped && nSped > 0) {
    return NextResponse.json({ error: `Il cliente ha ${nSped} spedizioni registrate: non può essere eliminato. Puoi disattivarlo dalle sue impostazioni.` }, { status: 409 })
  }

  // Pulizia configurazione collegata (best-effort: tabelle non presenti non bloccano).
  for (const t of ['clienti_corrieri_abilitati', 'ordini_importati', 'ordini_ecommerce', 'integrazioni', 'ritiri', 'movimenti']) {
    try { await admin.from(t).delete().eq('cliente_id', id) } catch {}
  }
  // Login del cliente (auth + utenti).
  try {
    const { data: uCli } = await admin.from('utenti').select('id').eq('cliente_id', id)
    for (const u of (uCli || [])) {
      try { await admin.auth.admin.deleteUser((u as any).id) } catch {}
      try { await admin.from('utenti').delete().eq('id', (u as any).id) } catch {}
    }
  } catch {}

  const { error } = await admin.from('clienti').delete().eq('id', id)
  if (error) return NextResponse.json({ error: `Impossibile eliminare: ${error.message}` }, { status: 400 })
  return NextResponse.json({ success: true })
}