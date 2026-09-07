import zlib from 'node:zlib'

// RISCRITTURA ETICHETTA Spedisci.online (come SpediamoPro). Sul PDF Poste/SDA il campo "Rif." in alto
// mostra un TOKEN interno generato da Spedisci/Poste (es. "GYz6HZEt1BT5RCPDdvixnKUmM"), NON il
// riferimento d'ordine del cliente — e non è pilotabile via API (il campo `reference` non compare in
// etichetta, verificato). Quel token NON è nemmeno nel raw_response, sta solo dentro il PDF. Nel content
// stream il campo è un unico testo `(Rif. <token>)Tj`: qui si sostituisce il token col rif_ordine
// dichiarato dal mittente. Il CONTENUTO invece esce già dal campo dedicato `content`, non serve toccarlo.
// I codici a barre (rettangoli, non testo) restano intatti. Ogni errore → PDF ORIGINALE (una LDV rotta
// blocca la spedizione, mai degradarla). Vedi [[etichetta-spedisci-rif-in-note]], lib/etichetta-spediamopro.

function escPdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export async function riscriviEtichettaSpedisci(pdf: Buffer, opts: { rifOrdine?: string | null }): Promise<Buffer> {
  const rif = String(opts.rifOrdine || '').trim()
  if (!rif) return pdf
  const nuovo = '(Rif. ' + escPdf(rif) + ')'
  try {
    const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib')
    const doc = await PDFDocument.load(new Uint8Array(pdf))
    const ctx: any = doc.context
    let cambiato = false
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue
      const dict: any = obj.dict
      const filter = dict.get(PDFName.of('Filter'))
      const isFlate = filter && String(filter).includes('FlateDecode')
      let decoded: Buffer
      try { decoded = isFlate ? zlib.inflateSync(Buffer.from(obj.contents)) : Buffer.from(obj.contents) } catch { continue }
      let str = decoded.toString('latin1')
      // "(Rif.<sep><token>)" → "(Rif. <rif_ordine>)". Dopo "Rif." c'è un NBSP (char 160), non uno spazio
      // normale: perciò NON si mette lo spazio nel pattern, si prende tutto fino a ")". Il token varia
      // per spedizione e non è nel raw_response, quindi ci si aggancia al pattern "(Rif.…)".
      if (!/\(Rif\.[^)]*\)/.test(str)) continue
      str = str.replace(/\(Rif\.[^)]*\)/g, () => nuovo)   // funzione: niente interpretazione di $ nel rif
      const nb = Buffer.from(str, 'latin1')
      dict.delete(PDFName.of('Filter'))
      dict.delete(PDFName.of('DecodeParms'))
      dict.set(PDFName.of('Length'), ctx.obj(nb.length))
      ctx.assign(ref, PDFRawStream.of(dict, new Uint8Array(nb)))
      cambiato = true
    }
    if (!cambiato) return pdf
    return Buffer.from(await doc.save())
  } catch (e: any) {
    console.error('[ETICHETTA][SPEDISCI] rewrite fallito, uso originale:', e?.message)
    return pdf
  }
}
