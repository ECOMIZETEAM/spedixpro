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
// Formato ETICHETTA 4×6 (283×425 pt, come le LDV di questo gestore): prima era un A4 orizzontale che,
// mandato all'etichettatrice 4×6, veniva SCALATO e TAGLIATO, con le righe sopra al testo. Ora è nativo
// 4×6, il testo VA A CAPO (niente più troncamenti) e le righe separatrici stanno SOTTO il testo con un
// margine. Se l'ordine ha molti articoli si aggiunge una seconda pagina 4×6 invece di tagliare l'elenco.
export function disegnaRiepilogoSped(pdf: PDFDocument, font: any, fontBold: any, ctx: RiepilogoCtx, s: any): boolean {
  if (!ctx.riepilogoCli.get(s.cliente_id)) return false
  const ord = ctx.ordineDiSped.get(s.id)
  const W = 283, H = 425 // etichetta 4×6
  const nero = rgb(0.1, 0.1, 0.1), grigio = rgb(0.35, 0.35, 0.35), lineC = rgb(0.8, 0.8, 0.8)
  const ML = 14, MR = W - 14, usable = MR - ML
  let page = pdf.addPage([W, H])
  let y = H - 20
  const nuovaPagina = () => { page = pdf.addPage([W, H]); y = H - 20 }
  const spazio = (h: number) => { if (y - h < 14) nuovaPagina() }
  const fontOf = (bold: boolean) => (bold ? fontBold : font)
  // A capo su larghezza reale (misurata col font), così nessun testo viene tagliato.
  const aCapo = (t: string, size: number, bold: boolean, maxW: number): string[] => {
    const f = fontOf(bold); const parole = String(t ?? '').split(/\s+/).filter(Boolean); const out: string[] = []
    let cur = ''
    for (const w of parole) {
      const prova = cur ? cur + ' ' + w : w
      if (f.widthOfTextAtSize(prova, size) <= maxW || !cur) cur = prova
      else { out.push(cur); cur = w }
    }
    if (cur) out.push(cur)
    return out.length ? out : ['']
  }
  // Riga di testo che avanza y (una riga sola).
  const riga = (t: string, size: number, bold = false, col = nero, x = ML) => { spazio(size + 3); page.drawText(String(t ?? ''), { x, y, size, font: fontOf(bold), color: col }); y -= size + 3 }
  // Paragrafo con a capo (più righe).
  const paragrafo = (t: string, size: number, bold = false, col = nero, x = ML, maxW = usable) => { for (const ln of aCapo(t, size, bold, maxW)) { spazio(size + 2); page.drawText(ln, { x, y, size, font: fontOf(bold), color: col }); y -= size + 2 } }
  // Separatore SOTTO il testo, con margine (mai sopra le lettere).
  const sep = () => { spazio(7); y -= 3; page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.6, color: lineC }); y -= 6 }

  riga('RIEPILOGO ORDINE', 13, true)
  const dt = s.created_at ? new Date(s.created_at) : null
  const dataOra = dt ? dt.toLocaleDateString('it-IT') + ' ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''
  if (ord?.order_id || s.rif_ordine) paragrafo('Ordine: ' + (ord?.order_id || s.rif_ordine), 10, true)
  riga('Data: ' + dataOra, 8, false, grigio)
  paragrafo('Corriere: ' + ((s.corrieri?.nome_contratto) || '—'), 8, false, grigio)
  riga('N. Spedizione: ' + (s.numero || ''), 9, true)
  sep()

  riga('MITTENTE', 7, true, grigio)
  paragrafo(s.mitt_nome || ctx.nomeCli.get(s.cliente_id) || '', 9, true)
  y -= 3
  riga('DESTINATARIO', 7, true, grigio)
  paragrafo(s.dest_nome || '', 9, true)
  const dest2 = [s.dest_indirizzo, [s.dest_cap, s.dest_citta, s.dest_provincia && '(' + s.dest_provincia + ')'].filter(Boolean).join(' ')].filter(Boolean).join(' — ')
  if (dest2) paragrafo(dest2, 8, false, grigio)
  sep()

  const arts = ord?.articoli || []
  if (arts.length) {
    riga('PRODOTTI', 7, true, grigio)
    for (const a of arts) {
      const sku = a.sku ? String(a.sku).trim() : ''
      const cat = sku ? ctx.catalogo.get(s.cliente_id + '|' + sku.toLowerCase()) : null
      const peso = (cat && Number(cat.peso) > 0) ? Number(cat.peso) : (Number(a.grammi) > 0 ? Number(a.grammi) / 1000 : 0)
      const dims = cat && (cat.lunghezza || cat.larghezza || cat.altezza) ? `${cat.lunghezza || '-'}x${cat.larghezza || '-'}x${cat.altezza || '-'} cm` : ''
      // Nome prodotto INTERO, a capo su più righe: niente più "…" che taglia.
      paragrafo(String(a.quantita || 1) + '× ' + (a.nome || cat?.nome || sku || '—'), 9, false, nero)
      if (a.variante) paragrafo(a.variante, 7.5, false, grigio, ML + 10, usable - 10)
      const meta = [sku ? 'SKU ' + sku : '', peso > 0 ? peso.toFixed(2).replace(/\.?0+$/, '') + 'kg' : '', dims].filter(Boolean).join('   ·   ')
      if (meta) paragrafo(meta, 7.5, false, grigio, ML + 10, usable - 10)
      y -= 3
    }
  } else {
    paragrafo('Contenuto: ' + (s.contenuto || '—'), 9, false, grigio)
  }
  sep()

  riga('Colli: ' + (s.colli || 1) + '     Peso: ' + (Number(s.peso_fatturato || s.peso_reale || 0)).toFixed(2).replace(/\.?0+$/, '') + ' kg', 9, true)
  const nascondiPrezzi = ctx.nascondiPrezziCli.get(s.cliente_id) === true
  // Il contrassegno resta sempre (è l'importo che il corriere incassa alla consegna).
  if (Number(s.contrassegno) > 0) riga('Contrassegno: € ' + Number(s.contrassegno).toFixed(2), 10, true)
  // "Valore ordine" = valore merce dall'ordine importato. Nascosto se il cliente ha "Nascondi prezzi".
  else if (ord?.totale != null && !nascondiPrezzi) riga('Valore ordine: € ' + Number(ord.totale).toFixed(2), 8, false, grigio)
  return true
}
