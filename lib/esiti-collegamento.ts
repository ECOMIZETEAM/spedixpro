// ESITI DEI COLLEGAMENTI DEI NEGOZI, COME LI LEGGE IL CLIENTE.
//
// Le rotte che collegano un negozio (OAuth di Shopify, eBay, TikTok Shop, Temu) e l'ingresso da
// Shopify finiscono con un redirect verso il portale cliente, e l'esito lo scrivono nell'indirizzo:
// ?error=<codice> oppure ?connected=<negozio>. Fino al 20/10/2026 nessuna pagina li leggeva, tranne il
// modulo di accesso per quattro codici: chi collegava un negozio gia' di un altro account tornava su
// «Negozi collegati» senza una riga di spiegazione, e Shopify boccia le app con messaggi d'errore poco
// chiari («Make sure your error messages are clear and informative», pass-app-review).
//
// Nell'indirizzo viaggia SOLO un codice, mai una frase. Le rotte ci scrivevano il testo italiano e
// perfino il messaggio tecnico del fornitore (e.message dello scambio token): mostrarlo cosi' com'e'
// vorrebbe dire che chiunque, con un link confezionato, fa dire al portale quello che vuole. I codici
// di ?error= e ?connected= si traducono QUI, in un posto solo, per tutte le pagine che li mostrano; un
// codice sconosciuto diventa il messaggio generico, mai il testo ricevuto.
//
// Nessuna dipendenza: lo importano rotte, pagine e middleware.

export const PARAM_ERRORE = 'error'
export const PARAM_COLLEGATO = 'connected'

// Shopify: l'azione giusta e' sempre riaprire l'app dall'admin del negozio, che rifa' da sola accesso
// e collegamento. Mai «ricollega dalle Integrazioni»: dal 21/10/2026 li' non c'e' piu' il campo del
// dominio scritto a mano (il requisito 2.3.1 lo vieta). Gli errori dei moduli della scelta dell'account
// dopo l'installazione (password sbagliata, conto dello staff...) non passano da qui: restano sulla sua
// pagina (lib/shopify-pagina-scelta.ts).
const SHOPIFY = {
  firma: "Non siamo riusciti a verificare che la richiesta arrivasse da Shopify. Apri MoovExpress dall'admin del tuo negozio Shopify (menu App) per entrare.",
  link_scaduto: "Il link per aprire MoovExpress da Shopify è scaduto e non siamo riusciti a rinnovarlo. Riapri MoovExpress dall'admin del tuo negozio Shopify (menu App); se si ripete, contatta l'assistenza.",
  login_shopify: "Il negozio è collegato, ma l'accesso automatico non è riuscito. Riapri MoovExpress dall'admin del tuo negozio Shopify (menu App) per entrare nel tuo account.",
  collegamento_scaduto: "La richiesta di collegamento è scaduta o era già stata usata. Se il negozio non risulta collegato, riapri MoovExpress dall'admin del tuo negozio Shopify (menu App).",
  collegamento_token: "Shopify non ha confermato l'autorizzazione del negozio. Riprova tra qualche minuto riaprendo MoovExpress dall'admin del tuo negozio Shopify (menu App).",
  permessi_mancanti: "Il negozio non ha concesso tutte le autorizzazioni che servono a MoovExpress per leggere gli ordini e segnarli come spediti. Riapri MoovExpress dall'admin del tuo negozio Shopify (menu App) e accetta tutte le autorizzazioni richieste.",
  negozio_di_altro_account: "Questo negozio Shopify è già collegato a un altro account MoovExpress, quindi non l'abbiamo collegato a questo. Esci da questo account (voce «Esci» del menu) e riapri MoovExpress dall'admin del tuo negozio Shopify: entrerai nell'account a cui il negozio è collegato.",
  collegamento_non_salvato: "Il collegamento del negozio non è stato salvato per un problema temporaneo. Riapri MoovExpress dall'admin del tuo negozio Shopify (menu App) per riprovare; se si ripete, contatta l'assistenza.",
  account_non_creato: "Il negozio ha autorizzato MoovExpress, ma non siamo riusciti a creare il tuo account. Riprova riaprendo MoovExpress dall'admin del tuo negozio Shopify (menu App); se si ripete, contatta l'assistenza.",
  shopify_non_configurato: "Il collegamento con Shopify non è disponibile in questo momento. Riprova più tardi; se si ripete, contatta l'assistenza.",
  // Il negozio e' collegato a un conto che esisteva gia' (collegato con «Ho già un account»): aprendo l'app
  // da Shopify non si entra da soli, si mette la password (decisione di Lorenzo del 21/10/2026, vedi
  // lib/conti-shopify.ts). Il codice arriva anche a chi e' gia' dentro con un altro conto: il middleware lo
  // porta sulla sua dashboard, e la seconda frase e' per lui.
  accedi_per_continuare: "Questo negozio Shopify è collegato al tuo account MoovExpress: per entrare accedi con email e password. Se sei già dentro con un altro account, esci (voce «Esci» del menu) e accedi con quello del negozio.",
  // Il negozio e' collegato a un conto nato dall'installazione di un ALTRO negozio («Collega al conto …»
  // dalla pagina della scelta). Da qui non si entra da soli (lib/accesso-cliente.ts), e quel conto non ha una
  // password da mettere: si entra aprendo l'app dal negozio da cui e' nato. Il nome di quel negozio non si
  // scrive: qui arriva solo un codice, e lo legge anche chi del conto non sa niente.
  apri_dal_negozio_del_conto: "Questo negozio Shopify è collegato a un account MoovExpress creato da un altro negozio Shopify: per entrare apri MoovExpress dall'admin di quel negozio (menu App). Se sei già dentro con un altro account, esci prima (voce «Esci» del menu).",
  // Una lettura o una scrittura non riuscita all'apertura dell'app (database che non risponde): l'ingresso
  // si ferma invece di indovinare, e riaprendo si riprova da capo.
  ingresso_non_riuscito: "Non siamo riusciti ad aprire MoovExpress per un problema temporaneo. Riapri MoovExpress dall'admin del tuo negozio Shopify (menu App) tra qualche minuto; se si ripete, contatta l'assistenza.",
} as const

