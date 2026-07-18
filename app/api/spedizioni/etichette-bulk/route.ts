import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
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
  // Campi extra per l'eventuale "riepilogo ordine" (packing slip) da anteporre alle etichette.
  const cols = 'id,numero,etichetta_url,colli_dettaglio,cliente_id,created_at,rif_ordine,rif_destinatario,contenuto,colli,peso_reale,peso_fatturato,contrassegno,dest_nome,dest_indirizzo,dest_citta,dest_cap,dest_provincia,dest_paese,dest_telefono,mitt_nome'
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

  // Impostazione "stampa riepilogo ordine" per cliente coinvolto (clienti.impostazioni.stampa_riepilogo).
  const cliIds = Array.from(new Set((spedizioni || []).map((s: any) => s.cliente_id).filter(Boolean)))
  const riepilogoCli = new Map<string, boolean>()
  const nomeCli = new Map<string, string>()
  if (cliIds.length) {
    const { data: cs } = await admin.from('clienti').select('id,ragione_sociale,impostazioni').in('id', cliIds)
    for (const c of (cs || [])) {
      riepilogoCli.set((c as any).id, ((c as any).impostazioni?.stampa_riepilogo) === 'si')
      nomeCli.set((c as any).id, (c as any).ragione_sociale || '')
    }
  }

  const pdfMerged = await PDFDocument.create()
  const font = await pdfMerged.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfMerged.embedFont(StandardFonts.HelveticaBold)

  // Disegna una pagina A6 di riepilogo ordine (packing slip) per la spedizione.
  const disegnaRiepilogo = (s: any) => {
    const W = 298, H = 420 // A6 in punti (~105x148mm)
    const page = pdfMerged.addPage([W, H])
    const nero = rgb(0.1, 0.1, 0.1), grigio = rgb(0.45, 0.45, 0.45)
    let y = H - 34
    const testo = (t: string, x: number, size = 9, bold = false, col = nero) => {
      page.drawText(String(t ?? ''), { x, y, size, font: bold ? fontBold : font, color: col })
    }
    testo('RIEPILOGO ORDINE', 20, 13, true)
    y -= 16
    const data = s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT') : ''
    testo('Data: ' + data, 20, 9, false, grigio)
    y -= 13
    if (s.rif_ordine) { testo('ID Ordine: ' + s.rif_ordine, 20, 10, true); y -= 14 }
    testo('N. Spedizione: ' + (s.numero || ''), 20, 9, false, grigio)
    y -= 18
    page.drawLine({ start: { x: 20, y: y + 6 }, end: { x: W - 20, y: y + 6 }, thickness: 0.6, color: grigio })
    y -= 8
    testo('MITTENTE', 20, 8, true, grigio); y -= 12
    testo(s.mitt_nome || nomeCli.get(s.cliente_id) || '', 20, 9); y -= 18
    testo('DESTINATARIO', 20, 8, true, grigio); y -= 12
    testo(s.dest_nome || '', 20, 10, true); y -= 12
    if (s.dest_indirizzo) { testo(s.dest_indirizzo, 20, 9, false, grigio); y -= 11 }
    testo([s.dest_cap, s.dest_citta, s.dest_provincia && '(' + s.dest_provincia + ')', s.dest_paese].filter(Boolean).join(' '), 20, 9, false, grigio); y -= 11
    if (s.dest_telefono) { testo('Tel: ' + s.dest_telefono, 20, 9, false, grigio); y -= 11 }
    y -= 8
    page.drawLine({ start: { x: 20, y: y + 6 }, end: { x: W - 20, y: y + 6 }, thickness: 0.6, color: grigio })
    y -= 8
    if (s.contenuto) { testo('Contenuto: ' + String(s.contenuto).slice(0, 60), 20, 9); y -= 13 }
    testo('Colli: ' + (s.colli || 1) + '    Peso: ' + (Number(s.peso_fatturato || s.peso_reale || 0)).toFixed(2).replace(/\.?0+$/, '') + ' kg', 20, 9); y -= 13
    if (Number(s.contrassegno) > 0) { testo('Contrassegno: € ' + Number(s.contrassegno).toFixed(2), 20, 10, true); y -= 13 }
  }

  for (const s of spedizioni || []) {
    // Riepilogo ordine (packing slip) prima delle etichette, se il cliente lo ha attivato.
    if (riepilogoCli.get(s.cliente_id)) {
      try { disegnaRiepilogo(s) } catch (e) { console.error('Errore riepilogo:', e) }
    }
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