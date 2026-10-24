import { recapitoEmail, eIndirizzoInterno } from '@/lib/indirizzi-interni'
import { contoNatoDaShopify } from '@/lib/conti-shopify'
import { siglaProvincia, SIGLE_IT } from '@/lib/province-it'

// I DATI DEL NEGOZIO AL PRIMO ACCESSO: quando servono, come si controllano, cosa si scrive.
//
// Il conto nato dall'installazione dell'app Shopify arriva nel portale senza niente di suo: il nome
// del negozio, un indirizzo email nostro che non riceve posta, e al massimo l'indirizzo di
// fatturazione che Shopify ci passa (che puo' essere estero, incompleto, o non il magazzino). Senza
// sede operativa e telefono l'import e gli ordini dei negozi non spediscono, e senza dati fiscali non
// gli si puo' intestare una fattura. Decisioni di Lorenzo del 21/10/2026 (D2 e D8): una schermata al
// primo accesso chiede indirizzo di ritiro, telefono e dati per la fattura, e la vedono SOLO quei
// conti. Presa alla lettera ("chi non ha sede o telefono") l'avrebbero vista 136 clienti di oggi, 49
// dei quali hanno spedito nell'ultimo mese col mittente scritto a mano o preso dalla rubrica
// (conteggio del 21/10): per loro non cambia niente.
//
// Il modulo non nomina fornitori: lo usano il layout del portale, la rotta che salva, e le porte
// delle spedizioni per la regola del telefono (attraverso telValidoSp, nel modulo di un fornitore).

// ── Regole semplici: niente archivio, le puo' usare chiunque ────────────────────────────────────

// Telefono: solo le cifre contano, da 6 a 15 (il massimo del formato internazionale). E' la soglia
// sotto la quale i corrieri che esigono il telefono rifiutano la spedizione: stava nel modulo di un
// fornitore come telValidoSp, che ora la importa da qui, perche' la stessa soglia serve alla schermata
// del primo accesso. Due copie dello stesso numero finiscono per divergere.
export function telefonoValido(v: unknown): boolean {
  const d = String(v ?? '').replace(/[^0-9]/g, '')
  return d.length >= 6 && d.length <= 15
}

// Si salva come lo leggono i corrieri: il + iniziale (se c'e') e le cifre, nient'altro.
export function normalizzaTelefono(v: unknown): string {
  const s = String(v ?? '').trim()
  return (s.startsWith('+') ? '+' : '') + s.replace(/[^0-9]/g, '')
}

// Partita IVA italiana: 11 cifre, l'ultima di controllo (algoritmo dell'Agenzia delle Entrate). Undici
// zeri passano il conto ma non sono una partita IVA.
export function partitaIvaValida(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^0+$/.test(v)) return false
  let s = 0
  for (let i = 0; i < 10; i++) {
    let n = v.charCodeAt(i) - 48
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    s += n
  }
  return (10 - (s % 10)) % 10 === v.charCodeAt(10) - 48
}

// Codice fiscale di una persona: 16 caratteri, l'ultimo di controllo. Le cifre possono essere
// sostituite da lettere (omocodia), quindi lo schema le ammette nelle posizioni numeriche.
const CF_DISPARI: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}
export function codiceFiscalePersonaValido(v: string): boolean {
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v)) return false
  let s = 0
  for (let i = 0; i < 15; i++) {
    const ch = v[i]
    s += i % 2 === 0 ? CF_DISPARI[ch] : (ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 65)
  }
  return String.fromCharCode(65 + (s % 26)) === v[15]
}

// ── Il cliente come lo leggono layout e rotta ───────────────────────────────────────────────────

// Le colonne che servono a decidere se la schermata va mostrata e a precompilarla. Una sola lista,
// cosi' il layout e la rotta che salva guardano esattamente gli stessi campi.
export const COLONNE_DATI_NEGOZIO =
  'email,impostazioni,ragione_sociale,piva,cf,cod_sdi,pec,telefono,'
  + 'sl_indirizzo,sl_citta,sl_cap,sl_provincia,sl_paese,so_indirizzo,so_citta,so_cap,so_provincia,so_paese'

export type ClienteNegozio = {
  email?: string | null
  impostazioni?: unknown
  ragione_sociale?: string | null
  piva?: string | null
  cf?: string | null
  cod_sdi?: string | null
  pec?: string | null
  telefono?: string | null
  sl_indirizzo?: string | null
  sl_citta?: string | null
  sl_cap?: string | null
  sl_provincia?: string | null
  sl_paese?: string | null
  so_indirizzo?: string | null
  so_citta?: string | null
  so_cap?: string | null
  so_provincia?: string | null
  so_paese?: string | null
}

