import zlib from 'node:zlib'

// MITTENTE SULL'ETICHETTA GLS DIRETTA. Il PDF di GLS (PDFsharp) apre col nome dell'intestatario del
// conto — su Wave ship "Waveship Llc" — anche sul pacco di un suo cliente. Sui contratti con
// settings.etichetta_mittente_spedizione (vedi lib/etichetta-mittente) quel nome diventa il mittente
// della spedizione.
//
// NON si cambia il testo e basta, come sul BRT: GLS incorpora i font A PEZZI (solo le lettere che
// quell'etichetta usa), quindi un nome nuovo uscirebbe con lettere mancanti. La riga si riscrive con un
// font standard (Times-Bold, lo stesso disegno del Times New Roman Bold di GLS) nello stesso punto e
// alla stessa dimensione, rimpicciolendo solo se il nome non entra prima del peso; subito dopo si
// rimette il font di GLS, cosi' il resto della pagina non cambia di un punto.
//
// Come si riconosce la casella: e' il PRIMO testo della pagina e quello dopo e' "KG."; in piu' la pagina
// deve contenere il destinatario di questa spedizione. Se manca anche una sola delle tre cose (o su una
// sola pagina di un multicollo) l'etichetta resta quella di GLS. Ogni errore → etichetta ORIGINALE:
// la spedizione esiste gia' su GLS, un'etichetta che salta bloccherebbe un pacco vero.

const RE_TJ = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g
const RE_PRIMA = /\/(\S+)\s+([\d.]+)\s+Tf\s+([-\d.]+)\s+([-\d.]+)\s+Td\s*$/

function escPdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
function soloLatin1(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '')
}
// Il nome si scrive in Times-Bold standard, codifica WinAnsi: le lettere accentate (à è é ì ò ù…) ci
// sono e restano; quello che la tabella non ha si traslittera, il resto si scarta.
function perWinAnsi(s: string): string {
  return [...s.normalize('NFC')].map(c => {
    const n = c.charCodeAt(0)
    return (n >= 0x20 && n <= 0x7e) || (n >= 0xc0 && n <= 0xff) ? c : soloLatin1(c)
  }).join('')
}
function chiave(s: string): string {
  return soloLatin1(s).toUpperCase().replace(/[^A-Z0-9]/g, '')
}
// GLS stampa il destinatario a modo suo: lo manda A CAPO se e' lungo ("F.LLI FORTI" / "ABBIGLIAMENTO")
// e TOGLIE le lettere accentate ("Nicolò" → "Nicol", "Mövenpick" → "Mvenpick"). Per riconoscerlo si
// cerca nel testo della pagina unito, sia togliendo gli accenti come GLS sia traslitterandoli.
function chiaveSenzaAccentate(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
function contieneDestinatario(testi: string[], destinatario: string): boolean {
  const k1 = chiaveSenzaAccentate(destinatario).slice(0, 10)
  const k2 = chiave(destinatario).slice(0, 10)
  const h1 = testi.map(chiaveSenzaAccentate).join('')
  const h2 = testi.map(chiave).join('')
  return (k1.length >= 4 && h1.includes(k1)) || (k2.length >= 4 && h2.includes(k2))
}

export async function mittenteEtichettaGls(
  etichettaBase64: string,
  opts: { nome?: string | null; destinatario?: string | null },
): Promise<string> {
  const nomeIn = perWinAnsi(String(opts.nome || '')).replace(/\s+/g, ' ').trim()
  const destinatario = String(opts.destinatario || '')
  if (!nomeIn || chiave(destinatario).length < 4) return etichettaBase64
  try {
    const { PDFDocument, PDFName, PDFRawStream, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.load(new Uint8Array(Buffer.from(etichettaBase64, 'base64')))
    const font = await doc.embedFont(StandardFonts.TimesRomanBold)
    const ctx: any = doc.context
    const pagine = doc.getPages()
    if (!pagine.length) return etichettaBase64

    for (const pagina of pagine) {
      // La pagina GLS ha due flussi: lo SFONDO fisso (riquadri, logo, immagini, nessun testo) e quello coi
      // testi, che apre col mittente. Si lavora su quello coi testi; se fossero piu' d'uno non si indovina.
      const cont: any = pagina.node.Contents()
      const refs: any[] = cont?.asArray ? cont.asArray() : [pagina.node.get(PDFName.of('Contents'))]
      const conTesto: Array<{ ref: any; dict: any; str: string }> = []
      for (const r of refs) {
        const o = ctx.lookup(r)
        if (!(o instanceof PDFRawStream)) return etichettaBase64
        const flate = String(o.dict.get(PDFName.of('Filter')) || '').includes('FlateDecode')
        const s = (flate ? zlib.inflateSync(Buffer.from(o.contents)) : Buffer.from(o.contents)).toString('latin1')
        if (/\)\s*Tj/.test(s)) conTesto.push({ ref: r, dict: o.dict, str: s })
      }
      if (conTesto.length !== 1) return etichettaBase64
      const { ref, dict } = conTesto[0]
      let str = conTesto[0].str

      const tjs = [...str.matchAll(RE_TJ)]
      if (tjs.length < 2 || tjs[1][1] !== 'KG.') return etichettaBase64
      // il destinatario si cerca nei testi DOPO il mittente, mai nel mittente stesso
      if (!contieneDestinatario(tjs.slice(1).map(t => t[1]), destinatario)) return etichettaBase64
      const primo = tjs[0]
      const prima = RE_PRIMA.exec(str.slice(0, primo.index))
      if (!prima) return etichettaBase64
      const [, fontGls, sizeTxt, xTxt, yTxt] = prima
      const size = Number(sizeTxt)
      // Spazio fino al peso: e' lo spostamento orizzontale del "KG." che segue (es. "146 2 Td"), meno un
      // margine: prima del KG. c'e' la riga verticale del riquadro, e il nome non deve toccarla.
      const traKg = str.slice(primo.index! + primo[0].length, tjs[1].index)
      const xKg = Number((/([-\d.]+)\s+[-\d.]+\s+Td/.exec(traKg) || [])[1])
      const spazio = (Number.isFinite(xKg) && xKg > 20 ? xKg : 140) - 12

      let nome = nomeIn
      let dim = size
      while (dim > Math.max(8, size * 0.6) && font.widthOfTextAtSize(nome, dim) > spazio) dim = Math.round((dim - 0.5) * 2) / 2
      while (nome.length > 4 && font.widthOfTextAtSize(nome, dim) > spazio) nome = nome.slice(0, -1).trimEnd()

      // Il font si aggiunge all'elenco della pagina a mano: newFontDictionary di pdf-lib "normalizza" la
      // pagina e le avvolge il contenuto in due flussi q/Q in piu'. Innocui, ma la pagina deve restare
      // quella di GLS.
      const fonts: any = (pagina.node.Resources() as any)?.lookup(PDFName.of('Font'))
      if (!fonts || typeof fonts.set !== 'function') return etichettaBase64
      let tag = 'FMitt'
      for (let n = 1; fonts.has(PDFName.of(tag)); n++) tag = 'FMitt' + n
      fonts.set(PDFName.of(tag), font.ref)
      const inizio = primo.index! - prima[0].length
      const nuovo = `/${tag} ${dim} Tf\n${xTxt} ${yTxt} Td (${escPdf(nome)}) Tj\n/${fontGls} ${sizeTxt} Tf\n`
      str = str.slice(0, inizio) + nuovo + str.slice(primo.index! + primo[0].length)

      const nb = zlib.deflateSync(Buffer.from(str, 'latin1'))
      dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
      dict.delete(PDFName.of('DecodeParms'))
      dict.set(PDFName.of('Length'), ctx.obj(nb.length))
      ctx.assign(ref, PDFRawStream.of(dict, new Uint8Array(nb)))
    }
    return Buffer.from(await doc.save({ useObjectStreams: false })).toString('base64')
  } catch {
    return etichettaBase64
  }
}
