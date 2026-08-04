import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI, linkReport } from '@/lib/file-riservati'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,nome,cognome').eq('id', user.id).single()

  const body = await req.json()
  const { tipo, filtri, formato, fileBase64, nomeFile, clienteId, pathCaricato, dimensione } = body
  // O il file dentro la richiesta, o un file gia' portato a destinazione per conto suo: sopra i
  // 4,5 MB la piattaforma respinge la richiesta, quindi i report grossi salgono da soli e qui
  // arriva solo il percorso.
  if (!fileBase64 && !pathCaricato) return NextResponse.json({ error: 'File mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const contentType = formato === 'pdf' ? 'application/pdf'
    : formato === 'csv' ? 'text/csv'
    : formato === 'zip' ? 'application/zip'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  let path: string
  let peso = Number(dimensione) || 0
  if (pathCaricato) {
    // IL PERCORSO ARRIVA DA FUORI: deve stare nella cartella di CHI CHIEDE. Senza questo controllo
    // si potrebbe intestarsi il file di un altro master scrivendone il percorso a mano.
    path = String(pathCaricato)
    if (!path.startsWith(utente?.master_id + '/')) {
      return NextResponse.json({ error: 'Percorso non valido' }, { status: 403 })
    }
    // E deve esistere davvero: una riga che punta al nulla e' peggio di nessuna riga.
    const cartella = path.slice(0, path.lastIndexOf('/'))
    const nome = path.slice(path.lastIndexOf('/') + 1)
    const { data: trovati } = await admin.storage.from(BUCKET_RISERVATI).list(cartella, { search: nome, limit: 1 })
    const f = (trovati || [])[0]
    if (!f) return NextResponse.json({ error: 'File non caricato' }, { status: 400 })
    peso = peso || Number((f as any)?.metadata?.size) || 0
  } else {
    const buffer = Buffer.from(fileBase64.split(',').pop() || fileBase64, 'base64')
    peso = buffer.length
    path = utente?.master_id + '/' + Date.now() + '_' + (nomeFile || 'report')
    const { error: upErr } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType, upsert: true })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
  }

  // Un sotto-master selezionato arriva come "m:<id>": non è un cliente_id valido (uuid) -> null
  const clienteIdValido = (typeof clienteId === 'string' && clienteId.startsWith('m:')) ? null : (clienteId || utente?.cliente_id || null)
  const { data: rec, error } = await admin.from('reports_generati').insert({
    master_id: utente?.master_id,
    cliente_id: clienteIdValido,
    tipo: tipo || 'spedizioni',
    filtri: filtri || '',
    formato: formato || 'pdf',
    size_bytes: peso,
    status: 'disponibile',
    file_url: '',        // riempito sotto: serve l'id della riga
    file_path: path,
    utente: ((utente?.nome || '') + ' ' + (utente?.cognome || '')).trim() || 'Utente',
    created_by: user.id,   // generatore: consente all'agente di rivedere/scaricare i propri report (RLS)
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Il link NON è più l'URL pubblico dello storage: un report spedizioni contiene prezzi e
  // margini, e quell'indirizzo restava scaricabile da chiunque, per sempre, anche senza account.
  // Ora punta a /api/file, che rilegge la riga con i permessi di chi chiede (RLS di
  // reports_generati) e solo allora consegna il file. Resta nel campo file_url perché le pagine
  // usano già quel campo per il bottone "Scarica".
  const fileUrl = linkReport(rec.id)
  await admin.from('reports_generati').update({ file_url: fileUrl }).eq('id', rec.id)
  return NextResponse.json({ success: true, report: { ...rec, file_url: fileUrl } })
}