export function impostazioniDi(c: { impostazioni?: unknown } | null | undefined): Record<string, any> {
  const i = c?.impostazioni
  return i && typeof i === 'object' && !Array.isArray(i) ? (i as Record<string, any>) : {}
}

// LE IMPOSTAZIONI DI UN CONTO NATO DA SHOPIFY SI FONDONO SULLA RIGA RILETTA, DA OGNI PORTA.
// La scheda del master (Modifica, Impostazioni) e la pagina Stampa e Notifiche del cliente rimandano l'oggetto
// intero letto all'apertura: preso com'e', riportava indietro quello che altri avevano scritto nel frattempo.
// Si parte dalla riga di adesso e si applicano le chiavi del modulo, tranne le due della schermata del primo
// accesso: email_contatto e sede_da_completare le scrive solo la schermata (app/api/cliente/dati-negozio), e
// una copia vecchia cancellava l'email vera del negoziante e gli rimetteva davanti la schermata (revisione del
// 21/10/2026: la pagina Stampa e Notifiche resta montata sotto la schermata e salva dopo).
export function fondiImpostazioniNegozio(riga: { impostazioni?: unknown }, dalModulo: unknown): Record<string, unknown> {
  const delModulo: Record<string, unknown> = { ...impostazioniDi({ impostazioni: dalModulo }) }
  delete delModulo.email_contatto
  delete delModulo.sede_da_completare
  return { ...impostazioniDi(riga), ...delModulo }
}

const vuoto = (v: unknown) => !String(v ?? '').trim()

// L'EMAIL DEL MITTENTE. Il conto nato da Shopify entra con un indirizzo nostro che non riceve posta:
// precompilato nel mittente finiva in ogni spedizione (e, per alcuni corrieri, nei dati passati a
// loro). Per quei conti vale l'email che il negoziante ci ha dato al primo accesso
// (impostazioni.email_contatto); se non c'e', meglio nessuna email che una che nessuno legge. Per
// tutti gli altri resta quella del conto, tale e quale: per loro non cambia niente.
export function emailMittenteCliente(c: { email?: string | null; impostazioni?: unknown } | null | undefined): string {
  if (!eIndirizzoInterno(c?.email)) return String(c?.email ?? '')
  return recapitoEmail(impostazioniDi(c).email_contatto) || ''
}

// Cosa manca perche' il conto possa spedire e ricevere la fattura. I campi di indirizzo, P.IVA o codice
// fiscale e SDI o PEC contano se ci sono; telefono ed email devono anche essere buoni, perche' un
// telefono di 3 cifre fa rifiutare la spedizione e l'email serve a scrivergli davvero.
export function datiNegozioMancanti(c: ClienteNegozio): boolean {
  return vuoto(c.so_indirizzo) || vuoto(c.so_citta) || vuoto(c.so_cap) || vuoto(c.so_provincia)
    || !telefonoValido(c.telefono)
    || (vuoto(c.piva) && vuoto(c.cf))
    || (vuoto(c.cod_sdi) && vuoto(c.pec))
    || !recapitoEmail(impostazioniDi(c).email_contatto)
}

// La schermata la vede SOLO il conto nato dall'installazione dell'app, e solo se gli manca qualcosa
// oppure se alla nascita e' stato segnato da confermare (impostazioni.sede_da_completare): l'indirizzo
// di fatturazione di Shopify puo' essere arrivato completo ma non essere il magazzino, e il negoziante
// lo deve confermare almeno una volta. La stessa risposta la danno il layout (mostrarla) e la rotta
// (accettare il salvataggio).
export function servonoDatiNegozio(c: ClienteNegozio | null | undefined): boolean {
  if (!c || !contoNatoDaShopify(c)) return false
  return impostazioniDi(c).sede_da_completare === true || datiNegozioMancanti(c)
}

