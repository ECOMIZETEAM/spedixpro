import zlib from 'node:zlib'

// MITTENTE SULL'ETICHETTA BRT DIRETTA. BRT non stampa il mittente che gli mandiamo: nella casella
// mittente (la prima riga ruotata a destra) scrive l'intestatario del CONTO, preso dalla sua anagrafica.
// Sul contratto di Wave ship ogni pacco usciva con "WAVESHIP LLC EIN", anche quello di un suo cliente o
// del cliente di un suo sotto-master. Su richiesta di Wave (17/10/2026), e SOLO sui contratti con
// settings.etichetta_mittente_spedizione, quella riga si riscrive col mittente della spedizione: nome e
// provincia. Codice a barre, numeri e destinatario non si toccano (il codice a barre e' un oggetto a parte).
//
// Come si riconosce la casella: nel content stream ogni riga di destra e' un testo ruotato
// `0 1 -1 0 X Y Tm (TESTO)Tj`, e le righe hanno X crescente: mittente, destinatario, indirizzo, colli/peso.
// Si prende la prima colonna come mittente SOLO se la seconda contiene davvero il destinatario di questa
// spedizione: se BRT cambiasse impaginazione si lascerebbe l'etichetta com'e', invece di scrivere il nome
// nel posto sbagliato. Ogni errore → etichetta ORIGINALE: a questo punto la spedizione esiste gia' su BRT,
// e un'etichetta che salta bloccherebbe un pacco vero.

const RE_RIGA = /\/F\d+\s+([\d.]+)\s+Tf\s+0 1 -1 0 ([\d.]+) ([\d.]+) Tm\s*\(((?:[^()\\]|\\.)*)\)\s*Tj/g

type Riga = { size: number; x: number; y: number; testo: string; inizio: number; fine: number; apre: number }

function escPdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
// Il testo del PDF e' latin1 con Helvetica standard: accenti tolti, il resto fuori tabella scartato
// (stesso motivo di lib/etichetta-spedisci).
function soloLatin1(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '')
}
function chiave(s: string): string {
  return soloLatin1(s).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function mittenteEtichettaBrt(
  etichettaBase64: string,
  opts: { nome?: string | null; provincia?: string | null; destinatario?: string | null },
): Promise<string> {
  const nomeIn = soloLatin1(String(opts.nome || '')).replace(/\s+/g, ' ').trim().toUpperCase()
  const destChiave = chiave(String(opts.destinatario || '')).slice(0, 10)
  if (!nomeIn || !destChiave) return etichettaBase64
  const prov = soloLatin1(String(opts.provincia || '')).trim().toUpperCase().slice(0, 2)
  try {
    const { PDFDocument, PDFName, PDFRawStream, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.load(new Uint8Array(Buffer.from(etichettaBase64, 'base64')))
    // Il font serve solo a MISURARE il nome: lo si prende da un documento a parte, cosi' nell'etichetta
    // non si aggiunge nemmeno un oggetto.
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const ctx: any = doc.context
    // Un PDF multicollo unito ha una pagina-etichetta per collo: o si riconosce la casella su TUTTE,
    // o non si tocca nessuna (meta' colli con un nome e meta' con l'altro sarebbe peggio di prima).
    let candidati = 0
    let toccati = 0
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue
      const dict: any = obj.dict
      const isFlate = String(dict.get(PDFName.of('Filter')) || '').includes('FlateDecode')
      let str: string
      try { str = (isFlate ? zlib.inflateSync(Buffer.from(obj.contents)) : Buffer.from(obj.contents)).toString('latin1') } catch { continue }

      const righe: Riga[] = []
      for (const m of str.matchAll(RE_RIGA)) {
        const intero = m[0]
        const apre = intero.lastIndexOf('(' + m[4] + ')')
        righe.push({ size: Number(m[1]), x: Number(m[2]), y: Number(m[3]), testo: m[4], inizio: m.index!, fine: m.index! + intero.length, apre })
      }
      const colonne = [...new Set(righe.map(r => r.x))].sort((a, b) => a - b)
      if (colonne.length < 2) continue
      candidati++
      const mitt = righe.filter(r => r.x === colonne[0]).sort((a, b) => a.y - b.y)
      const dest = righe.filter(r => r.x === colonne[1]).sort((a, b) => a.y - b.y)
      if (!mitt.length || !dest.length || !chiave(dest[0].testo).startsWith(destChiave)) continue

      const rigaNome = mitt[0]
      // La provincia sta sulla stessa colonna, piu' in alto: e' il limite di spazio per il nome.
      const rigaProv = mitt.length > 1 && mitt[mitt.length - 1].testo.trim().length <= 3 ? mitt[mitt.length - 1] : null
      const spazio = rigaProv ? rigaProv.y - rigaNome.y - 4 : 118
      let nome = nomeIn
      while (nome.length > 4 && font.widthOfTextAtSize(nome, rigaNome.size || 7) > spazio) nome = nome.slice(0, -1).trimEnd()

      // Sostituzione per posizione, dalla fine all'inizio, cosi' gli indici restano validi.
      const cambi: Array<{ r: Riga; testo: string }> = [{ r: rigaNome, testo: nome }]
      if (rigaProv && prov) cambi.push({ r: rigaProv, testo: prov })
      cambi.sort((a, b) => b.r.inizio - a.r.inizio)
      for (const { r, testo } of cambi) {
        const pos = r.inizio + r.apre
        str = str.slice(0, pos) + '(' + escPdf(testo) + ')' + str.slice(pos + r.testo.length + 2)
      }
      const nb = zlib.deflateSync(Buffer.from(str, 'latin1'))
      dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
      dict.delete(PDFName.of('DecodeParms'))
      dict.set(PDFName.of('Length'), ctx.obj(nb.length))
      ctx.assign(ref, PDFRawStream.of(dict, new Uint8Array(nb)))
      toccati++
    }
    if (!toccati || toccati !== candidati) return etichettaBase64   // non riconosciuta (anche su una sola pagina): non si indovina
    return Buffer.from(await doc.save({ useObjectStreams: false })).toString('base64')
  } catch {
    return etichettaBase64
  }
}
