import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'
import { leggiGrigliaListino } from '@/lib/preventivo-prezzi'

// Singolo preventivo: GET (con il branding del master per l'anteprima) + PATCH (dettagli + contenuto).
// Il contenuto e' un jsonb flessibile: { sezioni: [{id,tipo,titolo,testo}], corrieri: [{corriere_id,nome,markup,righe}] }.

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('*').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  // Branding del master per l'anteprima (logo, nome, colori). Vive su masters.
  const { data: m } = await admin.from('masters').select('nome,logo_url,colore_primario,colore_secondario,email,telefono,indirizzo,citta,cap,provincia,pec,partita_iva,piva').eq('id', s.master_id).maybeSingle()
  const prezzi = await leggiGrigliaListino(admin, p.listino_template_id)
  return NextResponse.json({ preventivo: p, branding: m || {}, prezzi })
}

// POST azione 'crea_listino': crea (o ritorna) il listino-BOZZA collegato al preventivo, da compilare
// con l'editor listini completo (tutte le zone + supplementi). Marcato preventivo_id per non comparire
// tra i listini clienti veri.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato,listino_template_id,dest_nome,dest_email,oggetto,token').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })

  if (b.azione === 'invia') {
    if (p.stato === 'accettato') return NextResponse.json({ error: 'Preventivo gia\' accettato.' }, { status: 400 })
    const to = (b.email || p.dest_email || '').trim()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ error: 'Email destinatario mancante o non valida' }, { status: 400 })
    if (!p.listino_template_id) return NextResponse.json({ error: 'Compila prima i prezzi (listino) del preventivo.' }, { status: 400 })
    const { data: m } = await admin.from('masters').select('nome,logo_url,colore_primario,colore_secondario').eq('id', s.master_id).maybeSingle()
    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
    const { inviaEmailPreventivo } = await import('@/lib/email')
    const esito = await inviaEmailPreventivo({ to, oggetto: p.oggetto, destNome: p.dest_nome, link: `${base}/preventivo/${p.token}`, master: m || {} })
    if (!esito.ok) return NextResponse.json({ error: 'Invio email fallito: ' + (esito.error || '') }, { status: 400 })
    await admin.from('preventivi').update({ stato: 'inviato', inviato_il: new Date().toISOString(), dest_email: to, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  // RICONFERMA del master: il destinatario ha accettato (stato 'accettato_da_confermare'), ora il master
  // conferma e SI APRE davvero la posizione (cliente/sotto-master + credenziali + listino reale).
  if (b.azione === 'attiva') {
    if (p.stato === 'accettato') return NextResponse.json({ ok: true, gia: true })
    if (p.stato !== 'accettato_da_confermare') return NextResponse.json({ error: 'Il preventivo non è in attesa di conferma (il destinatario non l\'ha ancora accettato).' }, { status: 400 })
    // Ricarico il preventivo COMPLETO (servono dest_tipo, cliente_id, master_target_id, created_by...).
    const { data: pieno } = await admin.from('preventivi').select('*').eq('id', id).maybeSingle()
    if (!pieno || pieno.master_id !== s.master_id) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
    const { attivaPreventivo } = await import('@/lib/preventivo-attiva')
    const esito = await attivaPreventivo(admin, pieno)
    if ('error' in esito) return NextResponse.json({ error: esito.error }, { status: esito.status })
    return NextResponse.json({ ok: true })
  }

  if (b.azione === 'crea_listino') {
    if (p.stato === 'accettato') return NextResponse.json({ error: 'Preventivo gia\' accettato.' }, { status: 400 })
    // Gia' collegato e ancora esistente? ritorna quello.
    if (p.listino_template_id) {
      const { data: l } = await admin.from('listini_clienti').select('id').eq('id', p.listino_template_id).maybeSingle()
      if (l) return NextResponse.json({ ok: true, listino_id: l.id })
    }
    // Se il master parte da un listino ESISTENTE, la bozza nasce come sua COPIA (corrieri+fasce+
    // supplementi): il listino di origine resta intatto, la bozza è modificabile e all'accettazione
    // diventa il listino del cliente. Senza sourceListinoId la bozza è vuota (compilata da zero).
    let srcCfg: any = null
    const srcId = b.sourceListinoId ? String(b.sourceListinoId) : null
    if (srcId) {
      const { data: src } = await admin.from('listini_clienti').select('id,fattore_volume,solo_peso_reale')
        .eq('id', srcId).eq('master_id', s.master_id).maybeSingle()
      if (!src) return NextResponse.json({ error: 'Listino di origine non trovato' }, { status: 404 })
      srcCfg = src
    }
    const { data: nuovo, error: e1 } = await admin.from('listini_clienti').insert({
      master_id: s.master_id, nome: `Preventivo — ${p.dest_nome || p.oggetto || 'bozza'}`.slice(0, 120),
      attivo: true, preventivo_id: id,
      fattore_volume: srcCfg?.fattore_volume ?? null, solo_peso_reale: srcCfg?.solo_peso_reale ?? false,
    }).select('id').single()
    if (e1 || !nuovo) return NextResponse.json({ error: e1?.message || 'Errore creazione listino' }, { status: 400 })
    if (srcId) {
      // fetchAll (oltre 1000 righe non si troncano) + controllo errori: se una insert fallisce la
      // bozza NON deve restare a metà → rollback (il CASCADE toglie i figli) e 400. Prima le insert
      // erano `if (?.length)` senza verifica e la bozza poteva uscire vuota/parziale.
      const { fetchAll } = await import('@/lib/fetch-all')
      const cs = await fetchAll(() => admin.from('listini_clienti_corrieri').select('corriere_id,fattore_volume,abilitato').eq('listino_id', srcId).order('corriere_id', { ascending: true }))
      const fs = await fetchAll(() => admin.from('listini_clienti_fasce').select('corriere_id,zona_id,peso_min,peso_max,tipo,fuel,prezzo').eq('listino_id', srcId).order('id', { ascending: true }))
      const ss = await fetchAll(() => admin.from('listini_clienti_supplementi').select('corriere_id,tipo,descrizione,valore,tipo_calcolo,nome').eq('listino_id', srcId).order('id', { ascending: true }))
      const rollback = async (msg: string) => { await admin.from('listini_clienti').delete().eq('id', nuovo.id); return NextResponse.json({ error: msg }, { status: 400 }) }
      if (cs.length) { const { error } = await admin.from('listini_clienti_corrieri').insert(cs.map((r: any) => ({ ...r, listino_id: nuovo.id }))); if (error) return rollback('Copia contratti non riuscita: ' + error.message) }
      for (let i = 0; i < fs.length; i += 1000) { const { error } = await admin.from('listini_clienti_fasce').insert(fs.slice(i, i + 1000).map((r: any) => ({ ...r, listino_id: nuovo.id }))); if (error) return rollback('Copia prezzi non riuscita: ' + error.message) }
      if (ss.length) { const { error } = await admin.from('listini_clienti_supplementi').insert(ss.map((r: any) => ({ ...r, listino_id: nuovo.id }))); if (error) return rollback('Copia supplementi non riuscita: ' + error.message) }
    }
    await admin.from('preventivi').update({ listino_template_id: nuovo.id, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, listino_id: nuovo.id })
  }
  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: p } = await admin.from('preventivi').select('id,master_id,stato').eq('id', id).maybeSingle()
  if (!p || p.master_id !== s.master_id) return NextResponse.json({ error: 'Preventivo non trovato' }, { status: 404 })
  if (p.stato === 'accettato') return NextResponse.json({ error: 'Un preventivo accettato non si modifica.' }, { status: 400 })

  const b = await req.json().catch(() => ({}))
  const patch: any = { updated_at: new Date().toISOString() }
  if (b.dest_tipo && ['cliente_nuovo', 'cliente', 'master', 'master_nuovo'].includes(b.dest_tipo)) patch.dest_tipo = b.dest_tipo
  if (b.dest_nome !== undefined) patch.dest_nome = b.dest_nome ? String(b.dest_nome).slice(0, 200) : null
  if (b.dest_email !== undefined) patch.dest_email = b.dest_email ? String(b.dest_email).slice(0, 200).trim() : null
  if (b.cliente_id !== undefined) patch.cliente_id = b.cliente_id || null
  if (b.master_target_id !== undefined) patch.master_target_id = b.master_target_id || null
  if (b.oggetto !== undefined) patch.oggetto = b.oggetto ? String(b.oggetto).slice(0, 300) : null
  if (b.valido_fino !== undefined) patch.valido_fino = b.valido_fino || null
  if (b.contenuto !== undefined && b.contenuto && typeof b.contenuto === 'object') patch.contenuto = b.contenuto

  const { error } = await admin.from('preventivi').update(patch).eq('id', id).eq('master_id', s.master_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
