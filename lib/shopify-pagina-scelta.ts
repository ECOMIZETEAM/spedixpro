import { NextResponse } from 'next/server'
import { esc } from '@/lib/amazon-pagina'
import { PAGINA_SCELTA } from '@/lib/shopifyCollega'

// LA PAGINA «HAI GIÀ UN ACCOUNT MOOVEXPRESS?» DOPO L'INSTALLAZIONE DELL'APP SHOPIFY (decisione D1, 21/10/2026).
//
// Servita direttamente dalla rotta /api/integrazioni/shopify/collega, sul modello delle pagine Amazon
// (lib/amazon-pagina.ts), e non come pagina del portale: sotto /cliente/* il middleware rimbalza chi non ha una
// sessione al modulo d'accesso e lo staff alla sua dashboard, cioe' proprio le due persone che questa pagina deve
// servire. Sotto /api/integrazioni/shopify/ prende da next.config.ts no-referrer e no-store: per questo la
// risposta non scrive Cache-Control (su Vercel quello della rotta vincerebbe).
//
// UNA LINGUA PER VOLTA. Ogni testo c'e' in italiano e in inglese (la revisione di Shopify la legge in inglese),
// ma se ne vede uno solo: italiano se fra le lingue del browser ce n'e' una italiana, altrimenti inglese. La
// prima versione (21/10/2026) li metteva uno sotto l'altro, anche dentro i pulsanti, e Lorenzo l'ha bocciata a
// vista («quanto è brutto»): la scelta la fa uno script in testa, prima che la pagina si disegni; senza
// JavaScript resta l'italiano. Mostra SOLO il dominio del negozio (e, a chi e' gia' entrato, il proprio conto):
// mai token, id o testi arrivati dall'indirizzo. Gli esiti arrivano come codice (?esito=) e si traducono qui,
// solo per chiave propria: un codice sconosciuto non mostra niente. Nessun nome di fornitore: la leggono i
// negozianti.
//
// In fondo al file, con lo stesso aspetto, la conferma prima dell'ingresso automatico da Shopify quando nel
// browser c'e' gia' un'altra persona (PAGINA_ENTRA).

type Testo = { it: string; en: string }

// Chi non ha un conto scrive qui (Lorenzo, 23/10/2026).
const CONTATTO_ACCOUNT = 'info@moovexpress.com'

export const ESITI_SCELTA = {
  credenziali: { it: 'Email o password non corretti.', en: 'Incorrect email or password.' },
  troppi_tentativi: {
    it: 'Troppi tentativi di accesso non riusciti: per sicurezza abbiamo annullato questa installazione.',
    en: 'Too many failed sign-in attempts: for your security we cancelled this installation.',
  },
  non_cliente: {
    it: 'Questo non è un conto cliente: è un accesso dello staff (MoovExpress o rivenditore). Un negozio si collega solo al conto cliente che spedisce: accedi con quello.',
    en: 'This is not a customer account: it is a staff login (MoovExpress or reseller). A store can only be connected to the customer account that ships: please sign in with that one.',
  },
  disattivato: { it: 'Questo account non è attivo. Contatta il tuo referente.', en: 'This account is not active. Please contact your account manager.' },
  demo: { it: 'Gli account di prova non possono collegare negozi reali.', en: 'Demo accounts cannot connect real stores.' },
  sessione_cambiata: {
    it: 'In questo browser è cambiato l\'account con cui sei entrato: controlla e scegli di nuovo.',
    en: 'The account signed in on this browser has changed: please check and choose again.',
  },
  modulo_scaduto: { it: 'La pagina non era più aggiornata: riprova da qui.', en: 'This page was out of date: please try again from here.' },
  temporaneo: {
    it: 'Non siamo riusciti a completare l\'operazione per un problema temporaneo. Riprova tra qualche istante.',
    en: 'We could not complete the operation because of a temporary problem. Please try again in a moment.',
  },
  // La risposta a un modulo «Crea il mio account» rimasto aperto in una pagina di prima del 23/10/2026.
  solo_clienti: {
    it: `MoovExpress è riservata ai clienti dei nostri partner: da Shopify non si aprono conti nuovi. Se hai già un account accedi qui sotto; se non ce l'hai scrivi a ${CONTATTO_ACCOUNT}.`,
    en: `MoovExpress is available to customers of our shipping partners only: new accounts cannot be opened from Shopify. If you already have an account, sign in below; if not, write to ${CONTATTO_ACCOUNT}.`,
  },
  richiesta_non_valida: { it: 'Richiesta non valida: usa i pulsanti di questa pagina.', en: 'Invalid request: please use the buttons on this page.' },
} as const satisfies Record<string, Testo>

