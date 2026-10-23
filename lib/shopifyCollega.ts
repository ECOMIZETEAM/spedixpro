import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { clienteDellaSessione } from '@/lib/accesso-cliente'
import { createServerSupabase } from '@/lib/supabase'

// COLLEGARE UN NEGOZIO SHOPIFY A UN CONTO: LA REGOLA, E L'INSTALLAZIONE CHE ASPETTA LA SCELTA.
//
// Decisione D1 di Lorenzo del 21/10/2026: un negozio MAI VISTO, dopo l'autorizzazione, chiede «Hai già un
// account MoovExpress?» e si attacca al conto che il negoziante sceglie. Fra il ritorno da Shopify (il
// callback) e la scelta (la pagina /api/integrazioni/shopify/collega) il token del negozio deve aspettare da
// qualche parte. A luglio aspettava in shopify_pending cercato per NOME del negozio, e lo rivendicava
// qualunque cliente entrato che scrivesse quel nome nell'indirizzo: il nome di un negozio e' pubblico. Ora:
// - la riga si ritrova solo con un gettone casuale da 256 bit che sta in un cookie httpOnly del browser che
//   ha fatto l'autorizzazione; nel database c'e' solo la sua impronta (chiave_hash), e al browser arriva solo
//   il dominio del negozio, mai token ne' id;
// - vale 15 minuti, una volta sola, e 5 password sbagliate la cancellano;
// - una riga per negozio: un'installazione nuova sostituisce la precedente, come fa Shopify col token.
// La tabella e' chiusa (RLS, nessun permesso ad anon e authenticated: scripts/shopify-installazioni-in-
// sospeso.sql) e si legge solo per colonne esplicite. I token stanno in chiaro come in integrazioni.credenziali:
// la chiave di cifratura su Vercel non c'e'.

export const PAGINA_SCELTA = '/api/integrazioni/shopify/collega'

// Lo stesso percorso del nonce dell'autorizzazione (lib/shopifyOAuth.ts): il cookie va solo alle rotte
// Shopify, e __Secure- lo fa rifiutare al browser fuori da HTTPS.
export const COOKIE_SOSPESO_SHOPIFY = '__Secure-shopify-installazione'
const PERCORSO_COOKIE = '/api/integrazioni/shopify'

// Quindici minuti: il negoziante legge la domanda, magari cerca la password. Oltre, riaprire l'app
// dall'admin del negozio rifa' tutto da capo senza perdere niente.
export const DURATA_SOSPESO_MS = 15 * 60 * 1000
export const TENTATIVI_MASSIMI = 5

export type CredenzialiNegozio = {
  access_token: string
  scope: string
  refresh_token: string
  expires_at: number | null
  refresh_expires_at: number | null
  // QUANDO SHOPIFY HA DATO QUESTA AUTORIZZAZIONE (lo scambio del codice nel callback), in ISO. Serve alla
  // disinstallazione: Shopify non garantisce l'ordine dei webhook e ripete quelli a cui si risponde con un
  // errore, quindi un app/uninstalled scattato PRIMA di una reinstallazione puo' arrivare DOPO, e spegneva il
  // collegamento appena rifatto. Il webhook tocca solo le autorizzazioni piu' vecchie di lui
  // (webhooks/app-uninstalled). Il rinnovo del token lo conserva (getValidShopifyToken copia le credenziali):
  // l'autorizzazione e' la stessa.
  autorizzato_il: string
}

const numero = (v: unknown): number | null => {
  const n = Number(v)
  return v != null && Number.isFinite(n) && n > 0 ? n : null
}

// ── UN NEGOZIO = UN CLIENTE ─────────────────────────────────────────────────────────────────────

export type EsitoCollegamento =
  | { ok: true; masterId: string }
  | { ok: false; codice: 'negozio_di_altro_account' | 'collegamento_non_salvato' }

