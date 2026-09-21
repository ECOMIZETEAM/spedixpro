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

// IL NOME IN ALTO A SINISTRA E' QUELLO DELL'INTESTATARIO DEL CONTO DEL FORNITORE.
// Sull'etichetta GLS il fornitore sovrappone al PDF originale un rettangolo BIANCO che copre la
// casella del mittente e ci scrive la ragione sociale del SUO conto: misurato il 21/09/2026, le
// etichette di sei master diversi (QUICK SRL, spedizioni 2000, GX SPEDIZIONI, GTS EXPRESS, SEMPLICE
// SPEDIRE, VERDE DOMENICO) uscivano tutte con "E&A MULTI EXPRESS SRLS" — il nome di un'altra
// azienda della rete, stampato sul pacco del cliente di un altro master. Qui si riscrive quel testo
// col nome del MASTER della spedizione, lasciando intatti riquadro, posizione e resto dell'etichetta.
// Su Poste e SDA quel riquadro non c'e' (verificato): il pattern non trova nulla e il PDF esce uguale.
const RE_MITTENTE = /(1\.000 1\.000 1\.000 rg[\s\S]{0,200}?BT\s+[\d.]+\s+[\d.]+\s+Td\s*\()([^)]*)(\)\s*Tj)/

// Il testo del PDF e' scritto in latin1: accenti e simboli fuori tabella lo corromperebbero (e' lo
// stesso difetto che sull'etichetta fa uscire "1Ã—" invece di "1×"). Si tolgono gli accenti e si
// scarta il resto, cosi' il nome resta leggibile qualunque cosa contenga.
function soloLatin1(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '')
}

export async function riscriviEtichettaSpedisci(pdf: Buffer, opts: { rifOrdine?: string | null; mittente?: string | null }): Promise<Buffer> {
  const rif = String(opts.rifOrdine || '').trim()
  let mittente = soloLatin1(String(opts.mittente || '').trim())
  if (!rif && !mittente) return pdf
  const nuovo = '(Rif. ' + escPdf(rif) + ')'
  try {
    const { PDFDocument, PDFName, PDFRawStream, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.load(new Uint8Array(pdf))
    // IL NOME DEVE STARE DENTRO IL RIQUADRO BIANCO (~141 punti di larghezza, testo a 8pt): un nome
    // lungo come "DITTA INDIVIDUALE VERDE DOMENICO" uscirebbe dal riquadro e finirebbe sopra il
    // codice a barre. Si misura davvero col font dell'etichetta e si accorcia solo se serve.
    if (mittente) {
      try {
        const f = await doc.embedFont(StandardFonts.Helvetica)
        while (mittente.length > 4 && f.widthOfTextAtSize(mittente, 8) > 138) mittente = mittente.slice(0, -1)
      } catch { mittente = mittente.substring(0, 26) }
    }
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
      let tocco = false
      // "(Rif.<sep><token>)" → "(Rif. <rif_ordine>)". Dopo "Rif." c'è un NBSP (char 160), non uno spazio
      // normale: perciò NON si mette lo spazio nel pattern, si prende tutto fino a ")". Il token varia
      // per spedizione e non è nel raw_response, quindi ci si aggancia al pattern "(Rif.…)".
      if (rif && /\(Rif\.[^)]*\)/.test(str)) {
        str = str.replace(/\(Rif\.[^)]*\)/g, () => nuovo)   // funzione: niente interpretazione di $ nel rif
        tocco = true
      }
      if (mittente && RE_MITTENTE.test(str)) {
        str = str.replace(RE_MITTENTE, (_intero, prima, _vecchio, dopo) => prima + escPdf(mittente) + dopo)
        tocco = true
      }
      if (!tocco) continue
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
