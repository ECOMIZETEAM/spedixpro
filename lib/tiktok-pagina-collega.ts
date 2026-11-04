import { NextResponse } from 'next/server'
import { PAGINA_COLLEGA_TIKTOK, type NegozioTiktok } from '@/lib/tiktokCollega'

// LA PAGINA «COLLEGA IL NEGOZIO TIKTOK SHOP AL TUO CONTO», dopo un'installazione dall'App Store di TikTok.
//
// Stesse forme e colori della pagina di Shopify (lib/shopify-pagina-scelta.ts): chi arriva dal Seller Center
// deve riconoscere MoovExpress, e la pagina deve stare bene anche sul telefono. Solo in italiano: l'app e'
// pubblicata per i venditori in Italia. Nessuna password qui dentro: chi non e' entrato apre il modulo
// d'accesso del portale in un'altra scheda e torna (lib/tiktokCollega.ts spiega perche').

const CONTATTO = 'info@moovexpress.com'

const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const STILE = `*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:#f4f5f7 radial-gradient(1200px 420px at 50% -120px,#ffedd5 0%,rgba(255,237,213,0) 70%) no-repeat;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111827;-webkit-font-smoothing:antialiased}
.wrap{max-width:440px;margin:0 auto;padding:40px 16px 32px}
.marchio{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:22px;font-weight:800;font-size:17px;letter-spacing:-.2px}
.marchio svg{width:34px;height:34px;border-radius:9px}
.card{background:#fff;border:1px solid #ececef;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,39,.07);padding:30px 28px}
@media(max-width:480px){.wrap{padding:24px 12px}.card{padding:24px 18px;border-radius:16px}}
h1{font-size:23px;line-height:1.25;font-weight:800;letter-spacing:-.4px;margin:0;text-align:center}
.sotto{font-size:14.5px;line-height:1.55;color:#6b7280;margin:8px 0 0;text-align:center}
.testo{font-size:14px;line-height:1.55;color:#4b5563;margin:14px 0 0}
.testo a{color:#ea580c;font-weight:600;text-decoration:none}.testo a:hover{text-decoration:underline}
.riepilogo{margin:22px 0 0;border:1px solid #ececef;border-radius:14px;background:#fafafa}
.riga{display:flex;align-items:center;gap:12px;padding:13px 14px}
.riga+.riga{border-top:1px solid #ececef}
.riga .ico{flex:0 0 34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #ececef;font-size:12.5px;font-weight:800;color:#c2410c}
.riga .etichetta{display:block;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af}
.riga .valore{display:block;font-size:14.5px;font-weight:600;color:#111827;overflow-wrap:anywhere;margin-top:1px}
.riga .valore small{font-weight:500;color:#6b7280}
.avviso{margin:18px 0 0;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.5;background:#fffbeb;border:1px solid #fde68a;color:#92400e}
ol{margin:18px 0 0;padding-left:20px;font-size:14px;line-height:1.6;color:#4b5563}
ol a{color:#ea580c;font-weight:600;text-decoration:none}ol a:hover{text-decoration:underline}
form{margin:0}
.btn{display:block;width:100%;height:48px;line-height:48px;margin-top:18px;border:0;border-radius:12px;background:#f97316;color:#fff;font-family:inherit;font-size:15.5px;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;transition:background .15s}
.btn:hover{background:#ea580c}
.btn.sec{background:#fff;color:#111827;border:1px solid #d1d5db;line-height:46px}.btn.sec:hover{background:#f9fafb}
button[disabled]{opacity:.6;cursor:default}
.piede{margin:18px 4px 0;text-align:center;font-size:12.5px;line-height:1.5;color:#9ca3af}`

// Un invio solo: il pulsante si spegne al clic, e si riaccende tornando indietro sulla pagina.
const SCRIPT = `<script>document.addEventListener('submit',function(e){var b=e.target.querySelectorAll('button');for(var i=0;i<b.length;i++)b[i].disabled=true});window.addEventListener('pageshow',function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++)b[i].disabled=false})</script>`

// La freccia di MoovExpress, disegnata qui per non dipendere da un file servito a parte.
const FRECCIA = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#111827"/><g fill="#f97316"><rect x="10" y="21" width="22" height="5" rx="2.5"/><rect x="6" y="30" width="26" height="5" rx="2.5"/><rect x="13" y="39" width="15" height="5" rx="2.5"/><path d="M35 15h9l14 17-14 17h-9l14-17z"/></g></svg>'

const PIEDE = 'Per sicurezza questa pagina vale 15 minuti. Puoi scollegare il negozio quando vuoi dal Seller Center di TikTok Shop.'

