import { randomBytes } from 'crypto'
import { API_VERSION } from '@/lib/shopify'
import { inserisciClienteConCodice } from '@/lib/codice-cliente'
import { leggiAccessoDelCliente } from '@/lib/accesso-cliente'
import { emailContoShopify } from '@/lib/indirizzi-interni'
import { masterDeiNegoziShopify } from '@/lib/conti-shopify'
import type { CodiceErrore } from '@/lib/esiti-collegamento'

// IL CONTO DI UN NEGOZIO SHOPIFY: QUALE E', E COME NASCE.
//
// Due domande separate, perche' dal 21/10/2026 hanno due momenti diversi (decisione D1 di Lorenzo):
// - trovaContoDelNegozio: il negozio e' gia' legato a un conto? Lo chiede il callback subito dopo
//   l'autorizzazione. Se si', il negozio si riaggancia li' senza domande (requisito 2.3.4: chi reinstalla
//   rientra subito).
// - creaContoShopify: il conto nuovo sotto il master dei negozi (MOOVY). Solo il ramo «No, crea il mio
//   account» della scelta (app/api/integrazioni/shopify/collega) arriva qui. Fino al 21/10 lo faceva il
//   callback da solo per ogni negozio mai visto: chi aveva gia' un conto se ne ritrovava un secondo, vuoto
//   e sotto un altro master.

