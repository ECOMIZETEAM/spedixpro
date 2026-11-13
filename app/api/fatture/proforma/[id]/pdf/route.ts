import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { accessoProforma } from '@/lib/fatture/proforma-accesso'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// Il PDF di una proforma del master. Fino a 4 MB passa da qui; oltre, la piattaforma rifiuta la
// risposta (limite 4,5 MB), e si manda a un indirizzo firmato che vale un minuto.
const LIMITE_RISPOSTA = 4 * 1024 * 1024

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acc = await accessoProforma('admin.invoice.index')
  if (!acc.ok) return acc.risposta
  const { id } = await params
  const admin = createAdminSupabase()
  const { data: r } = await admin.from('fatture_proforma').select('file_path,numero,anno').eq('id', id).eq('master_id', acc.masterId).maybeSingle()
  if (!r) return NextResponse.json({ error: 'Proforma non trovata' }, { status: 404 })
  // Il percorso e' scritto da noi alla creazione, ma resta nella cartella del master: se un giorno la
  // riga venisse toccata a mano, non si serve il file di un altro.
  if (!String(r.file_path).startsWith(acc.masterId + '/proforma/')) return NextResponse.json({ error: 'File non valido' }, { status: 403 })
  const nome = `proforma-${r.numero}-${r.anno}.pdf`

  const { data: file, error } = await admin.storage.from(BUCKET_RISERVATI).download(r.file_path)
  if (error || !file) return NextResponse.json({ error: 'PDF non trovato' }, { status: 404 })
  if (file.size > LIMITE_RISPOSTA) {
    const { data: s } = await admin.storage.from(BUCKET_RISERVATI).createSignedUrl(r.file_path, 60, { download: nome })
    if (!s?.signedUrl) return NextResponse.json({ error: 'PDF non scaricabile' }, { status: 500 })
    return NextResponse.redirect(s.signedUrl)
  }
  return new NextResponse(Buffer.from(await file.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nome}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
