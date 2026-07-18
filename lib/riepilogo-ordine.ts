import { PDFDocument, rgb } from 'pdf-lib'

// Foglio A5 "RIEPILOGO ORDINE" (packing slip) con le caratteristiche di ogni prodotto.
// Condiviso tra la stampa MULTIPLA (etichette-bulk) e la SINGOLA (etichetta):
//   1) preparaRiepiloghi(admin, spedizioni) → carica impostazioni cliente + ordini + catalogo
//   2) disegnaRiepilogoSped(pdf, font, fontBold, ctx, s) → disegna UNA pagina se il cliente ha
//      impostazioni.stampa_riepilogo === 'si' (va chiamata PRIMA delle pagine etichetta della sped.)
//
// Le `spedizioni` devono includere: id, numero, created_at, rif_ordine, contenuto, colli,
// peso_reale, peso_fatturato, contrassegno, dest_nome, dest_indirizzo, dest_citta, dest_cap,
// dest_provincia, dest_paese, dest_telefono, mitt_nome, cliente_id, corrieri(nome_contratto).

export type RiepilogoCtx = {
  riepilogoCli: Map<string, boolean>
  nomeCli: Map<string, string>
  nascondiPrezziCli: Map<string, boolean>
  ordineDiSped: Map<string, { articoli: any[]; order_id: string | null; totale: number | null }>
  catalogo: Map<string, any>
}

export async function preparaRiepiloghi(admin: any, spedizioni: any[]): Promise<RiepilogoCtx> {
  const ctx: RiepilogoCtx = { riepilogoCli: new Map(), nomeCli: new Map(), nascondiPrezziCli: new Map(), ordineDiSped: new Map(), catalogo: new Map() }
  const cliIds = Array.from(new Set((spedizioni || []).map((s: any) => s.cliente_id).filter(Boolean)))
  if (!cliIds.length) return ctx

  const { data: cs } = await admin.from('clienti').select('id,ragione_sociale,impostazioni').in('id', cliIds)
  for (const c of (cs || [])) {
    ctx.riepilogoCli.set((c as any).id, ((c as any).impostazioni?.stampa_riepilogo) === 'si')
    ctx.nomeCli.set((c as any).id, (c as any).ragione_sociale || '')
    ctx.nascondiPrezziCli.set((c as any).id, ((c as any).impostazioni?.nascondi_prezzi) === true)
  }

  const spedRiepIds = (spedizioni || []).filter((s: any) => ctx.riepilogoCli.get(s.cliente_id)).map((s: any) => s.id)
  if (spedRiepIds.length) {
    const { data: oImp } = await admin.from('ordini_importati').select('spedizione_id,articoli,order_id,totale_ordine').in('spedizione_id', spedRiepIds)
    for (const o of (oImp || [])) if ((o as any).spedizione_id) ctx.ordineDiSped.set((o as any).spedizione_id, { articoli: Array.isArray((o as any).articoli) ? (o as any).articoli : [], order_id: (o as any).order_id || null, totale: (o as any).totale_ordine ?? null })
    const { data: oEc } = await admin.from('ordini_ecommerce').select('spedizione_id,articoli,numero_ordine,totale').in('spedizione_id', spedRiepIds)
    for (const o of (oEc || [])) if ((o as any).spedizione_id && !ctx.ordineDiSped.has((o as any).spedizione_id)) ctx.ordineDiSped.set((o as any).spedizione_id, { articoli: Array.isArray((o as any).articoli) ? (o as any).articoli : [], order_id: (o as any).numero_ordine || null, totale: (o as any).totale ?? null })
  }

  const { data: art } = await admin.from('articoli_cliente').select('cliente_id,sku,nome,peso,lunghezza,larghezza,altezza').in('cliente_id', cliIds)
  for (const a of (art || [])) if ((a as any).sku) ctx.catalogo.set((a as any).cliente_id + '|' + String((a as any).sku).trim().toLowerCase(), a)

  return ctx
}

