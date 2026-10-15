import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI, linkReport, percorsoSicuro } from '@/lib/file-riservati'

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
  // Alcune pagine mandano 'PDF' maiuscolo: confrontato cosi' com'era, quei PDF finivano salvati come
  // fogli Excel (43 fra Rettifiche e Ricariche) e /api/file li serviva da scaricare invece che da aprire.
  const fmt = String(formato || '').toLowerCase()
  const contentType = fmt === 'pdf' ? 'application/pdf'
    : fmt === 'csv' ? 'text/csv'
    : fmt === 'zip' ? 'application/zip'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  let path: string
  let peso = Number(dimensione) || 0
  if (pathCaricato) {
    // IL PERCORSO ARRIVA DA FUORI: deve stare nella cartella di CHI CHIEDE. Senza questo controllo
    // si potrebbe intestarsi il file di un altro master scrivendone il percorso a mano.
    path = String(pathCaricato)
    // Anche i ".." vanno fuori: "<mio>/../<altro>/f" comincia con la mia cartella ma, scaricato,
    // porta al file dell'altro.
    if (!path.startsWith(utente?.master_id + '/') || !percorsoSicuro(path)) {
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
    // Il nome arriva dal browser: si tiene solo cio' che e' un nome di file, come in upload-url.
    // Prima passava com'era, e il caricamento e' con la chiave di servizio e sovrascrive: un nome
    // come "x/../../../loghi/<file>" usciva dalla cartella del master, e anche dal bucket (i ".."
    // si risolvono nell'indirizzo prima che la richiesta parta), e scriveva sopra loghi o etichette.
    const pulito = String(nomeFile || 'report').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    path = utente?.master_id + '/' + Date.now() + '_' + pulito
    const { error: upErr } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType, upsert: true })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
  }

  // Un sotto-master selezionato arriva come "m:<id>": non è un cliente_id valido (uuid) -> null.
  // L'id arriva dal browser: il cliente puo' intestare il report solo a se stesso, lo staff solo a
  // un cliente del proprio master. Prima si prendeva com'era e una riga finiva sotto un cliente altrui.
  let clienteIdValido: string | null = null
  if (utente?.cliente_id) {
    clienteIdValido = utente.cliente_id
  } else if (typeof clienteId === 'string' && clienteId && !clienteId.startsWith('m:')) {
    const { data: suo } = await admin.from('clienti').select('id').eq('id', clienteId).eq('master_id', utente?.master_id).maybeSingle()
    clienteIdValido = suo?.id || null
  }
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