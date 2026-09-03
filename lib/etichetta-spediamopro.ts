import zlib from 'node:zlib'

// RISCRITTURA ETICHETTA SpediamoPro: sostituisce sul PDF i VALORI STANDARD del provider con i NOSTRI,
// dichiarati dal mittente su MoovExpress.
//   - il RIFERIMENTO: SpediamoPro stampa il SUO codice interno (raw_response.code, es. "6A99A817663D2",
//     come "Rif. ..."); lo sostituiamo col nostro rif_ordine (es. "131439"/"#1328").
//   - il CONTENUTO: SpediamoPro stampa "campionatura generica" (categoria generica); lo sostituiamo col
//     contenuto dichiarato (es. "PANTALONI LINO").
// L'etichetta e' un PDF di TESTO: i valori stanno nello stream (FlateDecode) come `(...)Tj`. Si
// decomprime lo stream, si fa find-and-replace, si riscrive lo stream NON compresso (Length aggiornata,
// Filter tolto) e pdf-lib risalva il PDF con xref corretto. I CODICI A BARRE (disegnati come rettangoli,
// non testo) restano intatti — verificato sul render. Ogni errore -> si ritorna il PDF ORIGINALE: una
// LDV rotta blocca la spedizione, quindi il rewrite non deve MAI degradare l'etichetta.

function escPdf(s: string): string {
  // dentro (...) di un PDF vanno protetti backslash e parentesi
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

const PLACEHOLDER_CONTENUTO = 'campionatura generica'

// Il codice SpediamoPro dalla raw_response (in chiaro; posizioni note viste in produzione).
export function codiceProviderSpediamopro(rawResponse: any): string | null {
  const r = rawResponse || {}
  return r.code || r?.data?.code || r?.raw?.data?.code || null
}

export async function riscriviEtichettaSpediamopro(
  pdf: Buffer,
  opts: { code?: string | null; rifOrdine?: string | null; contenuto?: string | null }
): Promise<Buffer> {
  const repl: [string, string][] = []
  const rif = String(opts.rifOrdine || '').trim()
  const cont = String(opts.contenuto || '').trim()
  const code = String(opts.code || '').trim()
  // Sostituisci il codice provider col nostro riferimento SOLO se abbiamo un riferimento e un codice noto.
  if (code && rif && code !== rif) repl.push([code, rif])
  // Sostituisci il placeholder "campionatura generica" col contenuto dichiarato.
  if (cont) repl.push([PLACEHOLDER_CONTENUTO, cont])
  if (!repl.length) return pdf

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
      let changed = false
      for (const [from, to] of repl) {
        if (from && str.includes(from)) { str = str.split(from).join(escPdf(to)); changed = true }
      }
      if (!changed) continue
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
    console.error('[ETICHETTA][SPEDIAMOPRO] rewrite fallito, uso originale:', e?.message)
    return pdf
  }
}