// LA REGOLA UNICA, per il callback (negozio gia' noto) e per la scelta (negozio nuovo).
//
// Fino al 21/10/2026 stava scritta due volte nel callback, una per ramo, e master_id veniva dallo state o
// dalla riga vecchia: ma finisce su ogni ordine importato (lib/shopifySync), quindi si rilegge QUI dal
// cliente, nel momento in cui il negozio gli si attacca. Un cliente spostato sotto un altro master porta
// con se' i suoi ordini nuovi.
//
// Il negozio di un ALTRO cliente non si porta via (gli ordini con nomi, indirizzi e telefoni dei compratori
// finirebbero nel portale di un terzo). Ma il token nuovo si salva comunque sulla riga del proprietario: lo
// scambio del codice appena fatto ha gia' ritirato ogni altro refresh token dell'app su quel negozio (guida
// Shopify, access tokens, «Token retirement»), e buttarlo lascerebbe il proprietario con un token che entro
// un'ora non si rinnova piu'. Una riga che punta a un cliente che non esiste piu' (su `integrazioni` non c'e'
// foreign key) non e' «di un altro»: si riprende.
// Un indice unico tiene una riga sola per negozio (scripts/shopify-installazioni-in-sospeso.sql): se due
// richieste inseriscono insieme, la seconda rilegge e applica la regola alla riga dell'altra.
// Ogni scrittura di credenziali rimette stato 'attivo' ed errore vuoto: il segno del token morto
// (lib/shopify.ts) si toglie solo cosi'.
export async function collegaNegozioShopify(
  admin: any,
  opz: { shop: string; clienteId: string; credenziali: CredenzialiNegozio },
): Promise<EsitoCollegamento> {
  const { shop } = opz
  const clienteId = String(opz.clienteId)
  const credenziali = { ...opz.credenziali, shop }
  const nonSalvato = (cosa: string, e?: { message?: string } | null): EsitoCollegamento => {
    console.error('[SHOPIFY][COLLEGA] negozio non collegato:', cosa, shop, clienteId, e?.message || '')
    return { ok: false, codice: 'collegamento_non_salvato' }
  }

  const { data: cliente, error: eCli } = await admin.from('clienti').select('master_id').eq('id', clienteId).maybeSingle()
  if (eCli) return nonSalvato('lettura del cliente', eCli)
  if (!cliente?.master_id) return nonSalvato('cliente inesistente o senza master')
  const masterId = String(cliente.master_id)

  for (let giro = 0; giro < 3; giro++) {
    const { data: riga, error: eRiga } = await admin.from('integrazioni')
      .select('id,cliente_id,scade:credenziali->>expires_at')
      .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
    // Una lettura fallita non e' «negozio libero»: si inserirebbe una seconda riga per lo stesso negozio.
    if (eRiga) return nonSalvato('lettura della riga del negozio', eRiga)

    if (riga?.cliente_id && String(riga.cliente_id) !== clienteId) {
      const { data: proprietario, error: eProp } = await admin.from('clienti').select('id').eq('id', riga.cliente_id).maybeSingle()
      if (eProp) return nonSalvato('lettura del proprietario', eProp)
      if (proprietario) {
        await salvaTokenSulProprietario(admin, riga, credenziali)
        console.error('[SHOPIFY][COLLEGA] negozio gia collegato ad altro cliente: non spostato', shop, clienteId)
        return { ok: false, codice: 'negozio_di_altro_account' }
      }
      console.error('[SHOPIFY][COLLEGA] la riga del negozio puntava a un cliente che non esiste piu: ripresa', shop, riga.cliente_id)
    }

    const payload = {
      master_id: masterId, cliente_id: clienteId, piattaforma: 'shopify',
      nome_negozio: shop, identificativo: shop, credenziali, stato: 'attivo', errore: null,
    }
    if (riga?.id) {
      // Con .select() si sa se la riga c'era ancora: uno shop/redact arrivato in mezzo l'avrebbe tolta, e
      // senza questo controllo si direbbe «collegato» senza aver scritto niente.
      const { data: scritte, error } = await admin.from('integrazioni').update(payload).eq('id', riga.id).select('id')
      if (error) return nonSalvato('aggiornamento', error)
      if (scritte?.length) return { ok: true, masterId }
      continue
    }
    const { error } = await admin.from('integrazioni').insert(payload)
    if (!error) return { ok: true, masterId }
    if (error.code !== '23505') return nonSalvato('inserimento', error)
  }
  return nonSalvato('la riga del negozio cambiava a ogni lettura')
}

