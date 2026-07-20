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
// Formato A4 ORIZZONTALE (842×595): più larghezza per lo SKU (niente taglio) e font più grandi, così
// in fase di stampa è ben leggibile (prima era A5 verticale con SKU troncato a 13 caratteri e testo 8-9pt).
export function disegnaRiepilogoSped(pdf: PDFDocument, font: any, fontBold: any, ctx: RiepilogoCtx, s: any): boolean {
  if (!ctx.riepilogoCli.get(s.cliente_id)) return false
  const ord = ctx.ordineDiSped.get(s.id)
  const W = 842, H = 595 // A4 orizzontale
  const page = pdf.addPage([W, H])
  const nero = rgb(0.1, 0.1, 0.1), grigio = rgb(0.4, 0.4, 0.4), lineC = rgb(0.78, 0.78, 0.78)
  const ML = 40, MR = W - 40
  let y = H - 50
  const testo = (t: string, x: number, size = 12, bold = false, col = nero) => page.drawText(String(t ?? ''), { x, y, size, font: bold ? fontBold : font, color: col })
  const linea = () => page.drawLine({ start: { x: ML, y: y + 7 }, end: { x: MR, y: y + 7 }, thickness: 0.7, color: lineC })
  const clip = (t: string, max: number) => { t = String(t || ''); return t.length > max ? t.slice(0, max - 1) + '…' : t }

  testo('RIEPILOGO ORDINE', ML, 22, true); y -= 28
  const dt = s.created_at ? new Date(s.created_at) : null
  const dataOra = dt ? dt.toLocaleDateString('it-IT') + ' ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''
  if (ord?.order_id || s.rif_ordine) { testo('Ordine: ' + (ord?.order_id || s.rif_ordine), ML, 16, true); y -= 22 }
  testo('Data e ora: ' + dataOra, ML, 12, false, grigio); y -= 17
  testo('Corriere: ' + ((s.corrieri?.nome_contratto) || '—'), ML, 12, false, grigio); y -= 17
  testo('N. Spedizione: ' + (s.numero || ''), ML, 12, false, grigio); y -= 22
  linea(); y -= 18

  const colR = ML + 400
  const yStart = y
  testo('MITTENTE', ML, 11, true, grigio); testo('DESTINATARIO', colR, 11, true, grigio); y -= 17
  testo(clip(s.mitt_nome || ctx.nomeCli.get(s.cliente_id) || '', 45), ML, 13, true)
  testo(clip(s.dest_nome || '', 45), colR, 13, true); y -= 15
  testo(clip([s.dest_cap, s.dest_citta, s.dest_provincia && '(' + s.dest_provincia + ')'].filter(Boolean).join(' '), 48), colR, 11, false, grigio)
  y = yStart - 46
  linea(); y -= 20

  // Colonne tabella (A4 orizzontale, 40..802): PRODOTTO ampio, SKU con ~30 caratteri, PESO, MISURE.
  const cProd = ML + 55, cSku = ML + 430, cPeso = ML + 630, cMis = ML + 710
  testo('Q.tà', ML, 11, true, grigio); testo('PRODOTTO', cProd, 11, true, grigio); testo('SKU', cSku, 11, true, grigio); testo('PESO', cPeso, 11, true, grigio); testo('MISURE (cm)', cMis, 11, true, grigio)
  y -= 6; linea(); y -= 18
  const arts = ord?.articoli || []
  if (arts.length) {
    for (const a of arts) {
      const sku = a.sku ? String(a.sku).trim() : ''
      const cat = sku ? ctx.catalogo.get(s.cliente_id + '|' + sku.toLowerCase()) : null
      const peso = (cat && Number(cat.peso) > 0) ? Number(cat.peso) : (Number(a.grammi) > 0 ? Number(a.grammi) / 1000 : 0)
      const dims = cat && (cat.lunghezza || cat.larghezza || cat.altezza) ? `${cat.lunghezza || '-'}x${cat.larghezza || '-'}x${cat.altezza || '-'}` : '—'
      testo(String(a.quantita || 1) + '×', ML, 12, true)
      testo(clip(a.nome || cat?.nome || sku, 52), cProd, 12)
      testo(clip(sku || '—', 30), cSku, 12, false, grigio)
      testo(peso > 0 ? peso.toFixed(2).replace(/\.?0+$/, '') + 'kg' : '—', cPeso, 11, false, grigio)
      testo(dims, cMis, 11, false, grigio)
      y -= 17
      if (a.variante) { testo(clip('  ' + a.variante, 60), cProd, 10, false, grigio); y -= 14 }
      if (y < 80) { testo('… (elenco troncato)', cProd, 11, false, grigio); y -= 16; break }
    }
  } else {
    testo(clip('Contenuto: ' + (s.contenuto || '—'), 90), ML, 12, false, grigio); y -= 17
  }
  y -= 8; linea(); y -= 20

  testo('Colli: ' + (s.colli || 1), ML, 12, true)
  testo('Peso spedizione: ' + (Number(s.peso_fatturato || s.peso_reale || 0)).toFixed(2).replace(/\.?0+$/, '') + ' kg', ML + 140, 12)
  const nascondiPrezzi = ctx.nascondiPrezziCli.get(s.cliente_id) === true
  // Il contrassegno resta sempre (è l'importo che il corriere incassa alla consegna).
  if (Number(s.contrassegno) > 0) { y -= 18; testo('Contrassegno: € ' + Number(s.contrassegno).toFixed(2), ML, 13, true) }
  // "Valore ordine" = valore merce dall'ordine importato. Nascosto se il cliente ha "Nascondi prezzi".
  else if (ord?.totale != null && !nascondiPrezzi) { y -= 18; testo('Valore ordine: € ' + Number(ord.totale).toFixed(2), ML, 12, false, grigio) }
  return true
}