// Info negozio via GraphQL Admin API (allineato al requisito app pubblica). Solo quello che si usa: il nome
// e l'indirizzo di fatturazione, che diventa la sede legale da confermare. Email e telefono del negozio non
// si chiedono piu': la sede operativa, il telefono e un'email vera li chiede la schermata del primo accesso
// (lib/dati-negozio.ts), e un dato che non si usa non si legge. `country` e' il NOME del paese, il codice e'
// countryCodeV2 (doc ShopAddress): e' quello che decide se l'indirizzo e' italiano.
async function fetchShopInfo(shop: string, token: string) {
  try {
    const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ shop { name billingAddress { address1 city province provinceCode zip country countryCodeV2 } } }` }),
    })
    const d = await r.json()
    return d?.data?.shop || null
  } catch { return null }
}

// L'errore porta il codice che le rotte scrivono nell'indirizzo (lib/esiti-collegamento.ts); il motivo
// tecnico va solo nei log.
type Errore = { error: string; codice: Extract<CodiceErrore, 'onboarding_non_configurato' | 'account_non_creato' | 'collegamento_non_salvato'> }
type Esito = { clienteId: string; masterId: string } | Errore
type Conto = { id: string; master_id: string; email: string; ragione_sociale?: string | null }

// Il conto a cui va un negozio gia' noto, e, a parte, com'e' il suo accesso: null se e' pronto, altrimenti il
// motivo per cui non lo e'. Sono due fatti diversi e il callback li tratta diversi (vedi trovaContoDelNegozio).
export type ContoDelNegozio = { clienteId: string; masterId: string; accesso: Errore | null }

// 'pronto': l'accesso c'e' sull'indirizzo del negozio, o il conto non e' nato dall'installazione (e allora qui
// non si tocca). 'preparato': c'e' su un ALTRO indirizzo, e il negozio non deve andare a questo conto.
// 'mancante': non si e' potuto leggere o creare; il conto e' quello giusto, e' l'accesso che manca.
type StatoAccesso = { esito: 'pronto' } | { esito: 'preparato' | 'mancante'; errore: Errore }

// UNA LETTURA FALLITA NON E' UNA RIGA CHE NON C'E'.
//
// Qui ogni «non trovato» porta verso la scelta dell'account e, da li', verso un conto nuovo o un altro
// conto. Un errore di lettura (timeout, rete) preso per «non c'e'» farebbe passare il negozio di un cliente
// vero a un conto diverso, con i suoi ordini e i dati dei compratori: la revisione del 20/10 lo ha
// riprodotto, senza rete, sulla prima stesura di questa funzione. Ci si ferma senza creare niente: il
// callback esce prima di toccare l'integrazione e il giro dopo riprova. Vale anche per due righe dello
// stesso negozio (maybeSingle da' errore): meglio fermo e scritto nei log che agganciato a caso.
const letturaFallita = (cosa: string, e: { message?: string } | null): Errore =>
  ({ error: `lettura ${cosa}: ${e?.message || 'errore'}`, codice: 'collegamento_non_salvato' })

// MASTER E LISTINO DEI NEGOZI NUOVI: solo dalle variabili d'ambiente, senza ripieghi.
//
// Fino al 20/10/2026, senza SHOPIFY_ONBOARDING_MASTER_ID il master era «la prima radice», letta senza
// ordine: delle 7 radici, 6 erano demo, e usciva il super master solo per l'ordine fisico delle righe.
// Su una demo scaduta il negozio avrebbe preso 402 a ogni scrittura, su una attiva le integrazioni
// vietate, e in tutti e due i casi il titolare della demo avrebbe visto gli ordini del negozio. Senza
// SHOPIFY_ONBOARDING_LISTINO_ID il listino si cercava per nome ("standard shopify"). Decisione di
// Lorenzo del 20/10: se ne manca una, l'installazione si ferma e non nasce nessun conto.
//
// I due valori si scrivono a mano su Vercel, quindi si controllano anche quando ci sono: il master deve
// esistere e non essere una demo, il listino deve essere SUO e attivo. Il motore dei prezzi usa il
// listino del cliente senza guardare di chi e': con quello di un'altra rete il cliente pagherebbe i
// prezzi di quella, il suo master pagherebbe il padre col proprio listino (anche sotto costo) e non lo
// troverebbe fra i listini che gestisce. Il 20/10 tutti i 1.833 clienti con un listino avevano quello
// del proprio master, attivo: e' la regola che i dati gia' rispettano.
//
// ...E DEVONO POTER SPEDIRE (21/10/2026). Un conto nato sotto un master spento, o con un listino senza
// nemmeno una fascia, entra nel portale e non vede nessuna tariffa; un master con un padre ma senza listino
// d'acquisto (parent_listino_id) fa rispondere «configurazione incompleta» a ogni spedizione dei suoi
// clienti. Il 21/10 due master attivi con un padre non avevano il listino d'acquisto, e il listino dei
// negozi di MOOVY nasce vuoto finche' Lorenzo non lo prezza: con le variabili gia' impostate i negozi
// nascerebbero in un portale che non spedisce. Il listino d'acquisto si chiede solo a chi ha un padre: la
// radice non compra da nessuno.
//
// Un valore che non torna ferma l'installazione come uno mancante. Una lettura fallita no: e' un guasto
// passeggero come gli altri di questo file (letturaFallita), e dirlo «configurazione non valida» manderebbe
// a cercare su Vercel un errore che non c'e'. Qui non si scrive nei log: lo fa chi ferma davvero una
// creazione (creaContoShopify), non la pagina della scelta che si limita a non offrirla.
async function configurazioneOnboarding(admin: any): Promise<{ masterId: string; listinoId: string } | Errore> {
  const masterId = masterDeiNegoziShopify() || ''
  const listinoId = (process.env.SHOPIFY_ONBOARDING_LISTINO_ID || '').trim()
  if (!masterId || !listinoId) {
    const mancano = [!masterId && 'SHOPIFY_ONBOARDING_MASTER_ID', !listinoId && 'SHOPIFY_ONBOARDING_LISTINO_ID'].filter(Boolean).join(' e ')
    return { error: `variabili d'onboarding mancanti: ${mancano}`, codice: 'onboarding_non_configurato' }
  }
  const [{ data: master, error: eM }, { data: listino, error: eL }, { data: fasce, error: eF }] = await Promise.all([
    admin.from('masters').select('id,demo,attivo,parent_master_id,parent_listino_id').eq('id', masterId).maybeSingle(),
    admin.from('listini_clienti').select('master_id,attivo').eq('id', listinoId).maybeSingle(),
    admin.from('listini_clienti_fasce').select('id').eq('listino_id', listinoId).limit(1),
  ])
  if (eM || eL || eF) return letturaFallita('configurazione d\'onboarding', eM || eL || eF)
  const motivo = !master ? 'SHOPIFY_ONBOARDING_MASTER_ID non e\' un master'
    : master.demo === true ? 'SHOPIFY_ONBOARDING_MASTER_ID e\' un master demo'
    : master.attivo === false ? 'SHOPIFY_ONBOARDING_MASTER_ID e\' un master spento'
    : master.parent_master_id && !master.parent_listino_id ? 'SHOPIFY_ONBOARDING_MASTER_ID non ha un listino d\'acquisto (parent_listino_id)'
    : !listino ? 'SHOPIFY_ONBOARDING_LISTINO_ID non e\' un listino clienti'
    : listino.master_id !== masterId ? 'SHOPIFY_ONBOARDING_LISTINO_ID e\' il listino di un altro master'
    : listino.attivo === false ? 'SHOPIFY_ONBOARDING_LISTINO_ID non e\' attivo'
    : !fasce?.length ? 'SHOPIFY_ONBOARDING_LISTINO_ID non ha nessuna fascia di prezzo'
    : null
  if (motivo) return { error: `onboarding non valido: ${motivo}`, codice: 'onboarding_non_configurato' }
  return { masterId, listinoId }
}

