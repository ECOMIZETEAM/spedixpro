// FILE RISERVATI — report, allegati dei ticket e POD.
//
// Vivono tutti nel bucket `reports`, che nasceva PUBBLICO: chiunque avesse (o indovinasse) l'URL
// scaricava il file senza autenticarsi. Dentro ci sono i report spedizioni con i prezzi e i
// margini, gli allegati che i clienti caricano sull'assistenza (fatture, foto, documenti) e le
// POD firmate dai destinatari. Un link condiviso una volta restava valido per sempre e per
// chiunque, anche dopo che quel cliente aveva lasciato la rete.
//
// Ora il bucket e' privato e i file escono SOLO da /api/file, che prima verifica chi sta
// chiedendo. Le righe gia' salvate continuano a contenere il vecchio URL pubblico: `pathDaUrl`
// serve a ricavarne il percorso, cosi' i file di ieri restano scaricabili senza dover riscrivere
// il database.

export const BUCKET_RISERVATI = 'reports'

// Dal vecchio URL pubblico (…/storage/v1/object/public/reports/<percorso>) al solo percorso.
// Se gli si passa gia' un percorso lo restituisce pulito: chi chiama non deve distinguere.
export function pathDaUrl(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const marcatore = `/object/public/${BUCKET_RISERVATI}/`
  const i = s.indexOf(marcatore)
  if (i >= 0) return decodeURIComponent(s.slice(i + marcatore.length).split('?')[0])
  const alt = `/object/${BUCKET_RISERVATI}/`
  const j = s.indexOf(alt)
  if (j >= 0) return decodeURIComponent(s.slice(j + alt.length).split('?')[0])
  if (/^https?:\/\//i.test(s)) return null   // URL di un altro dominio: non e' roba nostra
  return s.replace(/^\/+/, '')
}

// Link da mettere nelle pagine al posto dell'URL pubblico.
export function linkAllegato(ticketId: string | null | undefined, urlOPath: string | null | undefined): string {
  const p = pathDaUrl(urlOPath)
  return ticketId && p ? `/api/file?t=${encodeURIComponent(ticketId)}&f=${encodeURIComponent(p)}` : ''
}
export function linkReport(reportId: string): string {
  return `/api/file?r=${encodeURIComponent(reportId)}`
}

// Nome con cui il browser salva il file: l'ultimo pezzo del percorso, senza il timestamp davanti.
export function nomeDaPath(path: string): string {
  const base = (path.split('/').pop() || 'file').trim()
  return base.replace(/^\d{10,}_(\d+_)?/, '') || base
}