// Il token nuovo va sul proprietario solo se e' piu' recente di quello che ha: un token che scade dopo e'
// stato rilasciato dopo, e uno rilasciato dopo il nostro avrebbe gia' ritirato il nostro. La scrittura e'
// condizionata alla scadenza letta: se nel frattempo qualcuno ha salvato un collegamento nuovo, quello resta.
async function salvaTokenSulProprietario(admin: any, riga: { id: string; cliente_id: string; scade?: string | null }, credenziali: CredenzialiNegozio & { shop: string }) {
  const loro = numero(riga.scade)
  const nostro = numero(credenziali.expires_at)
  if (loro && nostro && loro >= nostro) {
    console.warn('[SHOPIFY][COLLEGA] il proprietario ha gia un token piu recente: lasciato com\'e\'', credenziali.shop)
    return
  }
  let q = admin.from('integrazioni').update({ credenziali, stato: 'attivo', errore: null })
    .eq('id', riga.id).eq('cliente_id', riga.cliente_id)
  q = riga.scade == null ? q.is('credenziali->>expires_at', null) : q.eq('credenziali->>expires_at', String(riga.scade))
  const { data, error } = await q.select('id')
  if (error) console.error('[SHOPIFY][COLLEGA] token nuovo NON salvato sul proprietario: il suo collegamento si fermera\' al prossimo rinnovo', credenziali.shop, error.message)
  else if (!data?.length) console.warn('[SHOPIFY][COLLEGA] riga del proprietario cambiata nel frattempo: token non sovrascritto', credenziali.shop)
  else console.warn('[SHOPIFY][COLLEGA] token nuovo salvato sulla riga del proprietario', credenziali.shop)
}

// ── L'INSTALLAZIONE IN SOSPESO ──────────────────────────────────────────────────────────────────

const impronta = (gettone: string) => crypto.createHash('sha256').update(gettone, 'utf8').digest('hex')

export type Sospeso = { id: string; shop: string; chiaveHash: string; tentativi: number }

// Salva il token del negozio mai visto e restituisce il gettone da mettere nel cookie (null se non salvato).
export async function salvaSospesoShopify(admin: any, shop: string, cred: CredenzialiNegozio): Promise<string | null> {
  const gettone = crypto.randomBytes(32).toString('base64url')
  const ora = Date.now()
  const { error } = await admin.from('shopify_pending').upsert({
    shop,
    access_token: cred.access_token,
    refresh_token: cred.refresh_token || null,
    scope: cred.scope || '',
    expires_at: cred.expires_at,
    refresh_expires_at: cred.refresh_expires_at,
    chiave_hash: impronta(gettone),
    scade_il: new Date(ora + DURATA_SOSPESO_MS).toISOString(),
    tentativi: 0,
    // La nascita del sospeso e' l'istante dell'autorizzazione: la disinstallazione toglie solo i sospesi nati
    // prima di lei (cancellaSospesiDelNegozio), e il collegamento lo riprende da qui (consumaSospeso).
    created_at: cred.autorizzato_il,
  }, { onConflict: 'shop' })
  if (error) {
    console.error('[SHOPIFY][SOSPESO] installazione in sospeso non salvata', shop, error.message)
    return null
  }
  return gettone
}

// Le installazioni abbandonate: il negozio ha l'app ma nessun conto, e riaprendola dall'admin rifa'
// l'autorizzazione con un token nuovo. Le righe scadute non servono a niente e tengono un token valido.
export async function pulisciSospesiScaduti(admin: any): Promise<void> {
  const { error } = await admin.from('shopify_pending').delete().lt('scade_il', new Date().toISOString())
  if (error) console.error('[SHOPIFY][SOSPESO] pulizia delle installazioni scadute non riuscita', error.message)
}

// Disinstallazione, shop/redact, o negozio appena riagganciato al suo conto: quello che aspettava non vale piu'.
// `primaDi` (ISO): solo i sospesi nati prima di quell'istante. La disinstallazione lo passa: un suo webhook
// arrivato in ritardo, o ripetuto da Shopify, non deve togliere l'installazione nuova a chi sta scegliendo
// l'account in quel momento.
export async function cancellaSospesiDelNegozio(admin: any, shop: string, primaDi?: string): Promise<{ error: { message: string } | null }> {
  let q = admin.from('shopify_pending').delete().eq('shop', shop)
  if (primaDi) q = q.lt('created_at', primaDi)
  const { error } = await q
  return { error: error || null }
}

