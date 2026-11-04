import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { credenzialiDaTokenTiktok } from '@/lib/tiktok'

// COLLEGARE UN NEGOZIO TIKTOK SHOP A UN CONTO, DA QUALUNQUE PORTA ARRIVI.
//
// Le porte sono due. Dal portale («+ Collega negozio»): /install mette nello state il cliente che ha
// cliccato, e il callback sa a chi va il negozio. Dall'App Store del Seller Center di TikTok: il venditore
// installa l'app da li', e TikTok lo rimanda al nostro Redirect URL con il SOLO codice d'autorizzazione,
// senza state (guida «Authorization via App Store», passo 4: «sign in to your app … to bind the
// authorization to the seller account in your system»). Fino al 4/11/2026 il callback senza state
// rispondeva «annullato»: con l'app pubblicata, ogni installazione dall'App Store sarebbe fallita.
//
// Senza state non si sa di chi sia il negozio: lo dice il venditore entrando nel suo conto MoovExpress.
// Fra il ritorno da TikTok e quella conferma i token aspettano in un cookie CIFRATO (AES-256-GCM, chiave
// derivata dal segreto dell'app): il browser lo porta ma non lo legge, niente tabella nuova da aprire e
// chiudere, e scade da solo in 15 minuti come l'installazione in sospeso di Shopify (lib/shopifyCollega.ts).
// Qui non si chiede la password: Shopify lo fa nella sua pagina e conta i tentativi sbagliati nel database;
// per TikTok si entra dal modulo d'accesso normale, in un'altra scheda, e si torna sulla pagina.

export const PAGINA_COLLEGA_TIKTOK = '/api/integrazioni/tiktok/collega'
export const COOKIE_SOSPESO_TIKTOK = '__Secure-tiktok-installazione'
const PERCORSO_COOKIE = '/api/integrazioni/tiktok'
export const DURATA_SOSPESO_TIKTOK_MS = 15 * 60 * 1000

export type CredenzialiTiktok = ReturnType<typeof credenzialiDaTokenTiktok>
export type NegozioTiktok = { id: string; cipher: string; nome: string; regione: string | null }

// I negozi autorizzati (authorization/202309/shops). Uno senza id o senza cipher non e' chiamabile: si scarta.
export function negoziDaShops(shops: any[]): NegozioTiktok[] {
  return (shops || [])
    .filter((s: any) => s?.id && s?.cipher)
    .map((s: any) => ({ id: String(s.id), cipher: String(s.cipher), nome: String(s.name || 'TikTok Shop'), regione: s.region ? String(s.region) : null }))
}

const conNegozio = (cred: CredenzialiTiktok, n: NegozioTiktok) => ({ ...cred, shop_cipher: n.cipher, shop_id: n.id, shop_region: n.regione })

// ── UN NEGOZIO = UN CLIENTE ─────────────────────────────────────────────────────────────────────

export type EsitoCollegamentoTiktok = { ok: true } | { ok: false; codice: 'tiktok_altro_account' | 'tiktok_non_salvato' }