function pagina(corpo: string, titolo: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${esc(titolo)} · MoovExpress</title><style>${STILE}</style></head>
<body><main class="wrap"><div class="marchio">${FRECCIA}<span>MoovExpress</span></div><div class="card">${corpo}</div><p class="piede">${esc(PIEDE)}</p></main>${SCRIPT}</body></html>`
  // Nessuna cornice: il pulsante collega un negozio a un conto.
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" },
  })
}

const iniziali = (nome: string) => (nome.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('') || 'M').toUpperCase()
const righeNegozi = (negozi: NegozioTiktok[]) => negozi.map(n =>
  `<div class="riga"><div class="ico">${esc(iniziali(n.nome))}</div><div><span class="etichetta">Negozio TikTok Shop</span><span class="valore">${esc(n.nome)}</span></div></div>`).join('')

// Installazione scaduta, gia' usata o illeggibile: si ricomincia dal Seller Center, senza perdere niente.
export function paginaTiktokScaduta(): NextResponse {
  return pagina(
    `<h1>Richiesta scaduta</h1>
<p class="sotto">Il collegamento del negozio non è stato completato in tempo, oppure è già stato fatto.</p>
<p class="testo">Se il negozio non risulta fra i <a href="/cliente/integrazioni">negozi collegati</a>, riapri MoovExpress dal Seller Center di TikTok Shop (App e servizi): non perdi niente.</p>`,
    'Richiesta scaduta',
  )
}

// Nel browser c'e' un conto cliente che puo' ricevere il negozio: un clic, col nome del conto sul pulsante.
export function paginaTiktokConferma(o: { negozi: NegozioTiktok[]; ragioneSociale: string; codiceCliente: string; gettone: string }): NextResponse {
  return pagina(
    `<h1>Collega il negozio TikTok Shop</h1>
<p class="sotto">Gli ordini da spedire arriveranno in MoovExpress e il tracciamento tornerà su TikTok.</p>
<div class="riepilogo">${righeNegozi(o.negozi)}
<div class="riga"><div class="ico">${esc(iniziali(o.ragioneSociale || 'M'))}</div><div><span class="etichetta">Al tuo conto MoovExpress</span><span class="valore">${esc(o.ragioneSociale)}${o.codiceCliente ? ` <small>· ${esc(o.codiceCliente)}</small>` : ''}</span></div></div></div>
<form method="post" action="${PAGINA_COLLEGA_TIKTOK}"><input type="hidden" name="azione" value="conferma"><input type="hidden" name="gettone" value="${esc(o.gettone)}"><button type="submit" class="btn">Collega a questo conto</button></form>
<p class="testo">Non è il tuo conto? <a href="/api/auth/logout" target="_blank" rel="noopener">Esci</a> in un'altra scheda, entra con quello giusto e poi <a href="${PAGINA_COLLEGA_TIKTOK}">ricarica questa pagina</a>.</p>`,
    'Collega il negozio',
  )
}

// Nessuno e' entrato: si entra dal modulo del portale in un'altra scheda, poi si torna qui.
export function paginaTiktokAccedi(o: { negozi: NegozioTiktok[] }): NextResponse {
  return pagina(
    `<h1>Entra nel tuo conto MoovExpress</h1>
<p class="sotto">Per collegare il negozio dobbiamo sapere a quale conto MoovExpress appartiene.</p>
<div class="riepilogo">${righeNegozi(o.negozi)}</div>
<ol><li>Apri il portale ed entra con email e password.</li><li>Torna su questa scheda e premi «Continua».</li></ol>
<a class="btn" href="/cliente" target="_blank" rel="noopener">Apri il portale MoovExpress</a>
<a class="btn sec" href="${PAGINA_COLLEGA_TIKTOK}">Continua</a>
<p class="testo">Non hai ancora un conto MoovExpress? L'app è per chi spedisce già con noi: scrivi a <a href="mailto:${CONTATTO}">${CONTATTO}</a>.</p>`,
    'Entra nel tuo conto',
  )
}

const NON_COLLEGABILE = {
  staff: 'Sei entrato con un accesso di gestione (master, operatore o agente): un negozio si collega solo a un conto cliente.',
  demo: 'Sei entrato con un conto di prova, che non può collegare negozi.',
  disattivato: 'Il conto con cui sei entrato è disattivato.',
} as const

// C'e' una sessione, ma non puo' ricevere il negozio: va chiusa prima di entrare con il conto cliente.
export function paginaTiktokNonCollegabile(motivo: keyof typeof NON_COLLEGABILE, negozi: NegozioTiktok[]): NextResponse {
  return pagina(
    `<h1>Questo accesso non va bene</h1>
<div class="riepilogo">${righeNegozi(negozi)}</div>
<div class="avviso" role="status">${esc(NON_COLLEGABILE[motivo])}</div>
<ol><li><a href="/api/auth/logout" target="_blank" rel="noopener">Esci</a> in un'altra scheda ed entra con il conto cliente.</li><li>Torna su questa scheda e premi «Continua».</li></ol>
<a class="btn sec" href="${PAGINA_COLLEGA_TIKTOK}">Continua</a>`,
    'Collega il negozio',
  )
}
