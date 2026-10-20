import crypto from 'crypto'
import { NextResponse } from 'next/server'

// PAGINE SEMPLICI DEL COLLEGAMENTO AMAZON, servite direttamente dalle rotte (accesso, callback).
//
// Servono nei casi in cui rimandare alla pagina di login non spiega niente: chi ha gia' una
// sessione verrebbe portato alla sua dashboard senza il messaggio. Tutto il testo variabile passa
// da esc(): qualunque valore puo' arrivare da un link costruito da altri.
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const STILE = `body{margin:0;background:#f7f7f8;font-family:Inter,-apple-system,sans-serif;color:#1f2937}
.box{max-width:440px;margin:60px auto;padding:28px;background:#fff;border:1px solid #e8e8e8;border-radius:10px}
h1{font-size:19px;margin:0 0 14px}p{font-size:14.5px;line-height:1.55;margin:0 0 12px}.acc{font-weight:700}
button{margin-top:10px;width:100%;padding:12px;border:0;border-radius:8px;background:#f97316;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
a{display:block;text-align:center;margin-top:14px;font-size:13.5px;color:#6b7280}`

// `corpoHtml` e' gia' HTML: chi lo compone deve aver passato da esc() ogni valore variabile.
export function paginaAmazon(titolo: string, corpoHtml: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(titolo)} · MoovExpress</title><style>${STILE}</style></head>
<body><div class="box"><h1>${esc(titolo)}</h1>${corpoHtml}</div></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } })
}

// GETTONE DEL MODULO DI CONFERMA (accesso). La pagina di conferma si serve con no-referrer (lo
// chiede Amazon), e con no-referrer un browser senza Sec-Fetch-Site (Safari prima della 16.4)
// manda "Origin: null": il controllo d'origine da solo rifiuterebbe sempre la conferma. Il gettone
// lo sostituisce: lo calcola il server per QUELL'utente e QUELLO stato di Amazon, scade in 10
// minuti, e un sito estraneo non puo' produrlo senza la chiave.
const VALIDITA_MS = 10 * 60 * 1000
function chiaveModulo(): Buffer {
  return crypto.createHash('sha256').update('moovexpress|accesso-amazon|' + (process.env.INTEGRAZIONI_CHIAVI_CIFRATURA || '')).digest()
}
export function gettoneModulo(userId: string, amazonState: string, quando = Date.now()): string {
  const firma = crypto.createHmac('sha256', chiaveModulo()).update(`${userId}|${amazonState}|${quando}`).digest('hex')
  return `${quando}.${firma}`
}
export function gettoneValido(gettone: string, userId: string, amazonState: string): boolean {
  const [t, firma] = String(gettone || '').split('.')
  const quando = Number(t)
  if (!Number.isFinite(quando) || !firma || Date.now() - quando > VALIDITA_MS || quando - Date.now() > 60000) return false
  const atteso = gettoneModulo(userId, amazonState, quando).split('.')[1]
  try { return crypto.timingSafeEqual(Buffer.from(firma, 'hex'), Buffer.from(atteso, 'hex')) } catch { return false }
}