// LA REGOLA UNICA, per le due porte. Fino al 4/11/2026 il callback cercava la riga per cliente E negozio:
// lo stesso negozio collegato da un secondo cliente diventava una seconda riga, e i suoi ordini — con nomi,
// indirizzi e telefoni dei compratori — finivano anche nel portale di un terzo. Ora si cerca per negozio:
// - e' di un altro cliente che esiste: non si sposta. I token nuovi si salvano pero' sulla sua riga, perche'
//   sono di quel negozio e piu' recenti dei suoi (come fa Shopify, lib/shopifyCollega.ts);
// - punta a un cliente che non esiste piu' (su `integrazioni` non c'e' foreign key): si riprende;
// - e' di questo cliente, o non c'e': si scrive.
// master_id si rilegge dal cliente: finisce su ogni ordine importato (lib/tiktokSync). Le scritture vanno col
// client di servizio: al ritorno dall'OAuth la sessione puo' mancare, e `credenziali` non e' leggibile da
// `authenticated`. Ogni scrittura rimette stato 'attivo' ed errore vuoto.
export async function collegaNegozioTiktok(
  admin: any,
  opz: { clienteId: string; negozio: NegozioTiktok; credenziali: CredenzialiTiktok },
): Promise<EsitoCollegamentoTiktok> {
  const clienteId = String(opz.clienteId)
  const { negozio } = opz
  const credenziali = conNegozio(opz.credenziali, negozio)
  const nonSalvato = (cosa: string, e?: { message?: string } | null): EsitoCollegamentoTiktok => {
    console.error('[TIKTOK][COLLEGA] negozio non collegato:', cosa, negozio.id, clienteId, e?.message || '')
    return { ok: false, codice: 'tiktok_non_salvato' }
  }

  const { data: cliente, error: eCli } = await admin.from('clienti').select('master_id').eq('id', clienteId).maybeSingle()
  if (eCli) return nonSalvato('lettura del cliente', eCli)
  if (!cliente?.master_id) return nonSalvato('cliente inesistente o senza master')

  for (let giro = 0; giro < 3; giro++) {
    const { data: righe, error: eRighe } = await admin.from('integrazioni').select('id,cliente_id')
      .eq('piattaforma', 'tiktok').eq('identificativo', negozio.id)
    // Una lettura fallita non e' «negozio libero»: si inserirebbe una seconda riga per lo stesso negozio.
    if (eRighe) return nonSalvato('lettura della riga del negozio', eRighe)

    const mia = (righe || []).find((r: any) => String(r.cliente_id) === clienteId)
    let daRiprendere: any = null
    if (!mia) {
      for (const r of righe || []) {
        const { data: proprietario, error: eProp } = await admin.from('clienti').select('id').eq('id', r.cliente_id).maybeSingle()
        if (eProp) return nonSalvato('lettura del proprietario', eProp)
        if (proprietario) {
          const { error } = await admin.from('integrazioni').update({ credenziali, stato: 'attivo', errore: null }).eq('id', r.id)
          if (error) console.error('[TIKTOK][COLLEGA] token nuovo NON salvato sul proprietario', negozio.id, error.message)
          console.error('[TIKTOK][COLLEGA] negozio gia collegato ad altro cliente: non spostato', negozio.id, clienteId)
          return { ok: false, codice: 'tiktok_altro_account' }
        }
        daRiprendere = daRiprendere || r
      }
    }

    const payload = {
      master_id: String(cliente.master_id), cliente_id: clienteId, piattaforma: 'tiktok',
      nome_negozio: negozio.nome, identificativo: negozio.id, credenziali, stato: 'attivo', errore: null,
    }
    const riga = mia || daRiprendere
    if (riga) {
      if (!mia) console.error('[TIKTOK][COLLEGA] la riga del negozio puntava a un cliente che non esiste piu: ripresa', negozio.id, riga.cliente_id)
      // Con .select() si sa se la riga c'era ancora: senza, si direbbe «collegato» senza aver scritto niente.
      const { data: scritte, error } = await admin.from('integrazioni').update(payload).eq('id', riga.id).select('id')
      if (error) return nonSalvato('aggiornamento', error)
      if (scritte?.length) return { ok: true }
      continue
    }
    const { error } = await admin.from('integrazioni').insert(payload)
    if (!error) return { ok: true }
    if (error.code !== '23505') return nonSalvato('inserimento', error)
  }
  return nonSalvato('la riga del negozio cambiava a ogni lettura')
}

// RIAUTORIZZAZIONE DALL'APP STORE. TikTok manda l'avviso 30 giorni prima che un'autorizzazione scada, e il
// venditore la rinnova dal Seller Center: torna qui col codice e senza state. Il negozio ha gia' il suo conto,
// quindi non serve chiedergli niente: si rinnovano i token sulla sua riga. Restano da chiedere solo i negozi
// che nessun cliente esistente ha. Una lettura fallita lascia il negozio fra quelli da chiedere: la conferma
// rifara' la regola qui sopra, che non sposta niente.
export async function rinnovaNegoziGiaCollegati(admin: any, negozi: NegozioTiktok[], cred: CredenzialiTiktok): Promise<NegozioTiktok[]> {
  const daChiedere: NegozioTiktok[] = []
  for (const n of negozi) {
    const { data: righe, error } = await admin.from('integrazioni').select('id,cliente_id')
      .eq('piattaforma', 'tiktok').eq('identificativo', n.id)
    if (error || !righe?.length) { daChiedere.push(n); continue }
    let rinnovato = false
    for (const r of righe) {
      const { data: proprietario } = await admin.from('clienti').select('id').eq('id', r.cliente_id).maybeSingle()
      if (!proprietario) continue
      const { error: eUp } = await admin.from('integrazioni').update({ credenziali: conNegozio(cred, n), stato: 'attivo', errore: null }).eq('id', r.id)
      if (eUp) console.error('[TIKTOK][COLLEGA] rinnovo token non salvato', n.id, eUp.message)
      else rinnovato = true
    }
    if (!rinnovato) daChiedere.push(n)
  }
  return daChiedere
}

