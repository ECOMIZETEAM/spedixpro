import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { accessoProforma } from '@/lib/fatture/proforma-accesso'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'
import { inviaEmailProforma } from '@/lib/email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Resend accetta allegati fino a 40 MB, ma molte caselle respingono le email oltre i 20.
const ALLEGATO_MAX = 15 * 1024 * 1024

// { email }: manda la proforma al cliente col PDF allegato. L'indirizzo lo propone la pagina (quello
// della scheda cliente) e il master lo puo' cambiare prima di mandare.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acc = await accessoProforma('admin.invoice.create')
  if (!acc.ok) return acc.risposta
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const email = String(body?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Email non valida' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: r } = await admin.from('fatture_proforma')
    .select('id,numero,anno,dal,al,totale,intestazione,emittente,file_path')
    .eq('id', id).eq('master_id', acc.masterId).maybeSingle()
  if (!r) return NextResponse.json({ error: 'Proforma non trovata' }, { status: 404 })
  if (!String(r.file_path).startsWith(acc.masterId + '/proforma/')) return NextResponse.json({ error: 'File non valido' }, { status: 403 })

  // Un account demo ha clienti inventati: non si scrive a nessuno di vero.
  const { data: m } = await admin.from('masters').select('nome,logo_url,email,email_sede,demo').eq('id', acc.masterId).single()
  if ((m as any)?.demo === true) return NextResponse.json({ error: 'Nella prova demo le email ai clienti non partono' }, { status: 402 })

  const { data: file, error } = await admin.storage.from(BUCKET_RISERVATI).download(r.file_path)
  if (error || !file) return NextResponse.json({ error: 'PDF non trovato' }, { status: 404 })
  if (file.size > ALLEGATO_MAX) return NextResponse.json({ error: 'Il PDF è troppo grande per un allegato: scaricalo e mandalo con un servizio di trasferimento file' }, { status: 413 })

  const numero = `${r.numero}/${r.anno}`
  const esito = await inviaEmailProforma({
    to: email,
    // Risponde al master: l'indirizzo di sede se c'e', altrimenti quello dell'account.
    replyTo: (m as any)?.email_sede || (m as any)?.email || null,
    master: { nome: (m as any)?.nome || r.emittente?.nome || '', logo: (m as any)?.logo_url || null },
    cliente: r.intestazione?.ragione_sociale || '', numero, dal: r.dal, al: r.al, totale: Number(r.totale),
    pdf: Buffer.from(await file.arrayBuffer()), nomeFile: `proforma-${r.numero}-${r.anno}.pdf`,
  })
  if (!esito.ok) return NextResponse.json({ error: 'Email non partita: ' + (esito.error || '') }, { status: 502 })
  await admin.from('fatture_proforma').update({ inviata_a: email, inviata_il: new Date().toISOString() }).eq('id', r.id)
  return NextResponse.json({ ok: true, inviata_a: email })
}