// L'installazione che aspetta in QUESTO browser. 'illeggibile' e' un guasto: non e' «scaduta».
export async function sospesoDelBrowser(admin: any, req: NextRequest):
  Promise<{ stato: 'valido'; sospeso: Sospeso } | { stato: 'assente' } | { stato: 'illeggibile' }> {
  const gettone = req.cookies.get(COOKIE_SOSPESO_SHOPIFY)?.value || ''
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(gettone)) return { stato: 'assente' }
  const { data, error } = await admin.from('shopify_pending')
    .select('id,shop,chiave_hash,scade_il,tentativi').eq('chiave_hash', impronta(gettone)).maybeSingle()
  if (error) {
    console.error('[SHOPIFY][SOSPESO] lettura non riuscita', error.message)
    return { stato: 'illeggibile' }
  }
  if (!data || !data.scade_il || !(new Date(data.scade_il).getTime() > Date.now())) return { stato: 'assente' }
  return { stato: 'valido', sospeso: { id: String(data.id), shop: String(data.shop), chiaveHash: String(data.chiave_hash), tentativi: Number(data.tentativi) || 0 } }
}

// CONSUMATO IN UN'ISTRUZIONE SOLA: delete con select. Due clic, o due schede, non lo ottengono tutti e due:
// la seconda richiesta non trova piu' niente e non crea ne' una seconda riga ne' un secondo conto.
export async function consumaSospeso(admin: any, s: Sospeso):
  Promise<{ esito: 'consumato'; credenziali: CredenzialiNegozio } | { esito: 'gia_usato' } | { esito: 'illeggibile' }> {
  const { data, error } = await admin.from('shopify_pending').delete()
    .eq('id', s.id).eq('chiave_hash', s.chiaveHash).gt('scade_il', new Date().toISOString())
    .select('access_token,refresh_token,scope,expires_at,refresh_expires_at,created_at')
  if (error) {
    console.error('[SHOPIFY][SOSPESO] consumo non riuscito', s.shop, error.message)
    return { esito: 'illeggibile' }
  }
  const r = data?.[0]
  if (!r?.access_token) return { esito: 'gia_usato' }
  // Lo stesso formato che scrive il callback (toISOString): la disinstallazione lo confronta come testo.
  const nato = new Date(r.created_at)
  return {
    esito: 'consumato',
    credenziali: {
      access_token: String(r.access_token), refresh_token: String(r.refresh_token || ''), scope: String(r.scope || ''),
      expires_at: numero(r.expires_at), refresh_expires_at: numero(r.refresh_expires_at),
      autorizzato_il: (Number.isFinite(nato.getTime()) ? nato : new Date()).toISOString(),
    },
  }
}

// UNA PASSWORD SBAGLIATA IN PIU'. Al quinto errore l'installazione si cancella: per riprovare bisogna riaprire
// l'app dall'admin del negozio, cioe' avere accesso a quel negozio Shopify. Nel codice non c'e' un altro limite
// ai tentativi di accesso, e da qui le prove partirebbero dai server Vercel. Il conteggio e' una scrittura
// condizionata al valore letto: due tentativi insieme non contano uno solo.
export async function contaTentativoSbagliato(admin: any, s: Sospeso): Promise<'continua' | 'esaurito' | 'illeggibile'> {
  let n = s.tentativi
  for (let giro = 0; giro < 3; giro++) {
    if (n + 1 >= TENTATIVI_MASSIMI) {
      const { error } = await admin.from('shopify_pending').delete().eq('id', s.id).eq('chiave_hash', s.chiaveHash)
      if (error) { console.error('[SHOPIFY][SOSPESO] cancellazione dopo troppi tentativi non riuscita', s.shop, error.message); return 'illeggibile' }
      console.warn('[SHOPIFY][SOSPESO] troppi tentativi di accesso: installazione annullata', s.shop)
      return 'esaurito'
    }
    const { data, error } = await admin.from('shopify_pending').update({ tentativi: n + 1 })
      .eq('id', s.id).eq('chiave_hash', s.chiaveHash).eq('tentativi', n).select('tentativi')
    if (error) { console.error('[SHOPIFY][SOSPESO] conteggio dei tentativi non riuscito', s.shop, error.message); return 'illeggibile' }
    if (data?.length) return 'continua'
    const { data: ora, error: eOra } = await admin.from('shopify_pending').select('tentativi')
      .eq('id', s.id).eq('chiave_hash', s.chiaveHash).maybeSingle()
    if (eOra) return 'illeggibile'
    if (!ora) return 'esaurito'
    n = Number(ora.tentativi) || 0
  }
  return 'continua'
}

