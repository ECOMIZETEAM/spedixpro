import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

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

  const { error: upErr } = await admin.storage.from('reports').upload(path, buffer, { contentType, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

  const { data: pub } = admin.storage.from('reports').getPublicUrl(path)
  const fileUrl = pub?.publicUrl || ''

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
    file_url: fileUrl,
    file_path: path,
    utente: ((utente?.nome || '') + ' ' + (utente?.cognome || '')).trim() || 'Utente',
    created_by: user.id,   // generatore: consente all'agente di rivedere/scaricare i propri report (RLS)
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, report: rec })
}