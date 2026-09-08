import { createClient } from '@/lib/supabase-browser'

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

export const MAX_ALLEGATO_CHAT = 25 * 1024 * 1024   // 25 MB per file (video inclusi)

// Allegato pronto per la chat: puo' essere in base64 (foto) o un riferimento gia' caricato (video/file).
export type AllegatoChat = { nome: string; tipo: string; dati?: string; url?: string; giaCaricato?: boolean }

// Prepara un allegato per la CHAT dei ticket. Le FOTO si comprimono e viaggiano in base64 (piccole).
// VIDEO e altri file vanno DIRETTI su storage via URL firmato (/api/assistenza/upload-url), così non
// sforano il limite ~4,5 MB del corpo richiesta; tornano come riferimento {url, giaCaricato}. Max 25 MB.
export async function preparaAllegatoChat(file: File): Promise<AllegatoChat> {
  const isImage = (file.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(file.name)
  if (isImage) return await fileToAllegato(file)   // compressione + base64
  if (file.size > MAX_ALLEGATO_CHAT) throw new Error(`"${file.name}" supera i 25 MB`)
  const up = await fetch('/api/assistenza/upload-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomeFile: file.name }),
  }).then(r => r.json()).catch(() => null)
  if (!up?.path || !up?.token) throw new Error('Caricamento non riuscito')
  const sb = createClient()
  const { error } = await sb.storage.from(up.bucket || 'reports').uploadToSignedUrl(up.path, up.token, file, { contentType: file.type || undefined })
  if (error) throw new Error(`Caricamento di "${file.name}" non riuscito`)
  return { nome: file.name, tipo: file.type || 'application/octet-stream', url: up.path, giaCaricato: true }
}