export function conCookieSospeso(risposta: NextResponse, gettone: string): NextResponse {
  // SameSite=Lax: arriva sulla pagina della scelta anche se il giro e' partito dall'admin di Shopify (una
  // navigazione da un altro sito), e non parte con un modulo inviato da un altro sito.
  risposta.cookies.set(COOKIE_SOSPESO_SHOPIFY, gettone, {
    httpOnly: true, secure: true, sameSite: 'lax', path: PERCORSO_COOKIE, maxAge: DURATA_SOSPESO_MS / 1000,
  })
  return risposta
}

export function azzeraSospesoShopify(risposta: NextResponse): NextResponse {
  risposta.cookies.set(COOKIE_SOSPESO_SHOPIFY, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: PERCORSO_COOKIE, maxAge: 0,
  })
  return risposta
}

// ── IL GETTONE DEI MODULI DELLA SCELTA ──────────────────────────────────────────────────────────

// Anti-CSRF. La pagina si serve con no-referrer, e con no-referrer un browser senza Sec-Fetch-Site (Safari
// prima della 16.4) manda «Origin: null»: il controllo d'origine da solo non basta (lo stesso motivo di
// lib/amazon-pagina.ts). Il gettone lo calcola il server per QUELLA installazione in sospeso (id e impronta:
// cambia a ogni installazione), per QUELL'azione e, per «Collega al conto», per QUEL cliente: se nel
// frattempo nel browser e' entrato un altro conto, il negozio non va a un conto diverso da quello scritto
// sul pulsante.
export type AzioneScelta = 'conferma' | 'accedi'

function firmaModulo(s: Sospeso, azione: AzioneScelta, clienteId: string): string {
  const segreto = process.env.SHOPIFY_API_SECRET || ''
  if (!segreto) return ''
  return crypto.createHmac('sha256', segreto).update(['shopify-collega', s.id, s.chiaveHash, azione, clienteId].join('|')).digest('hex')
}

export function gettoneModuloShopify(s: Sospeso, azione: AzioneScelta, clienteId = ''): string {
  return firmaModulo(s, azione, clienteId)
}

export function gettoneModuloValido(gettone: string, s: Sospeso, azione: AzioneScelta, clienteId = ''): boolean {
  const atteso = firmaModulo(s, azione, clienteId)
  if (!atteso || !/^[0-9a-f]{64}$/.test(gettone)) return false
  return crypto.timingSafeEqual(Buffer.from(gettone, 'hex'), Buffer.from(atteso, 'hex'))
}

// ── CHI PUO' RICEVERE IL NEGOZIO ────────────────────────────────────────────────────────────────

export type VerificaConto =
  | { ok: true; clienteId: string; ragioneSociale: string; codiceCliente: string }
  | { ok: false; motivo: 'non_cliente' | 'disattivato' | 'demo' | 'temporaneo' }

