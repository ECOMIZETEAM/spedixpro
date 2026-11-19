import { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib'

// ETICHETTE UPS: DA IMMAGINE A PDF VERTICALE 10x15.
//
// UPS (Europa e Italia, via SpediamoPro) non da' un PDF ma una GIF 1400x800, in bianco e nero, con
// l'etichetta 4x6 pollici GIRATA di 90 gradi (il testo si legge dal basso verso l'alto) e una
// striscia vuota di 200 pixel. Servita cosi', ogni porta la stampava male: la singola usciva di
// traverso e piccola sul rotolo 10x15 (foto di Atlantik srl, 28/10, 1ZGE70566818291248), la stampa
// in blocco dava "ETICHETTA NON DISPONIBILE" (prova ad aprire un PDF), la Zebra la disegnava
// orizzontale. Il multicollo arriva come ZIP con una GIF per collo, e il cliente scaricava uno .zip.
//
// Qui la si raddrizza: rotazione oraria, via la striscia vuota, una pagina 4x6 pollici per collo.
// La GIF e' a 200 punti per pollice e la pagina e' 4x6: un pixel resta un punto, niente
// ricampionamento che sporchi le barre. Il file originale su Storage resta com'era: la conversione
// avviene alla lettura (lib/etichette), dove passano tutte le porte.

const PAGINA_W = 288   // 4 pollici in punti PDF
const PAGINA_H = 432   // 6 pollici

type Bitmap = { w: number; h: number; nero: Uint8Array }   // nero[y*w+x] = 1 se il pixel e' scuro

export function eGif(b: Uint8Array): boolean {
  return b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38   // 'GIF8'
}
export function eZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}
function ePdf(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46   // '%PDF'
}

// Etichetta in PDF se arriva come GIF o come ZIP di GIF/PDF (il multicollo UPS); altrimenti null, e chi
// chiama tiene i byte che aveva. Su qualunque errore null: meglio la GIF storta che nessuna etichetta.
export async function etichettaImmagineInPdf(buf: Uint8Array): Promise<Buffer | null> {
  try {
    if (eGif(buf)) {
      const bmp = decodificaGif(buf)
      if (!bmp) return null
      const pdf = await PDFDocument.create()
      aggiungiPagina(pdf, bmp)
      return Buffer.from(await pdf.save())
    }
    if (eZip(buf)) {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buf)
      // In ordine di nome: SpediamoPro li chiama <codice>_0.gif, <codice>_1.gif... = ordine dei colli.
      const nomi = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      const pdf = await PDFDocument.create()
      for (const n of nomi) {
        const b = new Uint8Array(await zip.files[n].async('uint8array'))
        if (eGif(b)) { const bmp = decodificaGif(b); if (bmp) aggiungiPagina(pdf, bmp) }
        else if (ePdf(b)) { const src = await PDFDocument.load(b); (await pdf.copyPages(src, src.getPageIndices())).forEach(p => pdf.addPage(p)) }
      }
      return pdf.getPageCount() ? Buffer.from(await pdf.save()) : null
    }
  } catch (e: any) {
    console.error('[ETICHETTA-IMMAGINE] conversione fallita, resta il file originale:', e?.message)
  }
  return null
}

// Una pagina 4x6 con l'etichetta dritta. Se l'immagine e' orizzontale e' l'etichetta UPS girata: la si
// ruota in senso orario. Poi si taglia in fondo il vuoto oltre la proporzione 4x6, senza mai tagliare
// un pixel scuro: se il disegno andasse oltre, la pagina lo contiene tutto, rimpicciolito.
function aggiungiPagina(pdf: PDFDocument, src: Bitmap) {
  const bmp = src.w > src.h ? ruotaOraria(src) : src
  let ultimaScura = -1
  for (let y = bmp.h - 1; y >= 0 && ultimaScura < 0; y--) {
    for (let x = 0; x < bmp.w; x++) if (bmp.nero[y * bmp.w + x]) { ultimaScura = y; break }
  }
  const h = Math.min(bmp.h, Math.max(ultimaScura + 1, Math.round(bmp.w * PAGINA_H / PAGINA_W)))

  // Immagine a 1 bit (DeviceGray: 0 nero, 1 bianco), righe allineate al byte.
  const perRiga = Math.ceil(bmp.w / 8)
  const bit = new Uint8Array(perRiga * h).fill(0xff)
  for (let y = 0; y < h; y++) for (let x = 0; x < bmp.w; x++) {
    if (bmp.nero[y * bmp.w + x]) bit[y * perRiga + (x >> 3)] &= ~(0x80 >> (x & 7))
  }
  const ref = pdf.context.register(pdf.context.flateStream(bit, {
    Type: 'XObject', Subtype: 'Image', Width: bmp.w, Height: h,
    ColorSpace: 'DeviceGray', BitsPerComponent: 1, Interpolate: false,
  }))
  const page = pdf.addPage([PAGINA_W, PAGINA_H])
  const nome = page.node.newXObject('Etichetta', ref)
  const scala = Math.min(PAGINA_W / bmp.w, PAGINA_H / h)
  const lw = bmp.w * scala, lh = h * scala
  // In alto e centrata: e' dove sta su un'etichetta stampata dal corriere.
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(lw, 0, 0, lh, (PAGINA_W - lw) / 2, PAGINA_H - lh),
    drawObject(nome),
    popGraphicsState(),
  )
}

