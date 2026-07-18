import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { preparaRiepiloghi, disegnaRiepilogoSped } from '@/lib/riepilogo-ordine'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const body = await req.json()
  const { ids } = body
  if (!ids?.length) return NextResponse.json({ error: 'Nessun ID' }, { status: 400 })

  const ruolo = (utente?.ruolo || '').toLowerCase()
  // Campi extra per l'eventuale "riepilogo ordine" (packing slip) da anteporre alle etichette.
  const cols = 'id,numero,etichetta_url,colli_dettaglio,cliente_id,created_at,rif_ordine,rif_destinatario,contenuto,colli,peso_reale,peso_fatturato,contrassegno,dest_nome,dest_indirizzo,dest_citta,dest_cap,dest_provincia,dest_paese,dest_telefono,mitt_nome,corriere_id,corrieri(nome_contratto)'
  let spedizioni: any[] | null = null
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  if (ruolo === 'cliente') {
    const { data } = await supabase.from('spedizioni').select(cols).in('id', ids).eq('cliente_id', utente?.cliente_id)
    spedizioni = data
  } else {
    // Master: includi anche le spedizioni dei sotto-master della rete (stessa logica della lista)
    const { masterIdsVisibili } = await import('@/lib/rete-masters')
    const subtree = utente?.master_id ? await masterIdsVisibili(admin, utente.master_id) : []
    let q = admin.from('spedizioni').select(cols).in('id', ids).in('master_id', subtree.length ? subtree : ['00000000-0000-0000-0000-000000000000'])
    // Agente: solo etichette dei suoi clienti.
    if (isAgente(utente as any)) q = q.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
    const { data } = await q
    spedizioni = data
  }

  // Riepilogo ordine (packing slip): dati + drawer condivisi con la stampa singola.
  const riepCtx = await preparaRiepiloghi(admin, spedizioni || [])

  const pdfMerged = await PDFDocument.create()
  const font = await pdfMerged.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfMerged.embedFont(StandardFonts.HelveticaBold)

  for (const s of spedizioni || []) {
    const colli = (s.colli_dettaglio as any[]) || []
    const urls: string[] = []
    if (colli.length > 0) {
      colli.forEach((c: any) => { if (c.etichetta_url) urls.push(c.etichetta_url) })
    } else if (s.etichetta_url) {
      urls.push(s.etichetta_url)
    }

    // Prima le pagine ETICHETTA...
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
    // ...poi il RIEPILOGO ordine SOTTO l'etichetta (se il cliente lo ha attivato).
    try { disegnaRiepilogoSped(pdfMerged, font, fontBold, riepCtx, s) } catch (e) { console.error('Errore riepilogo:', e) }
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