// Amazon: le rotte amazon/accesso e amazon/callback mandano al modulo di accesso chi arriva da Seller
// Central SENZA sessione. Il testo e' quello che il modulo aveva per questo codice prima che la mappa
// venisse spostata qui: senza la chiave il venditore Amazon leggerebbe il messaggio generico, che gli
// parla di Shopify. Chiave diretta: la forma <negozio>_<motivo> qui sotto vale solo per MARKETPLACE.
const AMAZON = {
  amazon_accedi: "Per collegare il tuo account Amazon accedi qui sotto, poi vai in Integrazioni → Amazon → Collega.",
} as const

// eBay, TikTok Shop e Temu si collegano dal portale: si riprova da «+ Collega negozio».
const MARKETPLACE = {
  ebay: { nome: 'eBay', collegato: 'Account eBay collegato.' },
  tiktok: { nome: 'TikTok Shop', collegato: 'Negozio TikTok Shop collegato.' },
  temu: { nome: 'Temu', collegato: 'Negozio Temu collegato.' },
} as const
const MOTIVI = {
  non_configurato: (p: string) => `Il collegamento con ${p} non è disponibile in questo momento. Riprova più tardi; se si ripete, apri un ticket in Assistenza.`,
  annullato: (p: string) => `Il collegamento con ${p} non è stato completato: l'autorizzazione non è stata concessa. Riprova da «+ Collega negozio» e accetta la richiesta di ${p}.`,
  scaduto: (p: string) => `La richiesta di collegamento con ${p} è scaduta o era già stata usata. Riprova da «+ Collega negozio».`,
  token: (p: string) => `${p} non ha confermato l'autorizzazione. Riprova tra qualche minuto da «+ Collega negozio».`,
  negozio: (p: string) => `Non siamo riusciti a leggere i dati del negozio ${p}. Riprova da «+ Collega negozio»; se si ripete, apri un ticket in Assistenza.`,
  non_salvato: (p: string) => `Il collegamento con ${p} non è stato salvato per un problema temporaneo. Riprova da «+ Collega negozio»; se si ripete, apri un ticket in Assistenza.`,
} as const