// Un negozio si collega solo a un conto cliente attivo, di un master che non sia una prova: lo controllano
// sia «Collega al conto» (la sessione gia' aperta) sia «Sì, accedo» (le credenziali appena scritte). Il POST
// della scelta puo' partire senza sessione, e allora il middleware non applica il divieto demo sulle
// integrazioni; e l'accesso automatico non guarda «attivo» (lo fa il layout dopo). Master, admin, operatori,
// agenti e autisti non hanno un cliente (il 21/10 nessuno di loro aveva cliente_id): la regola e' quella di
// clienteDellaSessione (lib/accesso-cliente.ts), ruolo 'cliente' con il suo cliente. Le letture col client di
// servizio, solo per l'id appena verificato da Supabase Auth.
export async function verificaContoCliente(admin: any, utenteId: string): Promise<VerificaConto> {
  const { data: u, error: eU } = await admin.from('utenti').select('ruolo,cliente_id,attivo').eq('id', utenteId).maybeSingle()
  if (eU) return { ok: false, motivo: 'temporaneo' }
  if (!u || String(u.ruolo || '').toLowerCase() !== 'cliente' || !u.cliente_id) return { ok: false, motivo: 'non_cliente' }
  if (u.attivo === false) return { ok: false, motivo: 'disattivato' }
  const { data: c, error: eC } = await admin.from('clienti')
    .select('attivo,master_id,ragione_sociale,codice_cliente').eq('id', u.cliente_id).maybeSingle()
  if (eC) return { ok: false, motivo: 'temporaneo' }
  if (!c?.master_id) return { ok: false, motivo: 'non_cliente' }
  if (c.attivo === false) return { ok: false, motivo: 'disattivato' }
  const { data: m, error: eM } = await admin.from('masters').select('demo').eq('id', c.master_id).maybeSingle()
  if (eM) return { ok: false, motivo: 'temporaneo' }
  if (m?.demo === true) return { ok: false, motivo: 'demo' }
  return { ok: true, clienteId: String(u.cliente_id), ragioneSociale: String(c.ragione_sociale || ''), codiceCliente: String(c.codice_cliente || '') }
}

export type SessioneNelBrowser =
  | { tipo: 'cliente'; clienteId: string; ragioneSociale: string; codiceCliente: string }
  | { tipo: 'non_collegabile'; motivo: 'staff' | 'disattivato' | 'demo' }
  | { tipo: 'nessuna' }

// Chi e' gia' entrato in questo browser, per la pagina della scelta e per «Collega al conto». Una lettura
// fallita vale «nessuno»: la pagina offre l'accesso con email e password, che non dipende dalla sessione.
// 'non_collegabile' serve a dire perche' quella sessione non basta: col conto di una prova, o con un
// accesso dello staff, il middleware rifiuta i moduli di questa pagina prima che arrivino alla rotta
// (middleware.ts, divieti per demo, agenti, autisti e canone), e il negoziante deve prima uscire.
export async function sessioneNelBrowser(admin: any, req: NextRequest): Promise<SessioneNelBrowser> {
  const chi = await clienteDellaSessione(admin)
  if (chi) {
    const v = await verificaContoCliente(admin, chi.utenteId)
    if (v.ok) return { tipo: 'cliente', clienteId: v.clienteId, ragioneSociale: v.ragioneSociale, codiceCliente: v.codiceCliente }
    if (v.motivo === 'disattivato' || v.motivo === 'demo') return { tipo: 'non_collegabile', motivo: v.motivo }
    return { tipo: 'nessuna' }
  }
  // Una seconda domanda a Supabase Auth solo se nel browser c'e' davvero una sessione: clienteDellaSessione
  // risponde null sia a chi non e' entrato sia allo staff, e alla pagina serve distinguerli.
  if (!req.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))) return { tipo: 'nessuna' }
  try {
    const { data } = await (await createServerSupabase()).auth.getUser()
    const id = data?.user?.id
    if (!id) return { tipo: 'nessuna' }
    const { data: u } = await admin.from('utenti').select('ruolo').eq('id', id).maybeSingle()
    const ruolo = String(u?.ruolo || '').toLowerCase()
    return ruolo && ruolo !== 'cliente' ? { tipo: 'non_collegabile', motivo: 'staff' } : { tipo: 'nessuna' }
  } catch {
    return { tipo: 'nessuna' }
  }
}

// IL DOPPIO CLIC. Il browser segue solo l'ultima risposta: se il primo invio ha consumato l'installazione e
// sta ancora collegando (o creando il conto), il secondo non trova niente e, senza aspettare, mostrerebbe
// «scaduta» a chi sta per entrare. Si aspetta qualche secondo che la riga del negozio compaia. Restituisce
// il cliente a cui il negozio e' collegato, o null.
export async function attendiCollegamento(admin: any, shop: string): Promise<string | null> {
  for (let giro = 0; giro < 8; giro++) {
    const { data, error } = await admin.from('integrazioni').select('cliente_id,stato')
      .eq('piattaforma', 'shopify').eq('identificativo', shop).maybeSingle()
    if (!error && data?.cliente_id && data.stato === 'attivo') return String(data.cliente_id)
    await new Promise((fatto) => setTimeout(fatto, 600))
  }
  return null
}
