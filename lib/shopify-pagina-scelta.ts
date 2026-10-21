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
// Italiano, con una riga in inglese sotto ogni titolo e ogni pulsante: la revisione di Shopify la legge in
// inglese. Mostra SOLO il dominio del negozio (e, a chi e' gia' entrato, il proprio conto): mai token, id o
// testi arrivati dall'indirizzo. Gli esiti arrivano come codice (?esito=) e si traducono qui, solo per chiave
// propria: un codice sconosciuto non mostra niente. Nessun nome di fornitore: la leggono i negozianti.
//
// In fondo al file, con lo stesso aspetto, la conferma prima dell'ingresso automatico da Shopify quando nel
// browser c'e' gia' un'altra persona (PAGINA_ENTRA).

type Testo = { it: string; en: string }

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
  creazione_non_disponibile: {
    it: 'La creazione di un account nuovo da Shopify non è ancora disponibile. Se hai già un account MoovExpress, accedi qui sopra; altrimenti riprova più tardi o scrivi all\'assistenza.',
    en: 'Creating a new account from Shopify is not available yet. If you already have a MoovExpress account, sign in above; otherwise please try again later or contact support.',
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

const STILE = `*{box-sizing:border-box}body{margin:0;background:#f7f7f8;font-family:Inter,-apple-system,sans-serif;color:#1f2937}
.box{max-width:480px;margin:40px auto;padding:28px;background:#fff;border:1px solid #e8e8e8;border-radius:10px}
@media(max-width:520px){.box{margin:0;border-radius:0;border-left:0;border-right:0;padding:22px 16px}}
h1{font-size:20px;margin:0}h2{font-size:16.5px;margin:22px 0 0}h1+.en,h2+.en{margin:2px 0 12px}
p{font-size:14.5px;line-height:1.55;margin:0 0 4px}.en{color:#6b7280;font-size:13px;line-height:1.45;margin:0 0 10px}
.negozio{margin:14px 0 4px;padding:10px 12px;background:#f3f4f6;border-radius:8px;font-size:14px;overflow-wrap:anywhere}
.acc{font-weight:700}
.avviso{margin:14px 0;padding:10px 12px;border-radius:8px;font-size:13.5px;line-height:1.5}
.avviso.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}.avviso.nota{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.avviso .en{color:inherit;opacity:.85;margin:4px 0 0}
form{margin:10px 0 0}label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
input[type=email],input[type=password]{width:100%;padding:11px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px}
button{margin-top:12px;width:100%;padding:11px 12px;border:0;border-radius:8px;background:#f97316;color:#fff;font-size:15px;font-weight:700;cursor:pointer;line-height:1.3}
button .en{display:block;color:#fff;opacity:.9;font-weight:500;font-size:12.5px;margin:2px 0 0}
button.sec{background:#fff;color:#1f2937;border:1px solid #d1d5db}button.sec .en{color:#6b7280}
button[disabled]{opacity:.6;cursor:default}
.sep{border:0;border-top:1px solid #eee;margin:22px 0 0}
a.alt{display:block;text-align:center;margin-top:16px;font-size:13.5px;color:#4b5563}a.alt .en{display:block;font-size:12.5px;color:#9ca3af}`

// Un invio solo: il pulsante si spegne al clic (il doppio clic e' il caso piu' comune di doppia richiesta), e si
// riaccende tornando indietro sulla pagina, che il browser puo' restituire dalla sua memoria.
const SCRIPT = `<script>document.addEventListener('submit',function(e){var b=e.target.querySelectorAll('button');for(var i=0;i<b.length;i++)b[i].disabled=true});window.addEventListener('pageshow',function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++)b[i].disabled=false})</script>`

const due = (t: Testo, tag = 'p') => `<${tag}>${esc(t.it)}</${tag}><p class="en" lang="en">${esc(t.en)}</p>`
const pulsante = (it: string, en: string, classe = '') =>
  `<button type="submit"${classe ? ` class="${classe}"` : ''}>${esc(it)}<span class="en" lang="en">${esc(en)}</span></button>`
const avviso = (t: Testo, tipo: 'err' | 'nota') =>
  `<div class="avviso ${tipo}" role="${tipo === 'err' ? 'alert' : 'status'}">${esc(t.it)}<p class="en" lang="en">${esc(t.en)}</p></div>`
// `altro`: il modulo parte dalla vista «Usa un altro account», e il rimando ci deve tornare (ESITI_DEL_MODULO_ACCEDI).
const modulo = (azione: string, gettone: string, dentro: string, altro = false) =>
  `<form method="post" action="${PAGINA_SCELTA}"><input type="hidden" name="azione" value="${esc(azione)}"><input type="hidden" name="gettone" value="${esc(gettone)}">${altro ? '<input type="hidden" name="altro" value="1">' : ''}${dentro}</form>`

function pagina(corpoHtml: string, titolo = 'Collega il negozio', status = 200): NextResponse {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${esc(titolo)} · MoovExpress</title><style>${STILE}</style></head>
<body><div class="box">${corpoHtml}</div>${SCRIPT}</body></html>`
  // Nessuna cornice: la pagina ha moduli con la password e pulsanti che collegano un negozio a un conto o
  // cambiano il conto in cui si e' entrati.
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" },
  })
}

// Installazione scaduta, gia' usata o annullata: l'unica strada e' riaprire l'app dall'admin del negozio, che
// rifa' l'autorizzazione e torna qui con un'installazione nuova.
export function paginaInstallazioneScaduta(motivo?: EsitoScelta | null): NextResponse {
  return pagina(
    due({ it: 'Installazione scaduta', en: 'Installation expired' }, 'h1')
    + (motivo ? avviso(ESITI_SCELTA[motivo], 'err') : '')
    + due({
      it: 'Per sicurezza la scelta dell\'account vale pochi minuti e una volta sola. Riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App) per ricominciare: non perdi niente.',
      en: 'For your security, the account choice is valid for a few minutes and only once. Open MoovExpress again from your Shopify admin (Apps menu) to start over: nothing is lost.',
    }),
  )
}

// Un guasto nel leggere l'installazione non e' una scadenza: l'installazione puo' essere ancora valida, e
// ricaricando si riprende da dove si era.
export function paginaProblemaTemporaneo(): NextResponse {
  return pagina(
    due({ it: 'Problema temporaneo', en: 'Temporary problem' }, 'h1')
    + due({
      it: 'Non siamo riusciti a caricare l\'installazione del negozio. Ricarica questa pagina tra qualche istante; se si ripete, riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App).',
      en: 'We could not load your store installation. Please reload this page in a moment; if it happens again, open MoovExpress again from your Shopify admin (Apps menu).',
    }),
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
  creazione: { stato: 'si'; gettone: string } | { stato: 'no' } | { stato: 'non_so' }
}

export function paginaSceltaAccount(o: OpzioniScelta): NextResponse {
  const testa = due({ it: 'Collega il tuo negozio a MoovExpress', en: 'Connect your store to MoovExpress' }, 'h1')
    + `<div class="negozio">Negozio Shopify · <span lang="en">Shopify store</span>: <span class="acc">${esc(o.shop)}</span></div>`
    + (o.esito ? avviso(ESITI_SCELTA[o.esito], 'err') : '')

  // GIA' DENTRO: un clic, col nome del conto scritto sul pulsante.
  if (o.conto && !o.altroAccount) {
    const nome = `${o.conto.ragioneSociale || 'il tuo conto'}${o.conto.codiceCliente ? ` (${o.conto.codiceCliente})` : ''}`
    const nomeEn = `${o.conto.ragioneSociale || 'your account'}${o.conto.codiceCliente ? ` (${o.conto.codiceCliente})` : ''}`
    return pagina(testa
      + due({ it: 'Sei già entrato in MoovExpress', en: 'You are already signed in to MoovExpress' }, 'h2')
      + due({
        it: `Gli ordini del negozio arriveranno nel conto ${nome}, ai prezzi del suo listino, e il tracking tornerà su Shopify a spedizione fatta.`,
        en: `The store's orders will arrive in the account ${nomeEn}, at its price list, and tracking will go back to Shopify once shipped.`,
      })
      + modulo('conferma', o.conto.gettone, pulsante(`Collega ${o.shop} al conto ${nome}`, `Connect ${o.shop} to the account ${nomeEn}`))
      + `<a class="alt" href="${PAGINA_SCELTA}?altro=1">Usa un altro account<span class="en" lang="en">Use a different account</span></a>`)
  }

  // Vista «Usa un altro account»: i suoi moduli lo dicono al rimando, che altrimenti tornerebbe sul conto gia'
  // aperto (ESITI_DEL_MODULO_ACCEDI).
  const altro = !!o.conto && o.altroAccount

  const creazione = o.creazione.stato === 'si'
    ? due({
      it: 'Creiamo un account MoovExpress per questo negozio: ci entrerai aprendo MoovExpress dall\'admin di Shopify, senza password. Al primo accesso ti chiederemo l\'indirizzo di ritiro e i dati per la fattura.',
      en: 'We will create a MoovExpress account for this store: you will enter it by opening MoovExpress from your Shopify admin, with no password. On first access we will ask for your pickup address and billing details.',
    }) + modulo('crea', o.creazione.gettone, pulsante('No, crea il mio account', 'No, create my account', 'sec'), altro)
    : o.creazione.stato === 'no'
      ? avviso(ESITI_SCELTA.creazione_non_disponibile, 'nota')
      : avviso({
        it: 'Non riusciamo a verificare ora la creazione di un account nuovo: ricarica la pagina tra qualche istante.',
        en: 'We cannot check right now whether a new account can be created: please reload this page in a moment.',
      }, 'nota')

  return pagina(testa
    + (o.nota ? avviso(NOTE_SESSIONE[o.nota], 'nota') : '')
    + due({ it: 'Hai già un account MoovExpress?', en: 'Do you already have a MoovExpress account?' }, 'h2')
    + due({
      it: 'Accedi con l\'account del conto che spedisce per questo negozio: il negozio verrà collegato a quel conto, ai prezzi del suo listino.',
      en: 'Sign in with the account that ships for this store: the store will be connected to that account, at its price list.',
    })
    + modulo('accedi', o.gettoneAccedi,
      `<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="200">`
      + `<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">`
      + pulsante('Sì, accedo', 'Yes, sign me in'), altro)
    + '<hr class="sep">'
    + due({ it: 'Non hai un account?', en: 'No account yet?' }, 'h2')
    + creazione
    + (o.conto ? `<a class="alt" href="${PAGINA_SCELTA}">Torna al conto con cui sei entrato<span class="en" lang="en">Back to the account you are signed in with</span></a>` : ''))
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
    due({ it: 'Sei già dentro MoovExpress', en: 'You are already signed in to MoovExpress' }, 'h1')
    + `<div class="negozio">Negozio Shopify · <span lang="en">Shopify store</span>: <span class="acc">${esc(o.shop)}</span></div>`
    + due({
      it: `In questo browser sei dentro come ${nome}. Vuoi uscire ed entrare nel conto del negozio ${o.shop}?`,
      en: `On this browser you are signed in as ${nomeEn}. Do you want to sign out and enter the account of the store ${o.shop}?`,
    })
    + `<form method="post" action="${PAGINA_ENTRA}"><input type="hidden" name="shop" value="${esc(o.shop)}"><input type="hidden" name="gettone" value="${esc(o.gettone)}">`
    + pulsante('Esci ed entra nel conto del negozio', 'Sign out and enter the store account') + '</form>'
    + `<a class="alt" href="/">No, resta dentro come ${esc(nome)}<span class="en" lang="en">No, stay signed in as ${esc(nomeEn)}</span></a>`
    + '<hr class="sep">'
    + due({
      it: 'Preferisci uscire da solo? Esci da questo account (voce «Esci» del portale), poi riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App).',
      en: 'Prefer to sign out yourself? Sign out of this account («Esci» in the portal menu), then open MoovExpress again from your Shopify admin (Apps menu).',
    }),
    'Entra nel conto del negozio',
  )
}