// Il messaggio per un codice che questa mappa non conosce. Deve dire cosa fare a tutti e due quelli
// che possono riceverlo: il negoziante Shopify, che spesso non ha una password e rientra solo dall'admin
// del negozio, e chi collega gli altri negozi dal portale. Prima del 20/10 il ripiego del modulo di
// accesso diceva «riprova dal tuo negozio»: un ripiego senza quell'indicazione lascerebbe il negoziante
// davanti a un modulo che non puo' usare (ed e' il ripiego che vede finche' una rotta manda ancora una
// frase al posto del codice).
const GENERICO = "Il collegamento del negozio non è andato a buon fine. Se stavi aprendo MoovExpress da Shopify, riaprilo dall'admin del tuo negozio (menu App); per gli altri negozi riprova da «+ Collega negozio». Se si ripete, contatta l'assistenza."

// Il successo Shopify arriva sia nel portale sia sul modulo di accesso (chi torna senza sessione): la
// frase dice anche come entrare, perche' il negoziante auto-creato una password non ce l'ha.
const SHOPIFY_COLLEGATO = "Negozio Shopify collegato. Se non sei già nel portale, apri MoovExpress dall'admin del tuo negozio Shopify (menu App)."

export type Marketplace = keyof typeof MARKETPLACE
export type CodiceErrore = keyof typeof SHOPIFY | keyof typeof AMAZON | `${Marketplace}_${keyof typeof MOTIVI}`

// Il codice arriva dall'indirizzo: si cerca solo fra le chiavi PROPRIE, cosi' «toString» o
// «__proto__» non pescano nel prototipo. Niente Object.hasOwn: manca nelle WebView iOS piu' vecchie.
const proprio = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// Le rotte costruiscono l'indirizzo d'esito solo da qui. Il tipo ammette i codici e non le frasi, ma lo
// fa valere solo tsc: la build ignora gli errori di tipo (next.config.ts, ignoreBuildErrors), quindi un
// codice scritto male compila lo stesso e a schermo diventa il messaggio generico. Per questo, prima di
// ogni rilascio che tocca queste rotte, i codici usati si confrontano con le chiavi di questo file.
export function conErrore(percorso: string, codice: CodiceErrore): string {
  return `${percorso}?${PARAM_ERRORE}=${encodeURIComponent(codice)}`
}

// Il successo si scrive da qui come l'errore: il nome del parametro e i valori che il portale sa
// tradurre stanno in questo file solo. Shopify manda il dominio del negozio, gli altri il nome.
// A schermo diventa «collegato», quindi si scrive solo quando il negozio risulta collegato al cliente
// di questa richiesta: mai per una riga attiva trovata cercando il solo dominio, che puo' essere di un
// altro cliente (finche' nessuna pagina leggeva ?connected= quell'esito era muto, ora sarebbe falso).
export function conCollegato(percorso: string, valore: Marketplace | `${string}.myshopify.com`): string {
  return `${percorso}?${PARAM_COLLEGATO}=${encodeURIComponent(valore)}`
}

export function messaggioEsito(q: URLSearchParams): { tipo: 'ok' | 'errore'; testo: string } | null {
  const errore = q.get(PARAM_ERRORE)
  if (errore) {
    if (proprio(SHOPIFY, errore)) return { tipo: 'errore', testo: SHOPIFY[errore as keyof typeof SHOPIFY] }
    if (proprio(AMAZON, errore)) return { tipo: 'errore', testo: AMAZON[errore as keyof typeof AMAZON] }
    const m = errore.match(/^([a-z]+)_([a-z_]+)$/)
    if (m && proprio(MARKETPLACE, m[1]) && proprio(MOTIVI, m[2])) {
      return { tipo: 'errore', testo: MOTIVI[m[2] as keyof typeof MOTIVI](MARKETPLACE[m[1] as Marketplace].nome) }
    }
    return { tipo: 'errore', testo: GENERICO }
  }
  const collegato = q.get(PARAM_COLLEGATO)
  if (!collegato) return null
  // Il valore non si mostra mai: serve solo a scegliere la frase.
  if (collegato.endsWith('.myshopify.com')) return { tipo: 'ok', testo: SHOPIFY_COLLEGATO }
  if (proprio(MARKETPLACE, collegato)) return { tipo: 'ok', testo: MARKETPLACE[collegato as Marketplace].collegato }
  return null
}