// Il pulsante «No, crea il mio account» si mostra solo se la creazione puo' riuscire. 'non_so' e' una
// lettura fallita: la pagina lo dice diverso da «non ancora disponibile», che e' una configurazione.
export async function creazioneContoDisponibile(admin: any): Promise<'si' | 'no' | 'non_so'> {
  const c = await configurazioneOnboarding(admin)
  if (!('error' in c)) return 'si'
  return c.codice === 'onboarding_non_configurato' ? 'no' : 'non_so'
}

// Password dell'utente di login del negoziante. Non la usa mai (entra col magic link), ma esiste e
// apre il modulo /cliente: deve essere un segreto vero. Prima era 'Sh0p!' + due Math.random(), che non
// e' un generatore crittografico (INST-12): 256 bit da randomBytes; il prefisso tiene dentro maiuscola,
// cifra e simbolo per qualunque regola di robustezza del pannello. 48 caratteri, sotto il limite di 72.
function passwordCasuale(): string {
  return 'Sh0p!' + randomBytes(32).toString('base64url')
}

// UN CONTO CREATO DALL'INSTALLAZIONE SENZA ACCESSO NON SI LASCIA COSI'.
//
// Il negoziante entra solo con l'accesso automatico: un conto senza utente di login e' un vicolo
// cieco (NMC-12). Prima gli errori di createUser e dell'insert in `utenti` non si leggevano. Ora si
// leggono, e questa funzione si richiama ogni volta che il negozio ripassa dall'autorizzazione, non
// solo alla prima: se l'accesso non e' nato (errore temporaneo di Supabase Auth), /enter alla riapertura
// trova il conto senza accesso, rimanda all'OAuth e qui l'accesso nasce, senza cancellare niente. Il
// token del negozio intanto si salva lo stesso, se il negozio era gia' legato al conto (trovaContoDelNegozio).
// Vale SOLO per il conto con l'indirizzo costruito per QUESTO negozio (lib/indirizzi-interni.ts), che
// e' sul nostro dominio: un cliente vero che ha collegato il suo negozio con «Ho già un account» ha
// l'accesso che gli ha dato il suo master, e qui non si tocca.
//
// ...E SE L'ACCESSO C'E', DEV'ESSERE SU QUELL'INDIRIZZO. L'accesso del conto di un negozio nasce solo
// qui, e sull'indirizzo del negozio. Uno su un altro indirizzo vuol dire che l'indirizzo e' stato
// scritto dopo su un cliente che aveva gia' il suo login (vedi masterDellInstallazione): riagganciare
// quel conto farebbe entrare il negoziante, e arrivare ordini e compratori del negozio, nel conto di
// chi l'ha scritto: e' l'esito 'preparato'. Una lettura fallita dell'accesso e' 'mancante', con il motivo
// (letturaFallita): chi chiama decide se fermarsi.
async function assicuraAccesso(admin: any, cli: Conto, shop: string): Promise<StatoAccesso> {
  const indirizzo = emailContoShopify(shop)
  if (String(cli.email || '').trim().toLowerCase() !== indirizzo) return { esito: 'pronto' }
  const accesso = await leggiAccessoDelCliente(admin, cli.id)
  if (accesso.esito === 'illeggibile') return { esito: 'mancante', errore: letturaFallita('accesso del conto', { message: accesso.motivo }) }
  if (accesso.esito === 'presente') {
    if (accesso.email === indirizzo) return { esito: 'pronto' }
    console.error('[SHOPIFY][PROVISION] conto con l\'indirizzo del negozio ma con un accesso su un altro indirizzo: non riagganciato', shop, cli.id)
    return { esito: 'preparato', errore: { error: 'il conto ha un accesso su un altro indirizzo', codice: 'account_non_creato' } }
  }
  if (accesso.anomalia) console.error('[SHOPIFY][PROVISION]', shop, cli.id, accesso.anomalia, '— accesso ricreato')
  const { data: au, error: aErr } = await admin.auth.admin.createUser({ email: indirizzo, password: passwordCasuale(), email_confirm: true })
  if (aErr || !au?.user) {
    console.error('[SHOPIFY][PROVISION] accesso non creato', shop, cli.id, aErr?.message)
    return { esito: 'mancante', errore: { error: `createUser: ${aErr?.message || 'nessun utente'}`, codice: 'account_non_creato' } }
  }
  const { error: uErr } = await admin.from('utenti').insert({
    id: au.user.id, ruolo: 'cliente', master_id: cli.master_id, cliente_id: cli.id,
    nome: cli.ragione_sociale || shop, attivo: true,
  })
  if (uErr) {
    // Senza la riga in `utenti` l'utente di login entrerebbe in un portale senza menu: si toglie, cosi'
    // il giro dopo lo ricrea pulito. deleteUser restituisce l'errore, non lo lancia: va letto.
    const { error: dErr } = await admin.auth.admin.deleteUser(au.user.id)
    console.error('[SHOPIFY][PROVISION] riga utenti non creata', shop, cli.id, uErr.message,
      dErr ? `— E L'UTENTE DI LOGIN E' RIMASTO (${au.user.id}): ${dErr.message}` : '— utente di login tolto')
    return { esito: 'mancante', errore: { error: `utenti: ${uErr.message}`, codice: 'account_non_creato' } }
  }
  return { esito: 'pronto' }
}