function ruotaOraria(b: Bitmap): Bitmap {
  // Dopo la rotazione oraria il punto (x, y) dell'originale va in (h-1-y, x).
  const w = b.h, h = b.w
  const nero = new Uint8Array(w * h)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (b.nero[y * b.w + x]) nero[x * w + (b.h - 1 - y)] = 1
  }
  return { w, h, nero }
}

// Decodifica GIF (primo fotogramma). Serve solo questo: le etichette sono un'immagine sola, e in
// node_modules non c'e' un decodificatore GIF tra le dipendenze dichiarate.
function decodificaGif(b: Uint8Array): Bitmap | null {
  if (!eGif(b)) return null
  const u16 = (p: number) => b[p] | (b[p + 1] << 8)
  const w = u16(6), h = u16(8), flag = b[10]
  let p = 13
  let tavolozza: Uint8Array | null = null
  if (flag & 0x80) { const n = 3 * (1 << ((flag & 7) + 1)); tavolozza = b.subarray(p, p + n); p += n }
  let trasparente = -1
  while (p < b.length) {
    const blocco = b[p++]
    if (blocco === 0x21) {                       // estensione: si legge solo la trasparenza
      const tipo = b[p++]
      if (tipo === 0xf9 && b[p] >= 4 && (b[p + 1] & 1)) trasparente = b[p + 4]
      while (p < b.length && b[p] !== 0) p += b[p] + 1
      p++
    } else if (blocco === 0x2c) {                // immagine
      const ix = u16(p), iy = u16(p + 2), iw = u16(p + 4), ih = u16(p + 6), f = b[p + 8]
      p += 9
      let tav = tavolozza
      if (f & 0x80) { const n = 3 * (1 << ((f & 7) + 1)); tav = b.subarray(p, p + n); p += n }
      if (!tav) return null
      const minimo = b[p++]
      const pezzi: Uint8Array[] = []
      let tot = 0
      while (p < b.length && b[p] !== 0) { const n = b[p]; pezzi.push(b.subarray(p + 1, p + 1 + n)); tot += n; p += n + 1 }
      const dati = new Uint8Array(tot)
      let o = 0
      for (const x of pezzi) { dati.set(x, o); o += x.length }
      const indici = lzw(dati, minimo, iw * ih)
      // Scuro = luminanza sotto meta'. Il trasparente e' carta: bianco.
      const scuro = new Uint8Array(256)
      for (let i = 0; i < tav.length / 3; i++) {
        scuro[i] = i !== trasparente && (tav[i * 3] * 0.299 + tav[i * 3 + 1] * 0.587 + tav[i * 3 + 2] * 0.114) < 128 ? 1 : 0
      }
      const righe = (f & 0x40) ? righeInterlacciate(ih) : null
      const nero = new Uint8Array(w * h)
      for (let r = 0; r < ih; r++) {
        const y = iy + (righe ? righe[r] : r)
        if (y >= h) continue
        for (let x = 0; x < iw; x++) {
          if (ix + x < w && scuro[indici[r * iw + x]]) nero[y * w + ix + x] = 1
        }
      }
      return { w, h, nero }
    } else {
      return null                                // fine file (0x3b) o blocco sconosciuto senza immagine
    }
  }
  return null
}

function righeInterlacciate(h: number): number[] {
  const righe: number[] = []
  for (const [inizio, passo] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = inizio; y < h; y += passo) righe.push(y)
  return righe
}

function lzw(dati: Uint8Array, minimo: number, n: number): Uint8Array {
  const out = new Uint8Array(n)
  const clear = 1 << minimo, fine = clear + 1
  const prefisso = new Int32Array(4096), suffisso = new Uint8Array(4096), primo = new Uint8Array(4096)
  for (let i = 0; i < clear; i++) { prefisso[i] = -1; suffisso[i] = i; primo[i] = i }
  const pila = new Uint8Array(4097)
  let dim = minimo + 1, maschera = (1 << dim) - 1, prossimo = fine + 1
  let prec = -1, acc = 0, bits = 0, pos = 0, op = 0
  while (op < n) {
    while (bits < dim) { if (pos >= dati.length) return out; acc |= dati[pos++] << bits; bits += 8 }
    const codice = acc & maschera
    acc >>>= dim; bits -= dim
    if (codice === clear) { dim = minimo + 1; maschera = (1 << dim) - 1; prossimo = fine + 1; prec = -1; continue }
    if (codice === fine) break
    if (prec === -1) { out[op++] = suffisso[codice]; prec = codice; continue }
    // Primo carattere della stringa di questo codice; il codice non ancora in tabella e' il caso
    // "KwKwK": la stringa precedente piu' il suo stesso primo carattere.
    const k = codice < prossimo ? primo[codice] : primo[prec]
    let c = codice, sp = 0
    if (codice >= prossimo) { pila[sp++] = k; c = prec }
    while (c >= clear) { pila[sp++] = suffisso[c]; c = prefisso[c] }
    pila[sp++] = c
    while (sp > 0 && op < n) out[op++] = pila[--sp]
    if (prossimo < 4096) {
      prefisso[prossimo] = prec; suffisso[prossimo] = k; primo[prossimo] = primo[prec]
      prossimo++
      if (prossimo > maschera && dim < 12) { dim++; maschera = (1 << dim) - 1 }
    }
    prec = codice
  }
  return out
}
