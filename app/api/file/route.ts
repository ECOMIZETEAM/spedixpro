import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { partecipanteTicket } from '@/lib/ticket-accesso'
import { BUCKET_RISERVATI, pathDaUrl, nomeDaPath } from '@/lib/file-riservati'

// L'UNICA porta d'uscita per report, allegati dei ticket e POD.
//
// Prima questi file stavano su un bucket pubblico e il link bastava a scaricarli: nessun
// controllo, nessuna scadenza, nessun modo di revocarli. Qui invece ogni download passa dai
// permessi — e chi non ha titolo riceve 403 anche conoscendo il percorso esatto.
//
//   /api/file?r=<id report>              → report (i permessi li decide la RLS di reports_generati)
//   /api/file?t=<id ticket>&f=<percorso> → allegato o POD di quel ticket
//
// Sul secondo caso non basta essere dentro il ticket: si verifica che il percorso chiesto
// appartenga DAVVERO a quella richiesta, altrimenti chiunque abbia un proprio ticket potrebbe
// usarlo come chiave per leggere gli allegati di tutti gli altri.

function inline(mime: string) {
  return mime === 'application/pdf' || mime.startsWith('image/')
}

async function servi(admin: any, path: string) {
  const { data, error } = await admin.storage.from(BUCKET_RISERVATI).download(path)
  if (error || !data) {
    console.error('[FILE] non scaricabile', path, error?.message)
    return NextResponse.json({ error: 'File non disponibile' }, { status: 404 })
  }
  const buffer = Buffer.from(await data.arrayBuffer())
  const mime = (data as any).type || 'application/octet-stream'
  const nome = nomeDaPath(path)
  return new NextResponse(buffer as any, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${inline(mime) ? 'inline' : 'attachment'}; filename="${nome.replace(/"/g, '')}"`,
      // Privato: né i proxy né la cache condivisa devono tenersi una copia di un file riservato.
      'Cache-Control': 'private, no-store',
    },
  })
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const admin = createAdminSupabase()
  const reportId = req.nextUrl.searchParams.get('r')
  const ticketId = req.nextUrl.searchParams.get('t')

  // ── REPORT ────────────────────────────────────────────────────────────────
  // Letto con il client dell'UTENTE, non con l'admin: così è la RLS di reports_generati a dire
  // chi può vederlo (il master della rete, il cliente intestatario, l'agente che l'ha generato).
  // Se non ne ha diritto la riga semplicemente non esiste per lui.
  if (reportId) {
    const { data: rep } = await supabase.from('reports_generati')
      .select('id,file_path,file_url').eq('id', reportId).maybeSingle()
    if (!rep) return NextResponse.json({ error: 'Report non trovato' }, { status: 404 })
    const path = pathDaUrl(rep.file_path || rep.file_url)
    if (!path) return NextResponse.json({ error: 'File non disponibile' }, { status: 404 })
    return servi(admin, path)
  }

  // ── ALLEGATI E POD DEI TICKET ─────────────────────────────────────────────
  if (ticketId) {
    const chiesto = pathDaUrl(req.nextUrl.searchParams.get('f'))
    if (!chiesto) return NextResponse.json({ error: 'Percorso mancante' }, { status: 400 })
    const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
    const { data: t } = await admin.from('tickets')
      .select('id,cliente_id,owner_master_id,aperto_master_id,rete_master_ids,pod_url,allegati')
      .eq('id', ticketId).maybeSingle()
    if (!t) return NextResponse.json({ error: 'Ticket non trovato' }, { status: 404 })
    const ruolo = partecipanteTicket(utente, t)
    if (!ruolo) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

    // I percorsi ammessi per QUESTO ticket: la POD, gli allegati dell'apertura e quelli dei
    // messaggi. Al richiedente valgono solo i messaggi pubblici, come nella chat: gli scambi
    // interni della rete non esistono per lui, allegati compresi.
    const ammessi = new Set<string>()
    const aggiungi = (v: any) => { const p = pathDaUrl(v); if (p) ammessi.add(p) }
    aggiungi(t.pod_url)
    for (const a of (Array.isArray(t.allegati) ? t.allegati : [])) aggiungi(a?.url || a?.path)
    let q = admin.from('ticket_messaggi').select('allegati,visibilita').eq('ticket_id', ticketId)
    if (ruolo === 'cliente') q = q.eq('visibilita', 'pubblico')
    const { data: msg } = await q
    for (const m of (msg || [])) for (const a of (Array.isArray(m.allegati) ? m.allegati : [])) aggiungi(a?.url || a?.path)

    if (!ammessi.has(chiesto)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    return servi(admin, chiesto)
  }

  return NextResponse.json({ error: 'Richiesta incompleta' }, { status: 400 })
}
