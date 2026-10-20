import { randomBytes } from 'crypto'
import { API_VERSION } from '@/lib/shopify'
import { inserisciClienteConCodice } from '@/lib/codice-cliente'
import { leggiAccessoDelCliente } from '@/lib/accesso-cliente'
import { emailContoShopify } from '@/lib/indirizzi-interni'
import type { CodiceErrore } from '@/lib/esiti-collegamento'

// Info negozio via GraphQL Admin API (allineato al requisito app pubblica).
async function fetchShopInfo(shop: string, token: string) {
  try {
    const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ shop { name email billingAddress { address1 city province provinceCode zip country phone } } }` }),
    })
    const d = await r.json()
    return d?.data?.shop || null
  } catch { return null }
}

// L'errore porta il codice che il callback scrive nell'indirizzo (lib/esiti-collegamento.ts); il
// motivo tecnico va solo nei log.
type Errore = { error: string; codice: Extract<CodiceErrore, 'onboarding_non_configurato' | 'account_non_creato' | 'collegamento_non_salvato'> }
type Esito = { clienteId: string; masterId: string } | Errore
type Conto = { id: string; master_id: string; email: string; ragione_sociale?: string | null }

// UNA LETTURA FALLITA NON E' UNA RIGA CHE NON C'E'.
//
// In questa funzione ogni «non trovato» porta verso la creazione di un conto nuovo, e il callback poi
// aggiorna la riga integrazioni del negozio col conto che esce da qui. Un errore di lettura (timeout,
// rete) preso per «non c'e'» farebbe nascere un conto sotto il master d'onboarding e gli passerebbe il
// negozio di un cliente vero, con i suoi ordini e i dati dei compratori: la revisione del 20/10 lo ha
// riprodotto, senza rete, sulla prima stesura di questa funzione. Ci si ferma senza creare niente: il
// callback esce prima di toccare l'integrazione e il giro dopo riprova. Vale anche per due righe dello
// stesso negozio (maybeSingle da' errore, e su `integrazioni` non c'e' un vincolo unico): meglio fermo
// e scritto nei log che agganciato a caso.
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
// del proprio master, attivo: e' la regola che i dati gia' rispettano. Un valore che non torna ferma
// l'installazione come uno mancante. Una lettura fallita no: e' un guasto passeggero come gli altri di
// questa funzione (letturaFallita), e dirlo «configurazione non valida» manderebbe a cercare su Vercel
// un errore che non c'e'.
async function configurazioneOnboarding(admin: any): Promise<{ masterId: string; listinoId: string } | Errore> {
  const masterId = (process.env.SHOPIFY_ONBOARDING_MASTER_ID || '').trim()
  const listinoId = (process.env.SHOPIFY_ONBOARDING_LISTINO_ID || '').trim()
  if (!masterId || !listinoId) {
    console.error('[SHOPIFY][PROVISION] installazione ferma, nessun conto creato: variabili d\'onboarding mancanti', {
      SHOPIFY_ONBOARDING_MASTER_ID: masterId ? 'presente' : 'MANCANTE',
      SHOPIFY_ONBOARDING_LISTINO_ID: listinoId ? 'presente' : 'MANCANTE',
    })
    return { error: 'variabili d\'onboarding mancanti', codice: 'onboarding_non_configurato' }
  }
  const [{ data: master, error: eM }, { data: listino, error: eL }] = await Promise.all([
    admin.from('masters').select('id,demo').eq('id', masterId).maybeSingle(),
    admin.from('listini_clienti').select('master_id,attivo').eq('id', listinoId).maybeSingle(),
  ])
  if (eM || eL) return letturaFallita('configurazione d\'onboarding', eM || eL)
  const motivo = !master ? 'SHOPIFY_ONBOARDING_MASTER_ID non e\' un master'
    : master.demo === true ? 'SHOPIFY_ONBOARDING_MASTER_ID e\' un master demo'
    : !listino ? 'SHOPIFY_ONBOARDING_LISTINO_ID non e\' un listino clienti'
    : listino.master_id !== masterId ? 'SHOPIFY_ONBOARDING_LISTINO_ID e\' il listino di un altro master'
    : listino.attivo === false ? 'SHOPIFY_ONBOARDING_LISTINO_ID non e\' attivo'
    : null
  if (motivo) {
    console.error('[SHOPIFY][PROVISION] installazione ferma, nessun conto creato: configurazione d\'onboarding non valida', motivo)
    return { error: `onboarding non valido: ${motivo}`, codice: 'onboarding_non_configurato' }
  }
  return { masterId, listinoId }
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
// solo alla prima: se l'accesso non e' nato (errore temporaneo di Supabase Auth), l'integrazione non
// si salva, /enter alla riapertura rimanda all'OAuth e qui l'accesso nasce, senza cancellare niente.
// Vale SOLO per il conto con l'indirizzo costruito per QUESTO negozio (lib/indirizzi-interni.ts), che
// e' sul nostro dominio: un cliente vero che ha collegato il suo negozio dalle Integrazioni ha
// l'accesso che gli ha dato il suo master, e qui non si tocca.
//
// ...E SE L'ACCESSO C'E', DEV'ESSERE SU QUELL'INDIRIZZO. L'accesso del conto di un negozio nasce solo
// qui, e sull'indirizzo del negozio. Uno su un altro indirizzo vuol dire che l'indirizzo e' stato
// scritto dopo su un cliente che aveva gia' il suo login (vedi masterDellInstallazione): riagganciare
// quel conto farebbe entrare il negoziante, e arrivare ordini e compratori del negozio, nel conto di
// chi l'ha scritto. Ci si ferma col motivo nei log, e una lettura fallita dell'accesso ferma come le
// altre (letturaFallita). Restituisce l'errore, se non riesce.
async function assicuraAccesso(admin: any, cli: Conto, shop: string): Promise<Errore | null> {
  const indirizzo = emailContoShopify(shop)
  if (String(cli.email || '').trim().toLowerCase() !== indirizzo) return null
  const accesso = await leggiAccessoDelCliente(admin, cli.id)
  if (accesso.esito === 'illeggibile') return letturaFallita('accesso del conto', { message: accesso.motivo })
  if (accesso.esito === 'presente') {
    if (accesso.email === indirizzo) return null
    console.error('[SHOPIFY][PROVISION] conto con l\'indirizzo del negozio ma con un accesso su un altro indirizzo: non riagganciato', shop, cli.id)
    return { error: 'il conto ha un accesso su un altro indirizzo', codice: 'account_non_creato' }
  }
  if (accesso.anomalia) console.error('[SHOPIFY][PROVISION]', shop, cli.id, accesso.anomalia, '— accesso ricreato')
  const { data: au, error: aErr } = await admin.auth.admin.createUser({ email: indirizzo, password: passwordCasuale(), email_confirm: true })
  if (aErr || !au?.user) {
    console.error('[SHOPIFY][PROVISION] accesso non creato', shop, cli.id, aErr?.message)
    return { error: `createUser: ${aErr?.message || 'nessun utente'}`, codice: 'account_non_creato' }
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
    return { error: `utenti: ${uErr.message}`, codice: 'account_non_creato' }
  }
  return null
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
  if (cli.master_id === (process.env.SHOPIFY_ONBOARDING_MASTER_ID || '').trim()) return null
  const { data: m, error } = await admin.from('masters').select('is_super_master').eq('id', cli.master_id).maybeSingle()
  if (error) return letturaFallita('master del conto ritrovato', error)
  if (m?.is_super_master === true) return null
  console.error('[SHOPIFY][PROVISION] conto con l\'indirizzo del negozio sotto un master che non crea conti Shopify: non riagganciato', shop, cli.id, cli.master_id)
  return { error: 'conto ritrovato per indirizzo fuori dai master dell\'installazione', codice: 'account_non_creato' }
}

// Crea (o riusa) un cliente MoovExpress per un negozio Shopify installato dallo store.
// Idempotente: se il negozio è già collegato, ritorna il cliente esistente.
// L'email di login la sceglie chi fa entrare il negoziante (lib/accesso-cliente.ts), non questa
// funzione: qui si decide solo QUALE cliente e se ha un accesso.
export async function provisionShopifyCliente(admin: any, shop: string, token: string): Promise<Esito> {
  const conAccesso = async (cli: Conto, masterId: string): Promise<Esito> =>
    (await assicuraAccesso(admin, cli, shop)) || { clienteId: cli.id, masterId }

  // già collegato? riuso il cliente
  // Niente embed `clienti(email)`: `integrazioni` non ha foreign key, quindi PostgREST non lo sa
  // risolvere e la select falliva in silenzio.
  const { data: integr, error: eInt } = await admin.from('integrazioni')
    .select('cliente_id,master_id').eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
  if (eInt) return letturaFallita('integrazione', eInt)
  if (integr?.cliente_id) {
    const { data: cli, error: eCli } = await admin.from('clienti')
      .select('id,master_id,email,ragione_sociale').eq('id', integr.cliente_id).maybeSingle()
    if (eCli) return letturaFallita('cliente dell\'integrazione', eCli)
    // `integrazioni` non ha foreign key: la riga puo' puntare a un cliente che non c'e' piu'. Prima si
    // tornava quell'id e il negozio finiva agganciato a un cliente inesistente; ora lo si tratta come
    // un negozio mai visto. Solo se la lettura e' riuscita e il cliente non c'e' davvero (vedi
    // letturaFallita).
    if (cli) return conAccesso(cli, integr.master_id)
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
  // scrivere anche chi non dovrebbe.
  const email = emailContoShopify(shop)
  const { data: gia, error: eGia } = await admin.from('clienti')
    .select('id,master_id,email,ragione_sociale').eq('email', email).maybeSingle()
  if (eGia) return letturaFallita('cliente per indirizzo', eGia)
  if (gia?.id) {
    const fuori = await masterDellInstallazione(admin, gia, shop)
    if (fuori) return fuori
    return conAccesso(gia, gia.master_id)
  }

  const onboarding = await configurazioneOnboarding(admin)
  if ('error' in onboarding) return onboarding
  const { masterId, listinoId } = onboarding

  const info = await fetchShopInfo(shop, token)
  const nome = info?.name || shop.replace('.myshopify.com', '')
  const addr = info?.billingAddress || {}

  // L'indirizzo e' interno (lib/indirizzi-interni.ts): fra le porte che CREANO clienti e' l'unica che
  // lo puo' dare, e lo dichiara a inserisciClienteConCodice, che lo rifiuta a tutte le altre. Chi lo
  // scrive su un cliente gia' esistente non passa da li': per questo il conto ritrovato per indirizzo,
  // qui sopra, si riaggancia solo coi suoi controlli.
  const { data: nuovo, error } = await inserisciClienteConCodice(admin, {
    master_id: masterId,
    ragione_sociale: nome,
    email,
    telefono: addr.phone || null,
    sl_paese: addr.country || 'Italia', sl_indirizzo: addr.address1 || null,
    sl_citta: addr.city || null, sl_provincia: addr.provinceCode || addr.province || null, sl_cap: addr.zip || null,
    // SEDE OPERATIVA, non solo sede legale: e' da qui che parte il pacco.
    //
    // Finora si compilavano solo i campi sl_* e i so_* restavano vuoti. Ma il mittente di ogni
    // spedizione si costruisce SOLO dai so_* (pagina ordini e nuova spedizione), quindi un
    // negoziante che installava dall'App Store non riusciva a spedire NIENTE: la creazione
    // rispondeva 400 "Provincia mittente obbligatoria", e non poteva nemmeno rimediare da solo —
    // nel portale cliente non esiste una schermata per compilare la sede operativa, la vede solo
    // il suo master. Misurato il 9/09/2026: tre negozi auto-creati, tutti con so_* NULL, zero
    // spedizioni e zero ordini fra tutti e tre. Uno era il revisore Shopify di luglio.
    // L'indirizzo del negozio e' il mittente giusto per chi spedisce la propria merce; se non lo e',
    // il master lo corregge dalla scheda cliente.
    so_paese: addr.country || 'Italia', so_indirizzo: addr.address1 || null,
    so_citta: addr.city || null, so_provincia: addr.provinceCode || addr.province || null, so_cap: addr.zip || null,
    listino_cliente_id: listinoId,
    tipo_contratto: 'credito_scalare',
    aliquota_iva: '22',
    attivo: true,
  }, 'id', { indirizzoInterno: true })
  if (error?.code === '23505' && String(error.message || '').includes('clienti_email_key')) {
    // DUE INSTALLAZIONI DELLO STESSO NEGOZIO INSIEME (doppio clic, due schede): fra la lettura qui sopra
    // e questo insert un'altra richiesta ha creato il conto con lo stesso indirizzo. Questa si ferma
    // senza toccare niente: il negozio lo salva l'altra. Riusare il suo conto da qui faceva salvare
    // l'integrazione a tutte e due, e su `integrazioni` non c'e' un vincolo unico: con due righe per lo
    // stesso negozio ogni lettura del negozio da' errore, e il negoziante non entra piu' finche' qualcuno
    // non ne cancella una a mano (revisione del 20/10). Se l'altra non ha finito, nessun danno: il
    // negozio non risulta collegato, /enter alla riapertura rimanda all'OAuth, e il conto si ritrova
    // per indirizzo coi controlli di sopra.
    return { error: 'conto creato da un\'altra installazione simultanea', codice: 'collegamento_non_salvato' }
  }
  if (error || !nuovo) {
    return { error: `cliente: ${error?.code || ''} ${error?.message || 'insert senza riga'}`.trim(), codice: 'account_non_creato' }
  }
  return conAccesso({ id: nuovo.id, master_id: masterId, email, ragione_sociale: nome }, masterId)
}