// UN CONTO RITROVATO PER INDIRIZZO SI RIAGGANCIA SOLO SE E' NATO DALL'INSTALLAZIONE.
//
// L'indirizzo <negozio>@shopify.moovexpress.com si puo' scrivere su un cliente che esiste gia' senza
// passare dalla creazione, che lo rifiuta (lib/codice-cliente.ts): il cliente stesso con una PATCH
// diretta a PostgREST sulla sua riga (clienti_rls gliela da' anche in scrittura, e al 16/09 nessun
// trigger di `clienti` guardava l'email), il suo master col cambio email della scheda
// (app/api/clienti/[id]/route.ts). Il nome di un negozio e' pubblico: chi preparasse cosi' il conto
// prima che il negozio installi se lo vedrebbe consegnare (revisione del 20/10). Si riaggancia solo un
// conto del master d'onboarding o del super master, che e' dove l'installazione li creava fino al 20/10
// (la «prima radice»: i 3 conti di luglio stanno li', verificato il 20/10); per gli altri master nessuna
// scrittura e il motivo nei log. Che il conto non abbia un accesso su un altro indirizzo lo controlla
// assicuraAccesso. Se il master d'onboarding un giorno cambia, i conti nati sotto quello di prima non si
// riagganciano piu' da soli: il log lo dice, e il master va aggiunto qui.
async function masterDellInstallazione(admin: any, cli: Conto, shop: string): Promise<Errore | null> {
  if (cli.master_id === masterDeiNegoziShopify()) return null
  const { data: m, error } = await admin.from('masters').select('is_super_master').eq('id', cli.master_id).maybeSingle()
  if (error) return letturaFallita('master del conto ritrovato', error)
  if (m?.is_super_master === true) return null
  console.error('[SHOPIFY][PROVISION] conto con l\'indirizzo del negozio sotto un master che non crea conti Shopify: non riagganciato', shop, cli.id, cli.master_id)
  return { error: 'conto ritrovato per indirizzo fuori dai master dell\'installazione', codice: 'account_non_creato' }
}