// LA VERSIONE DEI DATI CHE IL NEGOZIANTE HA DAVANTI.
// La schermata resta aperta minuti, a volte ore: intanto il master puo' salvare la scheda dello stesso
// cliente. Il caso visto in revisione: alle 10:02 il master scrive telefono, P.IVA e sede operativa,
// alle 10:05 il negoziante salva. Siccome l'email vera manca ancora la schermata serve ancora, e la
// rotta, che controllava solo i millisecondi fra la sua lettura e la sua scrittura, riscriveva senza
// avvisi tutto quello che il master aveva appena messo. Il layout calcola questa impronta quando apre
// la schermata, la schermata la rimanda col salvataggio, la rotta la rifa' sulla riga riletta: se non
// torna, qualcuno ha cambiato i dati dopo che il negoziante li ha visti, e non si scrive.
// Entrano i campi che la schermata mostra o che il salvataggio riscrive (paesi compresi, anche se a
// schermo non si vedono) e le due chiavi delle impostazioni che la riguardano: non il credito o le
// altre impostazioni, che cambiano per conto loro (una ricarica del master non deve far rifare la
// schermata). Vuoto e null valgono uguale: la scheda del master salva '' dove trova null.
// Un'impronta e non i valori: viaggia nella pagina e nella richiesta, e i dati non servono a nessuno
// dei due. Calcolata senza librerie, perche' questo modulo lo carica anche il modulo di un fornitore.
export function versioneDatiNegozio(c: ClienteNegozio): string {
  const imp = impostazioniDi(c)
  const parti = [
    c.email, c.ragione_sociale, c.piva, c.cf, c.cod_sdi, c.pec, c.telefono,
    c.sl_indirizzo, c.sl_citta, c.sl_cap, c.sl_provincia, c.sl_paese,
    c.so_indirizzo, c.so_citta, c.so_cap, c.so_provincia, c.so_paese,
    imp.email_contatto, imp.sede_da_completare === true ? 'da_completare' : '',
  ].map((v) => String(v ?? '').trim())
  return impronta(JSON.stringify(parti))
}

