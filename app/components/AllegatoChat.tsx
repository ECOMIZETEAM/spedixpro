import { linkAllegato } from '@/lib/file-riservati'

// Rende UN allegato di un messaggio ticket: foto (miniatura), video (player inline) o file (link).
// Tutto passa da /api/file (bucket privato), che serve inline foto/pdf/video e in download il resto.
export function AllegatoChat({ ticketId, a, mio }: { ticketId: string | null | undefined; a: any; mio?: boolean }) {
  const url = linkAllegato(ticketId, a?.url)
  if (!url) return null
  const tipo = String(a?.tipo || '')
  const nome = String(a?.nome || a?.url || 'file')
  const isImg = tipo.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)(\?|$)/i.test(nome)
  const isVid = tipo.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi|mkv|3gp)(\?|$)/i.test(nome)
  if (isImg) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={nome} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: mio ? '1px solid rgba(255,255,255,0.45)' : '1px solid #e5e7eb', display: 'block' }} />
      </a>
    )
  }
  if (isVid) {
    return <video src={url} controls preload="metadata" style={{ width: 190, maxWidth: '100%', borderRadius: 8, display: 'block', background: '#000' }} />
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: mio ? '#fff' : '#2563eb', textDecoration: 'underline' }}>📎 {nome}</a>
  )
}
