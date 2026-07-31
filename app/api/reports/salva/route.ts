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
  const { tipo, filtri, formato, fileBase64, nomeFile, clienteId } = body
  if (!fileBase64) return NextResponse.json({ error: 'File mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  // decodifico il base64
  const buffer = Buffer.from(fileBase64.split(',').pop() || fileBase64, 'base64')
  const path = utente?.master_id + '/' + Date.now() + '_' + (nomeFile || 'report')

  const contentType = formato === 'pdf' ? 'application/pdf'
    : formato === 'csv' ? 'text/csv'
    : formato === 'zip' ? 'application/zip'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  const { error: upErr } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

  // Un sotto-master selezionato arriva come "m:<id>": non è un cliente_id valido (uuid) -> null
  const clienteIdValido = (typeof clienteId === 'string' && clienteId.startsWith('m:')) ? null : (clienteId || utente?.cliente_id || null)
  const { data: rec, error } = await admin.from('reports_generati').insert({
    master_id: utente?.master_id,
    cliente_id: clienteIdValido,
    tipo: tipo || 'spedizioni',
    filtri: filtri || '',
    formato: formato || 'pdf',
    size_bytes: buffer.length,
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