// La conferma non vale piu' (scaduta, gia' usata, un'altra sessione, il negozio scollegato nel frattempo) o non
// si e' potuta verificare. Nessun dettaglio: la strada e' la stessa, riaprire l'app da Shopify, che rifa' i
// controlli da capo.
export function paginaIngressoNonConfermato(motivo: 'non_valida' | 'temporaneo'): NextResponse {
  if (motivo === 'temporaneo') {
    return pagina(
      due({ it: 'Problema temporaneo', en: 'Temporary problem' }, 'h1')
      + due({
        it: 'Non siamo riusciti a completare l\'ingresso per un problema temporaneo. Riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App) tra qualche istante.',
        en: 'We could not complete the sign-in because of a temporary problem. Please open MoovExpress again from your Shopify admin (Apps menu) in a moment.',
      }),
      'Entra nel conto del negozio',
      503,
    )
  }
  return pagina(
    due({ it: 'Conferma non più valida', en: 'Confirmation no longer valid' }, 'h1')
    + due({
      it: 'Per sicurezza la conferma vale pochi minuti, una volta sola e solo con l\'account con cui eri dentro quando l\'hai vista. Riapri MoovExpress dall\'admin del tuo negozio Shopify (menu App) per entrare.',
      en: 'For your security, the confirmation is valid for a few minutes, only once and only with the account you were signed in with when you saw it. Open MoovExpress again from your Shopify admin (Apps menu) to sign in.',
    }),
    'Entra nel conto del negozio',
    403,
  )
}