export type EsitoScelta = keyof typeof ESITI_SCELTA

// Il codice arriva dall'indirizzo: solo chiavi proprie, cosi' «toString» o «__proto__» non pescano nel prototipo.
export function esitoScelta(v: string | null | undefined): EsitoScelta | null {
  return v && Object.prototype.hasOwnProperty.call(ESITI_SCELTA, v) ? (v as EsitoScelta) : null
}

// GLI ESITI DI «SÌ, ACCEDO» SI LEGGONO SOPRA IL MODULO D'ACCESSO, NON SUL CONTO GIA' APERTO.
// Dopo un accesso non riuscito il browser resta com'era, compresa la sessione di prima. Fino al 21/10/2026, se
// il tentativo partiva da «Usa un altro account», il rimando perdeva ?altro=1 e la pagina tornava su «Collega
// <negozio> al conto <sessione aperta>», senza modulo: chi cliccava per riprovare collegava il negozio al conto
// di prima. Ora i moduli di quella vista rimandano ?altro=1 (paginaSceltaAccount), e questi esiti riaprono il
// modulo d'accesso anche senza.
const ESITI_DEL_MODULO_ACCEDI: readonly EsitoScelta[] = ['credenziali', 'non_cliente', 'disattivato', 'demo']
export function esitoDelModuloAccedi(e: EsitoScelta | null): boolean {
  return !!e && ESITI_DEL_MODULO_ACCEDI.includes(e)
}

// Perche' la sessione aperta nel browser non basta per collegare (lib/shopifyCollega.ts, sessioneNelBrowser).
const NOTE_SESSIONE = {
  staff: {
    it: 'In questo browser sei entrato con un accesso dello staff, che non può ricevere negozi. Prima di continuare esci da quell\'account (voce «Esci» del portale), poi ricarica questa pagina.',
    en: 'On this browser you are signed in with a staff login, which cannot receive stores. Before continuing, sign out of that account («Esci» in the portal menu), then reload this page.',
  },
  demo: {
    it: 'In questo browser sei entrato con un account di prova, che non può collegare negozi reali. Esci da quell\'account (voce «Esci» del portale), poi ricarica questa pagina.',
    en: 'On this browser you are signed in with a demo account, which cannot connect real stores. Sign out of that account («Esci» in the portal menu), then reload this page.',
  },
  disattivato: {
    it: 'L\'account con cui sei entrato in questo browser non è attivo: accedi qui sotto con un altro account.',
    en: 'The account signed in on this browser is not active: please sign in below with another account.',
  },
} as const satisfies Record<string, Testo>