// IL NEGOZIO E' GIA' LEGATO A UN CONTO? null = mai visto: allora decide il negoziante, con la scelta.
//
// Due strade, con le guardie di prima: la riga integrazioni del negozio (in qualunque stato: dopo una
// disinstallazione resta 'disconnesso' col suo cliente, e chi reinstalla deve rientrare li'), e il conto
// nato dall'installazione ritrovato per indirizzo (dopo uno shop/redact la riga non c'e' piu'). Nessuna
// delle due guarda chi c'e' nel browser: il negozio va al suo conto, e chi puo' entrarci lo decide
// l'ingresso (lib/accesso-cliente.ts, regola D5). L'email di login la sceglie chi fa entrare il
// negoziante, non questa funzione: qui si decide solo QUALE cliente e se ha un accesso.
//
// UN ERRORE VUOL DIRE «NON SCRIVERE NIENTE»; UN ACCESSO CHE MANCA NO. Per un negozio legato da una riga, lo
// scambio del codice appena fatto nel callback ha gia' ritirato il refresh token salvato su quella riga: il
// token nuovo va salvato anche se l'accesso del conto non si ripara, altrimenti un collegamento vivo si
// spegne entro un'ora (revisione del 21/10). Per questo l'accesso torna a parte, in `accesso`. L'unico caso
// in cui il negozio non si scrive e' il conto 'preparato' (accesso su un altro indirizzo). Per il conto
// ritrovato per indirizzo invece ogni problema d'accesso resta un errore, come prima: li' non c'e' un
// collegamento vivo da tenere, e senza accesso nessuno entrerebbe in quel conto.
// La riga del negozio la scrive solo la piattaforma: il database rifiuta le scritture fatte con la sessione di
// un utente (scripts/shopify-installazioni-in-sospeso.sql). Fino al 21/10 un cliente poteva crearsela per il
// negozio di un altro, e qui sarebbe sembrato un negozio gia' suo.
export async function trovaContoDelNegozio(admin: any, shop: string): Promise<ContoDelNegozio | Errore | null> {
  // Niente embed `clienti(email)`: `integrazioni` non ha foreign key, quindi PostgREST non lo sa
  // risolvere e la select falliva in silenzio.
  const { data: integr, error: eInt } = await admin.from('integrazioni')
    .select('cliente_id').eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  if (eInt) return letturaFallita('integrazione', eInt)
  if (integr?.cliente_id) {
    const { data: cli, error: eCli } = await admin.from('clienti')
      .select('id,master_id,email,ragione_sociale').eq('id', integr.cliente_id).maybeSingle()
    if (eCli) return letturaFallita('cliente dell\'integrazione', eCli)
    // `integrazioni` non ha foreign key: la riga puo' puntare a un cliente che non c'e' piu'. Prima si
    // tornava quell'id e il negozio finiva agganciato a un cliente inesistente; ora lo si tratta come
    // un negozio mai visto (il collegamento riprende la riga: lib/shopifyCollega.ts). Solo se la lettura
    // e' riuscita e il cliente non c'e' davvero (vedi letturaFallita).
    if (cli) {
      const a = await assicuraAccesso(admin, cli, shop)
      if (a.esito === 'preparato') return a.errore
      return { clienteId: cli.id, masterId: cli.master_id, accesso: a.esito === 'mancante' ? a.errore : null }
    }
    console.error('[SHOPIFY][PROVISION] integrazione verso un cliente che non esiste piu', shop, integr.cliente_id)
  }

  // RIGA INTEGRAZIONE SPARITA, MA IL CLIENTE C'E' ANCORA.
  //
  // Succede dopo uno `shop/redact`: quel webhook cancella l'integrazione (obbligo GDPR) ma NON il
  // cliente, che ha spedizioni e movimenti suoi e non si tocca. Se lo stesso negozio reinstalla,
  // il controllo qui sopra non trova piu' l'integrazione e si passava dritti alla creazione di un
  // cliente NUOVO — con la stessa email derivata dal dominio, che ha un vincolo di unicita':
  // l'insert falliva e l'installazione moriva con un errore incomprensibile.
  // L'email e' derivata dal dominio del negozio, quindi e' la chiave giusta per ritrovarlo. Un conto
  // che esiste gia' si riaggancia anche senza le variabili d'onboarding: non nasce niente. Ma solo se
  // e' nato dall'installazione (masterDellInstallazione, poi assicuraAccesso): l'indirizzo lo puo'
  // scrivere anche chi non dovrebbe. Un conto vero collegato con «Ho già un account» non ha questo
  // indirizzo: dopo uno shop/redact il suo negozio torna mai visto, e il negoziante rifa' la scelta.
  const { data: gia, error: eGia } = await admin.from('clienti')
    .select('id,master_id,email,ragione_sociale').eq('email', emailContoShopify(shop)).maybeSingle()
  if (eGia) return letturaFallita('cliente per indirizzo', eGia)
  if (gia?.id) {
    const fuori = await masterDellInstallazione(admin, gia, shop)
    if (fuori) return fuori
    const a = await assicuraAccesso(admin, gia, shop)
    if (a.esito !== 'pronto') return a.errore
    return { clienteId: gia.id, masterId: gia.master_id, accesso: null }
  }
  return null
}

// Il paese della sede legale. 'Italia' e' il valore che usa tutto il portale (e la schermata del primo
// accesso precompila la sede solo se e' italiana): con `country` si scriveva il nome inglese che manda
// Shopify, e un conto di luglio ha 'Philippines'. Per un paese estero resta il nome, che non si confonde
// con l'Italia; senza indirizzo, 'Italia' come il valore predefinito della colonna.
function paeseDaShopify(addr: any): string {
  const codice = String(addr?.countryCodeV2 || '').trim().toUpperCase()
  if (codice === 'IT') return 'Italia'
  return String(addr?.country || '').trim() || codice || 'Italia'
}

