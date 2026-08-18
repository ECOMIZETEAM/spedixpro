import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// Apertura di un ticket di assistenza.
// - Cliente: il ticket va al proprio master (owner = master del cliente).
// - Sotto-master: il ticket va alla linea superiore (owner = parent del proprio master).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if ((utente?.ruolo || '').toLowerCase() === 'agente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const masterId = utente?.master_id
  if (!masterId) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const body = await req.json()
  const categoria = body?.categoria === 'pod' ? 'pod' : 'ticket'
  const oggetto = String(body?.oggetto || '').trim()
  // per la POD il messaggio è facoltativo (basta la LDV)
  const messaggio = String(body?.messaggio || '').trim() || (categoria === 'pod' ? 'Richiesta POD' : '')
  if (!oggetto || !messaggio) return NextResponse.json({ error: categoria === 'pod' ? 'Inserisci la LDV' : 'Oggetto e messaggio sono obbligatori' }, { status: 400 })

  const admin = createAdminSupabase()
  const ruolo = (utente?.ruolo || '').toLowerCase()

  const record: any = { oggetto, messaggio, stato: 'aperto', categoria, non_letto_owner: true }

  if (ruolo === 'cliente') {
    if (!utente?.cliente_id) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
    const { data: cli } = await admin.from('clienti').select('ragione_sociale').eq('id', utente.cliente_id).maybeSingle()
    record.owner_master_id = masterId
    record.cliente_id = utente.cliente_id
    record.aperto_da = cli?.ragione_sociale || 'Cliente'
    record.tipo_apertura = 'cliente'
  } else {
    // È un master: il ticket va alla sua linea superiore
    const { data: m } = await admin.from('masters').select('nome,parent_master_id').eq('id', masterId).maybeSingle()
    if (!m?.parent_master_id) {
      return NextResponse.json({ error: 'Sei il master principale: non hai una linea superiore a cui aprire un ticket.' }, { status: 400 })
    }
    record.owner_master_id = m.parent_master_id
    record.aperto_master_id = masterId
    record.aperto_da = m?.nome || 'Master'
    record.tipo_apertura = 'master'
  }

  // Collegamento alla SPEDIZIONE (per il badge "ticket aperto" sull'elenco). Facoltativo, e
  // VALIDATO: il cliente può collegare solo una sua spedizione; il master solo una della sua rete
  // (sua o dei sotto-master). Se non valido, si apre il ticket senza collegamento (la LDV resta
  // comunque nell'oggetto) invece di fallire.
  const autorizzatoSp = async (sp: any): Promise<boolean> => {
    if (!sp) return false
    if (ruolo === 'cliente') return sp.cliente_id === utente?.cliente_id
    if (sp.master_id === masterId) return true
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    return (await sottoAlberoMasterIds(admin, masterId)).includes(sp.master_id)
  }
  const spedIdIn = String(body?.spedizione_id || '').trim()
  if (spedIdIn) {
    const { data: sp } = await admin.from('spedizioni').select('id,cliente_id,master_id').eq('id', spedIdIn).maybeSingle()
    if (await autorizzatoSp(sp)) record.spedizione_id = (sp as any).id
  }
  // Fallback: nessun id esplicito ma l'oggetto è una LDV → collega solo se combacia UNA sola
  // spedizione autorizzata (evita ambiguità se due master hanno numeri simili).
  if (!record.spedizione_id) {
    const ldv = oggetto.trim()
    if (ldv.length >= 4 && ldv.length <= 40) {
      const { data: sps } = await admin.from('spedizioni').select('id,cliente_id,master_id').eq('numero', ldv).limit(2)
      if (sps && sps.length === 1 && await autorizzatoSp(sps[0])) record.spedizione_id = (sps[0] as any).id
    }
  }

  // Allegati (foto/PDF) — solo sui ticket
  const allegatiIn = Array.isArray(body?.allegati) ? body.allegati.slice(0, 10) : []
  const allegatiOut: any[] = []
  for (let i = 0; i < allegatiIn.length; i++) {
    const a = allegatiIn[i]
    try {
      const dati = String(a?.dati || '')
      const b64 = dati.split(',').pop() || dati
      if (!b64) continue
      const buffer = Buffer.from(b64, 'base64')
      const nomePulito = String(a?.nome || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
      const ct = String(a?.tipo || 'application/octet-stream')
      const path = `allegati/${masterId}/${Date.now()}_${i}_${nomePulito}`
      const { error: upErr } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType: ct, upsert: true })
      // Si salva il PERCORSO, non un URL pubblico: il bucket e' privato e l'allegato esce solo da
      // /api/file, che prima controlla che chi scarica sia davvero parte di questa richiesta.
      if (!upErr) allegatiOut.push({ url: path, nome: String(a?.nome || 'file'), tipo: ct })
    } catch { /* salta l'allegato non valido */ }
  }
  if (allegatiOut.length) record.allegati = allegatiOut

  const { data, error } = await admin.from('tickets').insert(record).select('id,codice').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Primo messaggio del thread (la chat): l'apertura stessa.
  if (data?.id) {
    // Chi APRE è sempre il lato "richiedente" della chat = 'cliente' (anche un sotto-master che apre
    // verso la linea superiore: lui chiede, l'owner risponde come 'master'). Coerente con la GET/POST.
    await admin.from('ticket_messaggi').insert({
      ticket_id: data.id,
      autore: 'cliente',
      autore_id: user.id,   // chi ha scritto davvero: distingue in chat i "· tu" (il master è condiviso)
      autore_nome: record.aperto_da || (ruolo === 'cliente' ? 'Cliente' : 'Master'),
      testo: messaggio,
      allegati: allegatiOut.length ? allegatiOut : null,
    })
  }
  return NextResponse.json({ success: true, id: data?.id, codice: data?.codice })
}