// cyrb53: 53 bit, abbastanza perche' due versioni diverse della stessa riga non coincidano per caso.
function impronta(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// ── Cosa riceve la schermata ────────────────────────────────────────────────────────────────────

export type DatiSchermataNegozio = {
  ragione_sociale: string
  piva: string
  cf: string
  cod_sdi: string
  pec: string
  email: string
  sl_indirizzo: string
  sl_citta: string
  sl_cap: string
  sl_provincia: string
  so_indirizzo: string
  so_citta: string
  so_cap: string
  so_provincia: string
  telefono: string
}

const paeseItalia = (v: unknown) => ['', 'IT', 'ITA', 'ITALIA', 'ITALY'].includes(String(v ?? '').trim().toUpperCase())

// I valori di partenza. La sede legale arriva dall'indirizzo di fatturazione di Shopify, e cosi' la
// sede operativa se l'installazione l'ha copiata da li': si usano solo se sono in Italia. Un indirizzo
// estero non passerebbe i controlli, e precompilarlo vorrebbe dire far cancellare al negoziante campi
// che non ha scritto lui. Mai l'indirizzo email nostro.
export function datiPerLaSchermata(c: ClienteNegozio): DatiSchermataNegozio {
  const s = (v: unknown) => String(v ?? '').trim()
  const prov = (v: unknown) => { const p = siglaProvincia(s(v)); return SIGLE_IT.has(p) ? p : '' }
  const legale = paeseItalia(c.sl_paese)
  const ritiro = paeseItalia(c.so_paese)
  return {
    ragione_sociale: s(c.ragione_sociale),
    piva: s(c.piva),
    cf: s(c.cf),
    cod_sdi: s(c.cod_sdi),
    pec: s(c.pec),
    email: recapitoEmail(impostazioniDi(c).email_contatto) || '',
    sl_indirizzo: legale ? s(c.sl_indirizzo) : '',
    sl_citta: legale ? s(c.sl_citta) : '',
    sl_cap: legale ? s(c.sl_cap) : '',
    sl_provincia: legale ? prov(c.sl_provincia) : '',
    so_indirizzo: ritiro ? s(c.so_indirizzo) : '',
    so_citta: ritiro ? s(c.so_citta) : '',
    so_cap: ritiro ? s(c.so_cap) : '',
    so_provincia: ritiro ? prov(c.so_provincia) : '',
    telefono: s(c.telefono),
  }
}

// ── Il controllo di quello che arriva dalla schermata ───────────────────────────────────────────

// L'ARCHIVIO CAP SI CARICA SOLO QUANDO SERVE.
// Sono 1,3 MB di comuni e frazioni (lib/data), indicizzati al caricamento. Questo modulo lo importano
// anche il layout del portale cliente (ogni pagina) e, per la regola del telefono, il modulo di un
// fornitore che sta in 24 rotte: con un import statico tutte pagherebbero l'archivio a ogni avvio a
// freddo per un controllo che fa una rotta sola, una volta per conto.
type Localita = { nome: string; sigla: string; cap: string[] | string }
async function caricaArchivio() {
  const [vc, pc, comuni, frazioni] = await Promise.all([
    import('@/lib/valida-citta'),
    import('@/lib/provincia-da-cap'),
    import('@/lib/data/comuni.json'),
    import('@/lib/data/frazioni.json'),
  ])
  return {
    capNotoInArchivio: vc.capNotoInArchivio,
    validaCittaCap: vc.validaCittaCap,
    normalizzaCittaUfficiale: vc.normalizzaCittaUfficiale,
    normCitta: vc.normCitta,
    CAP_PROVINCIA: pc.CAP_PROVINCIA,
    localita: [...(comuni.default as Localita[]), ...(frazioni.default as Localita[])],
    capGenerici: capGenericiDi(comuni.default as Localita[]),
  }
}

// I CAP GENERICI DELLE CITTA' CON UN CAP PER ZONA.
// Napoli ha 80121-80147, uno per zona, e in archivio anche 80100, il CAP "della citta'", che non e'
// quello di nessuna via. Stava in cima ai suggerimenti della schermata e passava ogni controllo (citta'
// e CAP combaciano): il negoziante lo sceglieva e non poteva piu' correggerlo, e da so_cap esce il
// mittente di import e ordini e il CAP del ritiro. E' un CAP che vale soldi: la copertura in partenza
// confronta il CAP esatto (un 80100 fuori dalle liste esclude contratti, "partenza non coperta"), e le
// zone, anche quelle del mittente, possono essere scritte per CAP esatto, come il centro storico di
// Venezia (30121-30135) che si paga diverso dalla terraferma.
// Si riconosce cosi': la numerazione per zona parte sempre da xx121, quindi una citta' che ha xx121 ha
// xx100 come CAP generico. Sono 39: 35 col generico in archivio, piu' Roma, Milano, Ferrara e Barletta,
// dove l'archivio non ce l'ha nemmeno. Udine e Campobasso (33100, 86100) restano buoni: 33170 e 86170
// sono di Pordenone e Isernia, non zone loro.
function capGenericiDi(comuni: Localita[]): Map<string, { nome: string; da: string; a: string }> {
  const m = new Map<string, { nome: string; da: string; a: string }>()
  for (const c of comuni) {
    const caps = Array.isArray(c.cap) ? c.cap : [c.cap]
    for (const k of caps) {
      if (!/^\d{2}121$/.test(k)) continue
      const pre = k.slice(0, 3)
      const zone = caps.filter((x) => x.startsWith(pre) && x !== pre + '00').sort()
      m.set(pre + '00', { nome: c.nome, da: zone[0], a: zone[zone.length - 1] })
    }
  }
  return m
}
type Archivio = Awaited<ReturnType<typeof caricaArchivio>>
let archivio: Promise<Archivio> | null = null
function archivioCap(): Promise<Archivio> {
  if (!archivio) archivio = caricaArchivio().catch((e) => { archivio = null; throw e })
  return archivio
}

// La sigla (o le sigle) della provincia di quel CAP e di quella citta'. Per quasi tutti i CAP basta il
// CAP (CAP_PROVINCIA); 9 CAP stanno a cavallo di due province (09040 SU/CA, 23806 BG/LC...) e
// CAP_PROVINCIA li esclude apposta: per quelli decide il comune.
function sigleDi(a: Archivio, cap: string, citta: string): Set<string> {
  const unica = a.CAP_PROVINCIA.get(cap)
  if (unica) return new Set([unica])
  const n = a.normCitta(citta)
  const conNome = new Set<string>(), tutte = new Set<string>()
  for (const l of a.localita) {
    if (!(Array.isArray(l.cap) ? l.cap.includes(cap) : l.cap === cap)) continue
    tutte.add(l.sigla)
    if (n && a.normCitta(l.nome) === n) conNome.add(l.sigla)
  }
  return conNome.size ? conNome : tutte
}

export type CampiNegozio = {
  ragione_sociale: string
  piva: string | null
  cf: string | null
  cod_sdi: string | null
  pec: string | null
  email: string
  sl_indirizzo: string
  sl_citta: string
  sl_cap: string
  sl_provincia: string
  so_indirizzo: string
  so_citta: string
  so_cap: string
  so_provincia: string
  telefono: string
}

export type EsitoDatiNegozio =
  | { ok: true; valori: CampiNegozio }
  | { ok: false; errori: Record<string, string> }

// L'INDIRIZZO: lo stesso controllo per la sede legale e per il ritiro.
// So_cap e so_provincia entrano nel prezzo (supplemento zona mittente e copertura in partenza,
// lib/pricing.ts) e nell'anteprima di import e ordini: una provincia che non e' quella del CAP o un CAP
// inventato valgono soldi. Fra i clienti di oggi 18 hanno la provincia incoerente col CAP e 84 una
// citta' che l'archivio non riconosce, perche' la scheda del master non controlla niente: qui non si
// ripete. Niente correzioni silenziose della citta': un CAP sbagliato si scopre proprio dal nome che
// non torna, e il negoziante deve vederlo.
async function validaIndirizzo(
  pre: 'sl' | 'so', leggi: (k: string) => string, errori: Record<string, string>,
): Promise<{ indirizzo: string; citta: string; cap: string; provincia: string }> {
  const a = await archivioCap()
  const indirizzo = leggi(`${pre}_indirizzo`)
  const cap = leggi(`${pre}_cap`).replace(/\s/g, '')
  let citta = leggi(`${pre}_citta`)
  const provInput = leggi(`${pre}_provincia`)
  let provincia = provInput ? siglaProvincia(provInput) : ''

  // 35 caratteri: e' quanto la creazione della spedizione passa al corriere (la riga dell'etichetta).
  // Un indirizzo piu' lungo verrebbe tagliato in silenzio, magari proprio sul numero civico.
  if (indirizzo.length < 3) errori[`${pre}_indirizzo`] = 'Scrivi via e numero civico.'
  else if (indirizzo.length > 35) errori[`${pre}_indirizzo`] = `Al massimo 35 caratteri (ora ${indirizzo.length}): è quanto entra nell'etichetta. Abbrevia, per esempio «V.» invece di «Via».`

  let capOk = false
  const generico = a.capGenerici.get(cap)
  if (!/^\d{5}$/.test(cap)) errori[`${pre}_cap`] = 'Il CAP ha 5 cifre.'
  // Prima del controllo sull'archivio: 20100 e 00100 non ci sono, e "non risulta fra quelli italiani"
  // a chi ha scritto il vecchio CAP di Milano non direbbe cosa fare.
  else if (generico) errori[`${pre}_cap`] = generico.da === generico.a
    ? `Il CAP di ${generico.nome} è ${generico.da}.`
    : `${cap} è il CAP generico di ${generico.nome}, che ne ha uno per zona (da ${generico.da} a ${generico.a}): scrivi quello della tua via.`
  else if (!a.capNotoInArchivio(cap)) errori[`${pre}_cap`] = `Il CAP ${cap} non risulta fra quelli italiani: controllalo.`
  else capOk = true

  let cittaOk = false
  if (!citta) errori[`${pre}_citta`] = 'Scrivi la città e sceglila dall\'elenco.'
  else if (citta.length > 60) errori[`${pre}_citta`] = 'Nome della città troppo lungo.'
  else if (capOk) {
    const v = a.validaCittaCap(cap, citta, 'IT')
    if (v.validabile && v.ok) {
      // Si salva il nome ufficiale (accenti e apostrofi giusti), quello con cui sono scritte le zone.
      const n = a.normCitta(citta)
      citta = v.noti.find((x) => a.normCitta(x) === n) || citta
      cittaOk = true
    } else {
      const uff = a.normalizzaCittaUfficiale(cap, citta, 'IT')
      errori[`${pre}_citta`] = uff
        ? `Col CAP ${cap} la località è «${uff}»: correggi la città o il CAP.`
        : `«${citta}» non risulta col CAP ${cap}${v.noti.length ? ` (per questo CAP: ${v.noti.slice(0, 6).join(', ')})` : ''}. Sceglila dall'elenco o correggi il CAP.`
    }
  }

  // Con CAP o citta' ancora da sistemare una provincia vuota non si segnala: scegliendo la citta'
  // dall'elenco arriva da sola, e un errore in piu' farebbe solo sceglierla a mano.
  if (provincia && !SIGLE_IT.has(provincia)) {
    errori[`${pre}_provincia`] = 'Provincia non valida: sceglila dall\'elenco.'
  } else if (capOk && cittaOk) {
    const attese = sigleDi(a, cap, citta)
    if (!provincia) {
      // Vuota ma ricavabile senza dubbi: la si mette, come fa l'import dal CAP.
      if (attese.size === 1) provincia = [...attese][0]
      else errori[`${pre}_provincia`] = 'Scegli la provincia.'
    } else if (attese.size && !attese.has(provincia)) {
      errori[`${pre}_provincia`] = `Il CAP ${cap} è in provincia di ${[...attese].join(' o ')}.`
    }
  }

  return { indirizzo, citta, cap, provincia }
}

// Controlla tutto quello che la schermata manda e restituisce i valori puliti da scrivere, oppure un
// messaggio per ogni campo sbagliato (la schermata li mostra tutti insieme, non uno alla volta).
// Errori su due campi alternativi: 'piva_cf' (manca l'uno e l'altro) e 'sdi_pec'.
export async function validaDatiNegozio(corpo: Record<string, unknown>): Promise<EsitoDatiNegozio> {
  const errori: Record<string, string> = {}
  const leggi = (k: string) => {
    const v = corpo[k]
    return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : ''
  }

  const ragione = leggi('ragione_sociale')
  if (ragione.length < 2) errori.ragione_sociale = 'Scrivi la ragione sociale, o nome e cognome se sei un privato.'
  else if (ragione.length > 160) errori.ragione_sociale = 'Ragione sociale troppo lunga (massimo 160 caratteri).'

  // P.IVA o codice fiscale: basta uno dei due (la fattura elettronica vuole almeno uno dei due).
  const piva = leggi('piva').toUpperCase().replace(/[\s.\-]/g, '').replace(/^IT/, '')
  const cf = leggi('cf').toUpperCase().replace(/[\s.\-]/g, '')
  if (!piva && !cf) errori.piva_cf = 'Serve la partita IVA oppure il codice fiscale.'
  if (piva) {
    if (!/^\d{11}$/.test(piva)) errori.piva = 'La partita IVA ha 11 cifre.'
    else if (!partitaIvaValida(piva)) errori.piva = 'Partita IVA non valida: controlla le cifre.'
  }
  if (cf) {
    // Le societa' hanno un codice fiscale numerico di 11 cifre, con lo stesso controllo della P.IVA.
    if (/^\d{11}$/.test(cf)) { if (!partitaIvaValida(cf)) errori.cf = 'Codice fiscale non valido: controlla le cifre.' }
    else if (cf.length !== 16) errori.cf = 'Il codice fiscale ha 16 caratteri (11 cifre per le società).'
    else if (!codiceFiscalePersonaValido(cf)) errori.cf = 'Codice fiscale non valido: controlla di averlo scritto bene.'
  }

  // Codice destinatario o PEC: e' dove arriva la fattura elettronica.
  const sdi = leggi('cod_sdi').toUpperCase().replace(/\s/g, '')
  const pecGrezza = leggi('pec').toLowerCase()
  if (!sdi && !pecGrezza) errori.sdi_pec = 'Serve il codice destinatario (SDI) oppure la PEC: è dove ricevi le fatture elettroniche.'
  if (sdi && !/^[A-Z0-9]{7}$/.test(sdi)) errori.cod_sdi = 'Il codice destinatario ha 7 caratteri, lettere e cifre.'
  const pec = pecGrezza ? recapitoEmail(pecGrezza) : undefined
  if (pecGrezza && (!pec || pec.length > 160)) errori.pec = 'Indirizzo PEC non valido.'

  // Un'email vera: quella del conto e' un indirizzo nostro che non riceve posta (lib/indirizzi-interni).
  const email = recapitoEmail(leggi('email'))
  if (!email || email.length > 160) errori.email = 'Scrivi un indirizzo email valido, che leggi davvero.'

  const sl = await validaIndirizzo('sl', leggi, errori)
  const so = await validaIndirizzo('so', leggi, errori)

  const telefono = normalizzaTelefono(leggi('telefono'))
  if (!telefonoValido(telefono)) errori.telefono = 'Scrivi un numero di telefono valido (da 6 a 15 cifre).'

  if (Object.keys(errori).length) return { ok: false, errori }
  return {
    ok: true,
    valori: {
      ragione_sociale: ragione,
      piva: piva || null,
      cf: cf || null,
      cod_sdi: sdi || null,
      pec: pec || null,
      email: email as string,
      sl_indirizzo: sl.indirizzo, sl_citta: sl.citta, sl_cap: sl.cap, sl_provincia: sl.provincia,
      so_indirizzo: so.indirizzo, so_citta: so.citta, so_cap: so.cap, so_provincia: so.provincia,
      telefono,
    },
  }
}