// Colori e forme del portale (arancione #f97316, testo #111827): chi arriva da Shopify deve riconoscere
// MoovExpress, e la pagina deve stare bene anche sul telefono, dove si apre spesso dall'app di Shopify.
const STILE = `*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:#f4f5f7 radial-gradient(1200px 420px at 50% -120px,#ffedd5 0%,rgba(255,237,213,0) 70%) no-repeat;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111827;-webkit-font-smoothing:antialiased}
.l-en{display:none}html.lingua-en .l-it{display:none}html.lingua-en .l-en{display:inline}
.wrap{max-width:440px;margin:0 auto;padding:40px 16px 32px}
.marchio{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:22px;font-weight:800;font-size:17px;letter-spacing:-.2px}
.marchio svg{width:34px;height:34px;border-radius:9px}
.card{background:#fff;border:1px solid #ececef;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,39,.07);padding:30px 28px}
@media(max-width:480px){.wrap{padding:24px 12px}.card{padding:24px 18px;border-radius:16px}}
.ponte{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 18px}
.bolla{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center}
.bolla.negozio{background:#ecfccb}.bolla.moov{background:#111827}
.bolla svg{width:26px;height:26px}
.trattini{width:46px;border-top:2px dashed #d1d5db}
h1{font-size:23px;line-height:1.25;font-weight:800;letter-spacing:-.4px;margin:0;text-align:center}
.sotto{font-size:14.5px;line-height:1.55;color:#6b7280;margin:8px 0 0;text-align:center}
h2{font-size:16px;font-weight:700;margin:24px 0 0}
.testo{font-size:14px;line-height:1.55;color:#4b5563;margin:6px 0 0}
.riepilogo{margin:22px 0 0;border:1px solid #ececef;border-radius:14px;background:#fafafa}
.riga{display:flex;align-items:center;gap:12px;padding:13px 14px}
.riga+.riga{border-top:1px solid #ececef}
.riga .ico{flex:0 0 34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #ececef;font-size:12.5px;font-weight:800;color:#c2410c}
.riga .ico svg{width:18px;height:18px}
.riga .etichetta{display:block;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af}
.riga .valore{display:block;font-size:14.5px;font-weight:600;color:#111827;overflow-wrap:anywhere;margin-top:1px}
.riga .valore small{font-weight:500;color:#6b7280}
.avviso{margin:18px 0 0;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.5}
.avviso.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}
.avviso.nota{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
form{margin:0}
label{display:block;font-size:13px;font-weight:600;color:#374151;margin:14px 0 6px}
input[type=email],input[type=password]{width:100%;height:46px;padding:0 13px;border:1px solid #d1d5db;border-radius:11px;font-size:15px;font-family:inherit;color:#111827;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s}
input[type=email]:focus,input[type=password]:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,.18)}
button{display:block;width:100%;height:48px;margin-top:18px;border:0;border-radius:12px;background:#f97316;color:#fff;font-family:inherit;font-size:15.5px;font-weight:700;cursor:pointer;transition:background .15s}
button:hover{background:#ea580c}
button.sec{background:#fff;color:#111827;border:1px solid #d1d5db}button.sec:hover{background:#f9fafb}
button[disabled]{opacity:.6;cursor:default}
.oppure{display:flex;align-items:center;gap:12px;margin:26px 0 0;color:#9ca3af;font-size:12.5px;text-transform:uppercase;letter-spacing:.5px}
.oppure:before,.oppure:after{content:"";flex:1;border-top:1px solid #ececef}
a.alt{display:block;text-align:center;margin-top:16px;font-size:14px;font-weight:600;color:#6b7280;text-decoration:none}
.testo a{color:#ea580c;font-weight:600;text-decoration:none}
.testo a:hover{text-decoration:underline}
a.alt:hover{color:#111827;text-decoration:underline}
.nota-centro{font-size:13px;line-height:1.5;color:#6b7280;text-align:center;margin:12px 0 0}
.piede{margin:18px 4px 0;text-align:center;font-size:12.5px;line-height:1.5;color:#9ca3af}`

// La lingua si sceglie prima che la pagina si disegni: niente lampo dell'altra lingua.
const SCELTA_LINGUA = `<script>(function(){var l=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||''];for(var i=0;i<l.length;i++){if(/^it\\b/i.test(l[i]))return}document.documentElement.classList.add('lingua-en');document.documentElement.lang='en'})()</script>`

// Un invio solo: il pulsante si spegne al clic (il doppio clic e' il caso piu' comune di doppia richiesta), e si
// riaccende tornando indietro sulla pagina, che il browser puo' restituire dalla sua memoria.
const SCRIPT = `<script>document.addEventListener('submit',function(e){var b=e.target.querySelectorAll('button');for(var i=0;i<b.length;i++)b[i].disabled=true});window.addEventListener('pageshow',function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++)b[i].disabled=false})</script>`

// La freccia di MoovExpress (app/icon.png), disegnata qui per non dipendere da un file servito a parte.
const FRECCIA = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#111827"/><g fill="#f97316"><rect x="10" y="21" width="22" height="5" rx="2.5"/><rect x="6" y="30" width="26" height="5" rx="2.5"/><rect x="13" y="39" width="15" height="5" rx="2.5"/><path d="M35 15h9l14 17-14 17h-9l14-17z"/></g></svg>'
const FRECCIA_BOLLA = '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="#f97316"><rect x="8" y="22" width="22" height="5" rx="2.5"/><rect x="4" y="31" width="26" height="5" rx="2.5"/><rect x="11" y="40" width="15" height="5" rx="2.5"/><path d="M33 16h9l14 16-14 16h-9l14-16z"/></g></svg>'
// Una borsa della spesa generica, non il marchio di Shopify.
const BORSA = '<svg viewBox="0 0 24 24" fill="none" stroke="#4d7c0f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'
const BORSA_RIGA = BORSA.replace('stroke="#4d7c0f"', 'stroke="#65a30d"')

