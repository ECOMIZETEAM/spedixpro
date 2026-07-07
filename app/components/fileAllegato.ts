// Converte un File in allegato {nome, tipo, dati(base64)}.
// Le IMMAGINI vengono ridimensionate e ricompresse in JPEG lato browser:
// le foto da telefono (3-8 MB) diventano piccole, così non sforano il limite
// di dimensione della richiesta (Vercel ~4,5 MB) e arrivano sempre al server.
export type Allegato = { nome: string; tipo: string; dati: string }

function leggiDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

function comprimiImmagine(file: File, maxDim = 1600, q = 0.8): Promise<string> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim }
          else { w = Math.round(w * maxDim / h); h = maxDim }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { URL.revokeObjectURL(url); return rej(new Error('canvas non disponibile')) }
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        res(canvas.toDataURL('image/jpeg', q))
      } catch (e) { URL.revokeObjectURL(url); rej(e) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('immagine non leggibile')) }
    img.src = url
  })
}

export async function fileToAllegato(file: File): Promise<Allegato> {
  const isImage = (file.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(file.name)
  if (!isImage) {
    return { nome: file.name, tipo: file.type || 'application/octet-stream', dati: await leggiDataUrl(file) }
  }
  try {
    const dati = await comprimiImmagine(file)
    const nome = file.name.replace(/\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i, '') + '.jpg'
    return { nome, tipo: 'image/jpeg', dati }
  } catch {
    // Fallback (es. HEIC non decodificabile dal canvas): invia l'originale
    return { nome: file.name, tipo: file.type || 'image/jpeg', dati: await leggiDataUrl(file) }
  }
}
