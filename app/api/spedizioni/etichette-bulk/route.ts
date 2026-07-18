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

  // ── Dati ordine (righe prodotto) per le spedizioni con riepilogo attivo ──
  const spedRiep = (spedizioni || []).filter((s: any) => riepilogoCli.get(s.cliente_id))
  const spedRiepIds = spedRiep.map((s: any) => s.id)
  const ordineDiSped = new Map<string, { articoli: any[]; order_id: string | null; totale: number | null }>()
  if (spedRiepIds.length) {
    // Ordini da file (ordini_importati) e da integrazioni (ordini_ecommerce)
    const { data: oImp } = await admin.from('ordini_importati').select('spedizione_id,articoli,order_id,totale_ordine,contenuto').in('spedizione_id', spedRiepIds)
    for (const o of (oImp || [])) if ((o as any).spedizione_id) ordineDiSped.set((o as any).spedizione_id, { articoli: Array.isArray((o as any).articoli) ? (o as any).articoli : [], order_id: (o as any).order_id || null, totale: (o as any).totale_ordine ?? null })
    const { data: oEc } = await admin.from('ordini_ecommerce').select('spedizione_id,articoli,numero_ordine,totale').in('spedizione_id', spedRiepIds)
    for (const o of (oEc || [])) if ((o as any).spedizione_id && !ordineDiSped.has((o as any).spedizione_id)) ordineDiSped.set((o as any).spedizione_id, { articoli: Array.isArray((o as any).articoli) ? (o as any).articoli : [], order_id: (o as any).numero_ordine || null, totale: (o as any).totale ?? null })
  }
  // Catalogo SKU dei clienti coinvolti (peso + misure per SKU) → arricchisce le righe prodotto
  const catalogo = new Map<string, any>()   // chiave: `${cliente_id}|${sku}`
  if (cliIds.length) {
    const { data: art } = await admin.from('articoli_cliente').select('cliente_id,sku,nome,peso,lunghezza,larghezza,altezza').in('cliente_id', cliIds)
    for (const a of (art || [])) if ((a as any).sku) catalogo.set((a as any).cliente_id + '|' + String((a as any).sku).trim().toLowerCase(), a)
  }

  const pdfMerged = await PDFDocument.create()
  const font = await pdfMerged.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfMerged.embedFont(StandardFonts.HelveticaBold)

  // Disegna un foglio A5 di RIEPILOGO ORDINE (packing slip) con le caratteristiche di ogni prodotto.
  const disegnaRiepilogo = (s: any) => {
    const W = 420, H = 595 // A5 in punti (~148x210mm)
    const page = pdfMerged.addPage([W, H])
    const nero = rgb(0.1, 0.1, 0.1), grigio = rgb(0.45, 0.45, 0.45), lineC = rgb(0.8, 0.8, 0.8)
    const ML = 28, MR = W - 28
    let y = H - 40
    const testo = (t: string, x: number, size = 9, bold = false, col = nero) => page.drawText(String(t ?? ''), { x, y, size, font: bold ? fontBold : font, color: col })
    const linea = () => { page.drawLine({ start: { x: ML, y: y + 6 }, end: { x: MR, y: y + 6 }, thickness: 0.6, color: lineC }) }
    const clip = (t: string, max: number) => { t = String(t || ''); return t.length > max ? t.slice(0, max - 1) + '…' : t }

    const ord = ordineDiSped.get(s.id)
    testo('RIEPILOGO ORDINE', ML, 15, true); y -= 20
    const dt = s.created_at ? new Date(s.created_at) : null
    const dataOra = dt ? dt.toLocaleDateString('it-IT') + ' ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''
    if (ord?.order_id || s.rif_ordine) { testo('Ordine: ' + (ord?.order_id || s.rif_ordine), ML, 11, true); y -= 15 }
    testo('Data e ora: ' + dataOra, ML, 9, false, grigio); y -= 12
    testo('Corriere: ' + ((s.corrieri?.nome_contratto) || '—'), ML, 9, false, grigio); y -= 12
    testo('N. Spedizione: ' + (s.numero || ''), ML, 9, false, grigio); y -= 16
    linea(); y -= 12

    // Mittente / Destinatario su due colonne
    const colR = ML + 200
    const yStart = y
    testo('MITTENTE', ML, 8, true, grigio); testo('DESTINATARIO', colR, 8, true, grigio); y -= 12
    testo(clip(s.mitt_nome || nomeCli.get(s.cliente_id) || '', 32), ML, 9, true)
    testo(clip(s.dest_nome || '', 32), colR, 9, true); y -= 11
    testo(clip([s.dest_cap, s.dest_citta, s.dest_provincia && '(' + s.dest_provincia + ')'].filter(Boolean).join(' '), 34), colR, 8, false, grigio)
    y = yStart - 34
    linea(); y -= 14

    // Tabella prodotti
    testo('Q.tà', ML, 8, true, grigio); testo('PRODOTTO', ML + 34, 8, true, grigio); testo('SKU', ML + 210, 8, true, grigio); testo('PESO', ML + 285, 8, true, grigio); testo('MISURE (cm)', ML + 320, 8, true, grigio)
    y -= 4; linea(); y -= 12
    const arts = ord?.articoli || []
    if (arts.length) {
      for (const a of arts) {
        const sku = a.sku ? String(a.sku).trim() : ''
        const cat = sku ? catalogo.get(s.cliente_id + '|' + sku.toLowerCase()) : null
        const peso = (cat && Number(cat.peso) > 0) ? Number(cat.peso) : (Number(a.grammi) > 0 ? Number(a.grammi) / 1000 : 0)
        const dims = cat && (cat.lunghezza || cat.larghezza || cat.altezza) ? `${cat.lunghezza || '-'}x${cat.larghezza || '-'}x${cat.altezza || '-'}` : '—'
        testo(String(a.quantita || 1) + '×', ML, 9)
        testo(clip(a.nome || cat?.nome || sku, 30), ML + 34, 9)
        testo(clip(sku || '—', 13), ML + 210, 8, false, grigio)
        testo(peso > 0 ? peso.toFixed(2).replace(/\.?0+$/, '') + 'kg' : '—', ML + 285, 8, false, grigio)
        testo(dims, ML + 320, 8, false, grigio)
        y -= 11
        if (a.variante) { testo(clip('  ' + a.variante, 40), ML + 34, 7.5, false, grigio); y -= 10 }
        if (y < 90) { testo('… (elenco troncato)', ML + 34, 8, false, grigio); y -= 12; break }
      }
    } else {
      testo(clip('Contenuto: ' + (s.contenuto || '—'), 60), ML, 9, false, grigio); y -= 12
    }
    y -= 6; linea(); y -= 14

    // Totali
    testo('Colli: ' + (s.colli || 1), ML, 9, true)
    testo('Peso spedizione: ' + (Number(s.peso_fatturato || s.peso_reale || 0)).toFixed(2).replace(/\.?0+$/, '') + ' kg', ML + 90, 9)
    if (Number(s.contrassegno) > 0) { y -= 13; testo('Contrassegno: € ' + Number(s.contrassegno).toFixed(2), ML, 10, true) }
    else if (ord?.totale != null) { y -= 13; testo('Totale ordine: € ' + Number(ord.totale).toFixed(2), ML, 9, false, grigio) }
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