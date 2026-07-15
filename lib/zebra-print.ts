'use client'
// Stampa etichetta su Zebra tramite ZEBRA BROWSER PRINT (agente locale ufficiale Zebra).
// Il click stampa SUBITO sulla stampante predefinita. Poiché i corrieri danno il PDF, converto
// il PDF in ZPL (grafica ^GF) nel browser con pdf.js. Il barcode resta scansionabile (stessa immagine).
// Requisito: Zebra Browser Print installato e avviato sul PC di chi stampa.

let workerSet = false
async function loadPdfjs(): Promise<any> {
  const pdfjs: any = await import('pdfjs-dist')
  if (!workerSet) { pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'; workerSet = true }
  return pdfjs
}

const HEX = '0123456789ABCDEF'
function imageDataToZpl(data: Uint8ClampedArray, w: number, h: number): string {
  const bytesPerRow = Math.ceil(w / 8)
  const total = bytesPerRow * h
  const bytes = new Uint8Array(total)
  for (let y = 0; y < h; y++) {
    const rowOff = y * bytesPerRow
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      const lum = a < 16 ? 255 : (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      if (lum < 128) bytes[rowOff + (x >> 3)] |= (0x80 >> (x & 7))   // 1 = nero
    }
  }
  let hex = ''
  for (let i = 0; i < total; i++) { const b = bytes[i]; hex += HEX[b >> 4] + HEX[b & 15] }
  return `^XA^PW${w}^LH0,0^FO0,0^GFA,${total},${total},${bytesPerRow},${hex}^FS^XZ`
}

// PDF -> ZPL (una etichetta ^XA...^XZ per pagina), renderizzato alla dpi della stampante.
async function pdfToZpl(pdfData: ArrayBuffer, dpi: number): Promise<string> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfData) }).promise
  const scale = dpi / 72
  let out = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale })
    const w = Math.round(viewport.width), h = Math.round(viewport.height)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    await page.render({ canvasContext: ctx, viewport }).promise
    out += imageDataToZpl(ctx.getImageData(0, 0, w, h).data, w, h)
  }
  return out
}

// Immagine (GIF/PNG) -> ZPL
async function imageToZpl(blob: Blob, dpi: number): Promise<string> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url })
    const w = img.naturalWidth, h = img.naturalHeight
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0)
    return imageDataToZpl(ctx.getImageData(0, 0, w, h).data, w, h)
  } finally { URL.revokeObjectURL(url) }
}

// ── Zebra Browser Print (agente locale) ──
async function bpFetch(path: string, init?: RequestInit): Promise<Response> {
  // v3 su HTTPS (9101), v2 su HTTP (9100). Provo in ordine; il primo che risponde vince.
  const bases = ['https://localhost:9101', 'http://localhost:9100', 'http://127.0.0.1:9100']
  let lastErr: any = null
  for (const b of bases) {
    try { return await fetch(b + path, init) } catch (e) { lastErr = e }
  }
  throw new Error('Zebra Browser Print non raggiungibile: installalo e avvialo, poi riprova.')
}

async function getStampante(): Promise<any> {
  const r = await bpFetch('/default?type=printer')
  const txt = await r.text()
  if (!r.ok || !txt) throw new Error('Nessuna stampante Zebra predefinita in Browser Print.')
  try { return JSON.parse(txt) } catch { return { name: txt.trim(), uid: txt.trim(), connection: 'driver', deviceType: 'printer', version: 0, provider: 'com.zebra.ds.webdriver.desktop.provider.DefaultDeviceProvider', manufacturer: 'Zebra Technologies' } }
}

async function inviaZpl(zpl: string, device?: any): Promise<void> {
  const dev = device || await getStampante()
  const r = await bpFetch('/write', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ device: dev, data: zpl }) })
  if (!r.ok) throw new Error('Errore invio alla stampante Zebra (' + r.status + ').')
}

// Stampa UNA etichetta (dato l'URL che ritorna il PDF/immagine). dpi = risoluzione stampante (203 std).
export async function stampaEtichettaZebra(labelUrl: string, dpi = 203): Promise<void> {
  const res = await fetch(labelUrl)
  if (!res.ok) throw new Error('Etichetta non disponibile.')
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  const buf = await res.arrayBuffer()
  const head = new Uint8Array(buf.slice(0, 4))
  const isPdf = ct.includes('pdf') || (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) // %PDF
  const zpl = isPdf ? await pdfToZpl(buf, dpi) : await imageToZpl(new Blob([buf], { type: ct || 'image/png' }), dpi)
  await inviaZpl(zpl)
}

// Stampa PIÙ etichette in sequenza (una chiamata write per ognuna). Ritorna quante ok/errore.
export async function stampaEtichetteZebra(labelUrls: string[], dpi = 203): Promise<{ ok: number; errori: number }> {
  const device = await getStampante()   // una volta sola
  let ok = 0, errori = 0
  for (const u of labelUrls) {
    try {
      const res = await fetch(u); if (!res.ok) { errori++; continue }
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      const buf = await res.arrayBuffer()
      const head = new Uint8Array(buf.slice(0, 4))
      const isPdf = ct.includes('pdf') || (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)
      const zpl = isPdf ? await pdfToZpl(buf, dpi) : await imageToZpl(new Blob([buf], { type: ct || 'image/png' }), dpi)
      await inviaZpl(zpl, device); ok++
    } catch { errori++ }
  }
  return { ok, errori }
}