// ── L'INSTALLAZIONE IN SOSPESO, NEL COOKIE CIFRATO ───────────────────────────────────────────────

export type SospesoTiktok = { id: string; scade: number; credenziali: CredenzialiTiktok; negozi: NegozioTiktok[] }

function chiave(): Buffer | null {
  const segreto = process.env.TIKTOK_APP_SECRET || ''
  if (!segreto) return null
  return crypto.createHash('sha256').update('moovexpress|tiktok-installazione|' + segreto, 'utf8').digest()
}

// Restituisce il valore del cookie, o null se il segreto dell'app manca (allora non si collega niente).
export function sigillaSospesoTiktok(credenziali: CredenzialiTiktok, negozi: NegozioTiktok[], ora = Date.now()): string | null {
  const k = chiave()
  if (!k) return null
  const s: SospesoTiktok = { id: crypto.randomBytes(16).toString('hex'), scade: ora + DURATA_SOSPESO_TIKTOK_MS, credenziali, negozi }
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const dati = Buffer.concat([c.update(JSON.stringify(s), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), dati]).toString('base64url')
}

// L'installazione che aspetta in QUESTO browser: null se manca, e' scaduta o non si decifra (un cookie
// alterato non passa il controllo di GCM).
export function sospesoTiktokDelBrowser(req: NextRequest, ora = Date.now()): SospesoTiktok | null {
  const valore = req.cookies.get(COOKIE_SOSPESO_TIKTOK)?.value || ''
  const k = chiave()
  if (!valore || !k) return null
  try {
    const b = Buffer.from(valore, 'base64url')
    if (b.length < 29) return null
    const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12))
    d.setAuthTag(b.subarray(12, 28))
    const s = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')) as SospesoTiktok
    if (!s?.id || !(Number(s.scade) > ora) || !s.credenziali?.access_token || !Array.isArray(s.negozi) || !s.negozi.length) return null
    return s
  } catch {
    return null
  }
}

export function conCookieSospesoTiktok(risposta: NextResponse, valore: string): NextResponse {
  // SameSite=Lax: arriva sulla pagina della conferma anche se il giro e' partito dal Seller Center (una
  // navigazione da un altro sito), e non parte con un modulo inviato da un altro sito.
  risposta.cookies.set(COOKIE_SOSPESO_TIKTOK, valore, {
    httpOnly: true, secure: true, sameSite: 'lax', path: PERCORSO_COOKIE, maxAge: DURATA_SOSPESO_TIKTOK_MS / 1000,
  })
  return risposta
}

export function azzeraSospesoTiktok(risposta: NextResponse): NextResponse {
  risposta.cookies.set(COOKIE_SOSPESO_TIKTOK, '', { httpOnly: true, secure: true, sameSite: 'lax', path: PERCORSO_COOKIE, maxAge: 0 })
  return risposta
}

// Anti-CSRF del modulo «Collega a questo conto», per QUELL'installazione e per QUEL cliente: se nel frattempo
// nel browser e' entrato un altro conto, il negozio non va a un conto diverso da quello scritto sul pulsante.
function firma(s: SospesoTiktok, clienteId: string): string {
  const segreto = process.env.TIKTOK_APP_SECRET || ''
  if (!segreto) return ''
  return crypto.createHmac('sha256', segreto).update(['tiktok-collega', s.id, clienteId].join('|')).digest('hex')
}

export function gettoneModuloTiktok(s: SospesoTiktok, clienteId: string): string {
  return firma(s, clienteId)
}

export function gettoneModuloTiktokValido(gettone: string, s: SospesoTiktok, clienteId: string): boolean {
  const atteso = firma(s, clienteId)
  if (!atteso || !/^[0-9a-f]{64}$/.test(gettone)) return false
  return crypto.timingSafeEqual(Buffer.from(gettone, 'hex'), Buffer.from(atteso, 'hex'))
}