// Disegna la pagina riepilogo per una spedizione (se il suo cliente lo ha attivato). Ritorna true se disegnata.
export function disegnaRiepilogoSped(pdf: PDFDocument, font: any, fontBold: any, ctx: RiepilogoCtx, s: any): boolean {
  if (!ctx.riepilogoCli.get(s.cliente_id)) return false
  const ord = ctx.ordineDiSped.get(s.id)
  const W = 420, H = 595 // A5
  const page = pdf.addPage([W, H])
  const nero = rgb(0.1, 0.1, 0.1), grigio = rgb(0.45, 0.45, 0.45), lineC = rgb(0.8, 0.8, 0.8)
  const ML = 28, MR = W - 28
  let y = H - 40
  const testo = (t: string, x: number, size = 9, bold = false, col = nero) => page.drawText(String(t ?? ''), { x, y, size, font: bold ? fontBold : font, color: col })
  const linea = () => page.drawLine({ start: { x: ML, y: y + 6 }, end: { x: MR, y: y + 6 }, thickness: 0.6, color: lineC })
  const clip = (t: string, max: number) => { t = String(t || ''); return t.length > max ? t.slice(0, max - 1) + '…' : t }

  testo('RIEPILOGO ORDINE', ML, 15, true); y -= 20
  const dt = s.created_at ? new Date(s.created_at) : null
  const dataOra = dt ? dt.toLocaleDateString('it-IT') + ' ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''
  if (ord?.order_id || s.rif_ordine) { testo('Ordine: ' + (ord?.order_id || s.rif_ordine), ML, 11, true); y -= 15 }
  testo('Data e ora: ' + dataOra, ML, 9, false, grigio); y -= 12
  testo('Corriere: ' + ((s.corrieri?.nome_contratto) || '—'), ML, 9, false, grigio); y -= 12
  testo('N. Spedizione: ' + (s.numero || ''), ML, 9, false, grigio); y -= 16
  linea(); y -= 12

  const colR = ML + 200
  const yStart = y
  testo('MITTENTE', ML, 8, true, grigio); testo('DESTINATARIO', colR, 8, true, grigio); y -= 12
  testo(clip(s.mitt_nome || ctx.nomeCli.get(s.cliente_id) || '', 32), ML, 9, true)
  testo(clip(s.dest_nome || '', 32), colR, 9, true); y -= 11
  testo(clip([s.dest_cap, s.dest_citta, s.dest_provincia && '(' + s.dest_provincia + ')'].filter(Boolean).join(' '), 34), colR, 8, false, grigio)
  y = yStart - 34
  linea(); y -= 14

  testo('Q.tà', ML, 8, true, grigio); testo('PRODOTTO', ML + 34, 8, true, grigio); testo('SKU', ML + 210, 8, true, grigio); testo('PESO', ML + 285, 8, true, grigio); testo('MISURE (cm)', ML + 320, 8, true, grigio)
  y -= 4; linea(); y -= 12
  const arts = ord?.articoli || []
  if (arts.length) {
    for (const a of arts) {
      const sku = a.sku ? String(a.sku).trim() : ''
      const cat = sku ? ctx.catalogo.get(s.cliente_id + '|' + sku.toLowerCase()) : null
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

  testo('Colli: ' + (s.colli || 1), ML, 9, true)
  testo('Peso spedizione: ' + (Number(s.peso_fatturato || s.peso_reale || 0)).toFixed(2).replace(/\.?0+$/, '') + ' kg', ML + 90, 9)
  const nascondiPrezzi = ctx.nascondiPrezziCli.get(s.cliente_id) === true
  // Il contrassegno resta sempre (è l'importo che il corriere incassa alla consegna).
  if (Number(s.contrassegno) > 0) { y -= 13; testo('Contrassegno: € ' + Number(s.contrassegno).toFixed(2), ML, 10, true) }
  // "Valore ordine" = valore merce dall'ordine importato. Nascosto se il cliente ha "Nascondi prezzi".
  else if (ord?.totale != null && !nascondiPrezzi) { y -= 13; testo('Valore ordine: € ' + Number(ord.totale).toFixed(2), ML, 9, false, grigio) }
  return true
}