const t = (x: Testo) => `<span class="l-it">${esc(x.it)}</span><span class="l-en" lang="en">${esc(x.en)}</span>`
const due = (x: Testo, tag = 'p', classe = 'testo') => `<${tag}${tag === 'p' ? ` class="${classe}"` : ''}>${t(x)}</${tag}>`
const pulsante = (it: string, en: string, classe = '') => `<button type="submit"${classe ? ` class="${classe}"` : ''}>${t({ it, en })}</button>`
const avviso = (x: Testo, tipo: 'err' | 'nota') =>
  `<div class="avviso ${tipo}" role="${tipo === 'err' ? 'alert' : 'status'}">${t(x)}</div>`
// `altro`: il modulo parte dalla vista «Usa un altro account», e il rimando ci deve tornare (ESITI_DEL_MODULO_ACCEDI).
const modulo = (azione: string, gettone: string, dentro: string, altro = false) =>
  `<form method="post" action="${PAGINA_SCELTA}"><input type="hidden" name="azione" value="${esc(azione)}"><input type="hidden" name="gettone" value="${esc(gettone)}">${altro ? '<input type="hidden" name="altro" value="1">' : ''}${dentro}</form>`

const ponte = `<div class="ponte"><div class="bolla negozio">${BORSA}</div><div class="trattini"></div><div class="bolla moov">${FRECCIA_BOLLA}</div></div>`
const rigaNegozio = (shop: string) =>
  `<div class="riga"><div class="ico">${BORSA_RIGA}</div><div><span class="etichetta">${t({ it: 'Negozio Shopify', en: 'Shopify store' })}</span><span class="valore">${esc(shop)}</span></div></div>`
const iniziali = (nome: string) => (nome.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('') || 'M').toUpperCase()
const rigaConto = (etichetta: Testo, nome: string, codice: string) =>
  `<div class="riga"><div class="ico">${esc(iniziali(nome))}</div><div><span class="etichetta">${t(etichetta)}</span><span class="valore">${esc(nome)}${codice ? ` <small>· ${esc(codice)}</small>` : ''}</span></div></div>`

