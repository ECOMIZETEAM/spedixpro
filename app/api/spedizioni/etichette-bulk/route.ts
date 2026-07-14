import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { PDFDocument } from 'pdf-lib'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const body = await req.json()
  const { ids } = body
  if (!ids?.length) return NextResponse.json({ error: 'Nessun ID' }, { status: 400 })

  const ruolo = (utente?.ruolo || '').toLowerCase()
  const cols = 'id,numero,etichetta_url,colli_dettaglio'
  let spedizioni: any[] | null = null
  if (ruolo === 'cliente') {
    const { data } = await supabase.from('spedizioni').select(cols).in('id', ids).eq('cliente_id', utente?.cliente_id)
    spedizioni = data
  } else {
    // Master: includi anche le spedizioni dei sotto-master della rete (stessa logica della lista)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { masterIdsVisibili } = await import('@/lib/rete-masters')
    const admin = createAdminSupabase()
    const subtree = utente?.master_id ? await masterIdsVisibili(admin, utente.master_id) : []
    let q = admin.from('spedizioni').select(cols + ',cliente_id').in('id', ids).in('master_id', subtree.length ? subtree : ['00000000-0000-0000-0000-000000000000'])
    // Agente: solo etichette dei suoi clienti.
    if (isAgente(utente as any)) q = q.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
    const { data } = await q
    spedizioni = data
  }

  const pdfMerged = await PDFDocument.create()

  for (const s of spedizioni || []) {
    const colli = (s.colli_dettaglio as any[]) || []
    const urls: string[] = []
    if (colli.length > 0) {
      colli.forEach((c: any) => { if (c.etichetta_url) urls.push(c.etichetta_url) })
    } else if (s.etichetta_url) {
      urls.push(s.etichetta_url)
    }

    for (const url of urls) {
      try {
        let pdfBytes: Uint8Array
        if (url.startsWith('data:application/pdf;base64,')) {
          const base64 = url.replace('data:application/pdf;base64,', '')
          pdfBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        } else {
          const res = await fetch(url)
          pdfBytes = new Uint8Array(await res.arrayBuffer())
        }
        const pdf = await PDFDocument.load(pdfBytes)
        const pages = await pdfMerged.copyPages(pdf, pdf.getPageIndices())
        pages.forEach(p => pdfMerged.addPage(p))
      } catch(e) {
        console.error('Errore PDF:', e)
      }
    }
  }

  const mergedBytes = await pdfMerged.save()
  const buffer = Buffer.from(mergedBytes)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="etichette_${ids.length}.pdf"`,
    }
  })
}