// Crea il conto di un negozio che non ne aveva uno, sotto il master dei negozi, e il suo accesso. Lo
// chiama solo il ramo «No, crea il mio account» della scelta, dopo aver consumato l'installazione in
// sospeso (lib/shopifyCollega.ts): due clic non creano due conti.
export async function creaContoShopify(admin: any, shop: string, token: string): Promise<Esito> {
  const onboarding = await configurazioneOnboarding(admin)
  if ('error' in onboarding) {
    console.error('[SHOPIFY][PROVISION] installazione ferma, nessun conto creato:', onboarding.error)
    return onboarding
  }
  const { masterId, listinoId } = onboarding

  const info = await fetchShopInfo(shop, token)
  const nome = info?.name || shop.replace('.myshopify.com', '')
  const addr = info?.billingAddress || {}
  const email = emailContoShopify(shop)

  // L'indirizzo e' interno (lib/indirizzi-interni.ts): fra le porte che CREANO clienti e' l'unica che
  // lo puo' dare, e lo dichiara a inserisciClienteConCodice, che lo rifiuta a tutte le altre. Chi lo
  // scrive su un cliente gia' esistente non passa da li': per questo il conto ritrovato per indirizzo,
  // in trovaContoDelNegozio, si riaggancia solo coi suoi controlli.
  const { data: nuovo, error } = await inserisciClienteConCodice(admin, {
    master_id: masterId,
    ragione_sociale: nome,
    email,
    // SOLO LA SEDE LEGALE, E COME PROPOSTA. Fino al 21/10/2026 l'indirizzo di fatturazione di Shopify
    // finiva anche nella sede operativa, telefono compreso: e' il mittente di ogni spedizione, e un
    // negozio che fattura da un indirizzo e spedisce da un magazzino si vedeva ritirare i pacchi nel
    // posto sbagliato, senza che nessuno glielo chiedesse. Il 9/09 i conti nati cosi' non avevano
    // spedito niente. Ora sede operativa e telefono li chiede la schermata del primo accesso, che a
    // questi conti compare finche' non sono completi (decisione D2 di Lorenzo; lib/dati-negozio.ts):
    // l'indirizzo di fatturazione resta qui sotto, nella sede legale, come proposta da confermare.
    // Telefono e sede operativa vuoti: la colonna so_paese prende da sola 'Italia'.
    sl_paese: paeseDaShopify(addr), sl_indirizzo: addr.address1 || null,
    sl_citta: addr.city || null, sl_provincia: addr.provinceCode || addr.province || null, sl_cap: addr.zip || null,
    listino_cliente_id: listinoId,
    // Le impostazioni dei clienti creati dal portale (app/api/clienti/crea: etichetta 10x11, deciso il
    // 18/9), piu' il segno che fa comparire la schermata del primo accesso anche quando i campi sembrano
    // pieni: il negoziante deve confermare almeno una volta. Lo toglie la schermata quando salva.
    impostazioni: { formato_stampa: '10x11', sede_da_completare: true },
    tipo_contratto: 'credito_scalare',
    aliquota_iva: '22',
    attivo: true,
  }, 'id', { indirizzoInterno: true })
  if (error?.code === '23505' && String(error.message || '').includes('clienti_email_key')) {
    // DUE CREAZIONI DELLO STESSO NEGOZIO INSIEME: fra la scelta e questo insert il conto con lo stesso
    // indirizzo e' nato altrove. Questa si ferma senza toccare niente. Riusare quel conto da qui faceva
    // salvare il negozio a tutte e due le richieste (revisione del 20/10). Alla riapertura dell'app il
    // conto si ritrova per indirizzo, coi controlli di trovaContoDelNegozio.
    return { error: 'conto creato da un\'altra installazione simultanea', codice: 'collegamento_non_salvato' }
  }
  if (error || !nuovo) {
    return { error: `cliente: ${error?.code || ''} ${error?.message || 'insert senza riga'}`.trim(), codice: 'account_non_creato' }
  }
  const a = await assicuraAccesso(admin, { id: nuovo.id, master_id: masterId, email, ragione_sociale: nome }, shop)
  return a.esito === 'pronto' ? { clienteId: nuovo.id, masterId } : a.errore
}