function pagina(corpoHtml: string, titolo = 'Collega il negozio', status = 200, piede?: Testo): NextResponse {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${esc(titolo)} · MoovExpress</title>${SCELTA_LINGUA}<style>${STILE}</style></head>
<body><main class="wrap"><div class="marchio">${FRECCIA}<span>MoovExpress</span></div><div class="card">${corpoHtml}</div>${piede ? `<p class="piede">${t(piede)}</p>` : ''}</main>${SCRIPT}</body></html>`
  // Nessuna cornice: la pagina ha moduli con la password e pulsanti che collegano un negozio a un conto o
  // cambiano il conto in cui si e' entrati.
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" },
  })
}

const PIEDE_COLLEGAMENTO: Testo = {
  it: 'Per sicurezza questa pagina vale 15 minuti. Puoi scollegare il negozio quando vuoi disinstallando MoovExpress da Shopify.',
  en: 'For your security this page is valid for 15 minutes. You can disconnect the store at any time by uninstalling MoovExpress from Shopify.',
}

// Installazione scaduta, gia' usata o annullata: l'unica strada e' riaprire l'app dall'admin del negozio, che
// rifa' l'autorizzazione e torna qui con un'installazione nuova.
export function paginaInstallazioneScaduta(motivo?: EsitoScelta | null): NextResponse {
  return pagina(
    ponte
    + due({ it: 'Installazione scaduta', en: 'Installation expired' }, 'h1')
    + (motivo ? avviso(ESITI_SCELTA[motivo], 'err') : '')
    + due({
      it: 'Per sicurezza la scelta dell\'account vale pochi minuti e una volta sola. Riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App) per ricominciare: non perdi niente.',
      en: 'For your security, the account choice is valid for a few minutes and only once. Open MoovExpress again from your Shopify admin (Apps menu) to start over: nothing is lost.',
    }, 'p', 'sotto'),
  )
}

// Un guasto nel leggere l'installazione non e' una scadenza: l'installazione puo' essere ancora valida, e
// ricaricando si riprende da dove si era.
export function paginaProblemaTemporaneo(): NextResponse {
  return pagina(
    ponte
    + due({ it: 'Problema temporaneo', en: 'Temporary problem' }, 'h1')
    + due({
      it: 'Non siamo riusciti a caricare l\'installazione del negozio. Ricarica questa pagina tra qualche istante; se si ripete, riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App).',
      en: 'We could not load your store installation. Please reload this page in a moment; if it happens again, open MoovExpress again from your Shopify admin (Apps menu).',
    }, 'p', 'sotto'),
  )
}

export type OpzioniScelta = {
  shop: string
  esito: EsitoScelta | null
  // Il conto cliente gia' entrato in questo browser, se puo' ricevere il negozio, col gettone di «Collega al conto».
  conto: { ragioneSociale: string; codiceCliente: string; gettone: string } | null
  // Mostrare comunque «Hai già un account?» (link «Usa un altro account»).
  altroAccount: boolean
  nota: keyof typeof NOTE_SESSIONE | null
  gettoneAccedi: string
}

export function paginaSceltaAccount(o: OpzioniScelta): NextResponse {
  const testa = ponte
    + due({ it: 'Collega il tuo negozio', en: 'Connect your store' }, 'h1')
    + due({
      it: 'Gli ordini di Shopify arriveranno in MoovExpress e il tracking tornerà su Shopify a spedizione fatta.',
      en: 'Your Shopify orders will arrive in MoovExpress, and tracking will go back to Shopify once shipped.',
    }, 'p', 'sotto')

  // GIA' DENTRO: un clic. Il conto che riceve il negozio sta nel riepilogo, non scritto per esteso sul pulsante.
  if (o.conto && !o.altroAccount) {
    const nome = o.conto.ragioneSociale || 'Il tuo conto'
    return pagina(testa
      + (o.esito ? avviso(ESITI_SCELTA[o.esito], 'err') : '')
      + `<div class="riepilogo">${rigaNegozio(o.shop)}${rigaConto({ it: 'Verrà collegato al conto', en: 'Will be connected to' }, nome, o.conto.codiceCliente)}</div>`
      + due({
        it: 'Le spedizioni useranno i prezzi del listino di questo conto.',
        en: 'Shipments will use this account\'s price list.',
      }, 'p', 'nota-centro')
      + modulo('conferma', o.conto.gettone, pulsante('Collega il negozio', 'Connect store'))
      + `<a class="alt" href="${PAGINA_SCELTA}?altro=1">${t({ it: 'Usa un altro account', en: 'Use a different account' })}</a>`,
    'Collega il negozio', 200, PIEDE_COLLEGAMENTO)
  }

  // Vista «Usa un altro account»: i suoi moduli lo dicono al rimando, che altrimenti tornerebbe sul conto gia'
  // aperto (ESITI_DEL_MODULO_ACCEDI).
  const altro = !!o.conto && o.altroAccount

  return pagina(testa
    + `<div class="riepilogo">${rigaNegozio(o.shop)}</div>`
    + (o.esito ? avviso(ESITI_SCELTA[o.esito], 'err') : '')
    + (o.nota ? avviso(NOTE_SESSIONE[o.nota], 'nota') : '')
    + due({ it: 'Hai già un account MoovExpress?', en: 'Already have a MoovExpress account?' }, 'h2')
    + due({
      it: 'Accedi con il conto che spedisce per questo negozio: il negozio verrà collegato lì, ai prezzi del suo listino.',
      en: 'Sign in with the account that ships for this store: the store will be connected to it, at its price list.',
    })
    + modulo('accedi', o.gettoneAccedi,
      `<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="200">`
      + `<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">`
      + pulsante('Accedi e collega', 'Sign in and connect'), altro)
    // SOLO CHI E' GIA' CLIENTE (Lorenzo, 23/10/2026: «dobbiamo renderla accessibile solo per i già clienti
    // MoovExpress, perché ricaricano il credito al master tramite SEPA; così riduciamo i rischi»). Fino ad allora
    // qui c'era «Crea il mio account», che apriva un conto nuovo sotto MOOVY a chiunque installasse l'app. La
    // guida di Shopify ammette le app che servono solo chi ha un contratto (Integrating with the Shopify admin,
    // eccezione B2B): la prima cosa che si vede deve essere il collegamento al conto esistente, ed e' questa.
    + `<div class="oppure">${t({ it: 'oppure', en: 'or' })}</div>`
    + due({ it: 'Non hai un account?', en: 'No account yet?' }, 'h2')
    // Il testo passa da t(), che protegge l'HTML; il link si aggiunge fuori.
    + `<p class="testo">${t({
      it: 'MoovExpress è riservata ai clienti dei nostri partner di spedizione. Per avere un account scrivi a',
      en: 'MoovExpress is available to customers of our shipping partners. To get an account, write to',
    })} <a href="mailto:${CONTATTO_ACCOUNT}">${CONTATTO_ACCOUNT}</a>.</p>`
    + (o.conto ? `<a class="alt" href="${PAGINA_SCELTA}">${t({ it: 'Torna al conto con cui sei entrato', en: 'Back to the account you are signed in with' })}</a>` : ''),
  'Collega il negozio', 200, PIEDE_COLLEGAMENTO)
}

// ── LA CONFERMA PRIMA DI ENTRARE NEL CONTO DEL NEGOZIO ─────────────────────────────────────────────
//
// Decisione di Lorenzo del 21/10/2026: l'accesso automatico da Shopify non sostituisce in silenzio la sessione
// di un'altra persona (lib/accesso-cliente.ts, entraNelPortaleDaShopify). Questa pagina chiede se uscire; il
// pulsante manda il gettone a PAGINA_ENTRA (app/api/integrazioni/shopify/entra), che rifa' tutti i controlli.
// Mostra il dominio del negozio e il nome del conto in cui si e' dentro, che e' di chi ha questa sessione;
// nessun id. «No» porta alla propria dashboard: la sceglie il middleware dal ruolo.
//
// Il modulo POST sotto /api/ passa dal middleware, che lo rifiuta prima della rotta a un agente, a un autista,
// a chi e' in una prova e al master sospeso per il canone o senza piano. Per loro, e per chi preferisce, c'e'
// l'uscita a mano: chi esce e riapre l'app da Shopify entra da solo.
export const PAGINA_ENTRA = '/api/integrazioni/shopify/entra'

export function paginaConfermaIngresso(o: { shop: string; nome: string; gettone: string }): NextResponse {
  const nome = o.nome || 'un altro account'
  const nomeEn = o.nome || 'another account'
  return pagina(
    ponte
    + due({ it: 'Sei già dentro MoovExpress', en: 'You are already signed in' }, 'h1')
    + due({
      it: `In questo browser sei dentro come ${nome}. Vuoi uscire ed entrare nel conto del negozio?`,
      en: `On this browser you are signed in as ${nomeEn}. Do you want to sign out and enter the store's account?`,
    }, 'p', 'sotto')
    + `<div class="riepilogo">${rigaNegozio(o.shop)}${rigaConto({ it: 'Sei dentro come', en: 'Signed in as' }, nome, '')}</div>`
    + `<form method="post" action="${PAGINA_ENTRA}"><input type="hidden" name="shop" value="${esc(o.shop)}"><input type="hidden" name="gettone" value="${esc(o.gettone)}">`
    + pulsante('Esci ed entra nel conto del negozio', 'Sign out and enter the store account') + '</form>'
    + `<a class="alt" href="/">${t({ it: `No, resta dentro come ${nome}`, en: `No, stay signed in as ${nomeEn}` })}</a>`,
    'Entra nel conto del negozio',
    200,
    {
      it: 'Preferisci uscire da solo? Esci da questo account (voce «Esci» del portale), poi riapri MoovExpress dall\'admin di Shopify (menu App).',
      en: 'Prefer to sign out yourself? Sign out of this account («Esci» in the portal menu), then open MoovExpress again from your Shopify admin (Apps menu).',
    },
  )
}

// La conferma non vale piu' (scaduta, gia' usata, un'altra sessione, il negozio scollegato nel frattempo) o non
// si e' potuta verificare. Nessun dettaglio: la strada e' la stessa, riaprire l'app da Shopify, che rifa' i
// controlli da capo.
export function paginaIngressoNonConfermato(motivo: 'non_valida' | 'temporaneo'): NextResponse {
  if (motivo === 'temporaneo') {
    return pagina(
      ponte
      + due({ it: 'Problema temporaneo', en: 'Temporary problem' }, 'h1')
      + due({
        it: 'Non siamo riusciti a completare l\'ingresso per un problema temporaneo. Riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App) tra qualche istante.',
        en: 'We could not complete the sign-in because of a temporary problem. Please open MoovExpress again from your Shopify admin (Apps menu) in a moment.',
      }, 'p', 'sotto'),
      'Entra nel conto del negozio',
      503,
    )
  }
  return pagina(
    ponte
    + due({ it: 'Conferma non più valida', en: 'Confirmation no longer valid' }, 'h1')
    + due({
      it: 'Per sicurezza la conferma vale pochi minuti, una volta sola e solo con l\'account con cui eri dentro quando l\'hai vista. Riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App) per entrare.',
      en: 'For your security, the confirmation is valid for a few minutes, only once and only with the account you were signed in with when you saw it. Open MoovExpress again from your Shopify admin (Apps menu) to sign in.',
    }, 'p', 'sotto'),
    'Entra nel conto del negozio',
    403,
  )
}
