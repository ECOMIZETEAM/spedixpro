import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaCredenzialiCliente } from '@/lib/email'
import { inserisciClienteConCodice, codiceGiaPreso, indirizzoInternoRifiutato } from '@/lib/codice-cliente'

/* REGISTRAZIONE dal SITO PUBBLICO (www.moovexpress.com): un visitatore diventa cliente vero.
 *
 * E' la porta piu' delicata del sito: crea una riga in `clienti`, un accesso, e manda una
 * password. Ogni scelta qui e' pensata per NON regalare, a chi manda la richiesta, poteri che il
 * portale non gli darebbe. Il modello e' quello della rotta preventivo, non quello di
 * app/api/clienti/crea (che presuppone un master gia' loggato):
 *
 * 1. IL PERIMETRO E' FISSO A CODICE. Master (MULTIEXPRESS), listino (Standard Web),
 *    tipo di contratto (credito scalare) e credito (zero) sono scritti qui sotto, MAI letti dal
 *    corpo. Chi si registra sceglie solo chi e' e come lo si contatta, niente altro.
 *
 * 2. IL CORPO SI RICOSTRUISCE CAMPO PER CAMPO. Un `master_id`, un `listino_cliente_id`, un
 *    `credito`, un `tipo_contratto` o un `api_*` inviati da fuori non arrivano mai all'insert:
 *    non li leggiamo. (app/api/clienti/crea prende dal corpo 20 campi fra cui il listino: quella
 *    rotta ha una sessione che la protegge, questa no.)
 *
 * 3. NON SI PUO' SPEDIRE FINCHE' NON SI PAGA. Il cliente nasce con credito 0 e contratto a credito
 *    scalare: il blocco in lib/cascata.ts glielo impedisce da qualunque porta, senza che questa
 *    rotta debba aggiungere guardie. E' il "paga o non spedisce" chiesto.
 *
 * 4. DIFESE DA PORTA PUBBLICA come le altre: origine stretta (CORS), freno per IP, trappola.
 *    Il danno che un robot puo' fare e' limitato — clienti a credito zero che non spediscono — ma
 *    ogni registrazione manda una email, e senza freno un robot ci fa sospendere il dominio Resend.
 */

const MULTIEXPRESS = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
const LISTINO_WEB = '4e6658e9-e975-4057-8c78-b258fbc98a64'

const ORIGINI = ['https://www.moovexpress.com', 'https://moovexpress-web.vercel.app']

// Freno in memoria come per contatti/tariffe: registrarsi non e' un'azione frequente, quindi
// stretto. Non sopravvive tra istanze serverless (il tetto vero e' MAX x istanze vive), ma alza
// abbastanza il costo da rendere inutile la raffica da un solo indirizzo.
const visti = new Map<string, number[]>()
const FINESTRA = 10 * 60 * 1000
const MAX = 5
function troppeRichieste(ip: string): boolean {
  const ora = Date.now()
  const p = (visti.get(ip) || []).filter(t => ora - t < FINESTRA)
  p.push(ora); visti.set(ip, p)
  if (visti.size > 5000) for (const [k, v] of visti) if (!v.some(t => ora - t < FINESTRA)) visti.delete(k)
  return p.length > MAX
}

const intestazioni = (o: string | null) => ({
  'Access-Control-Allow-Origin': ORIGINI.includes(o || '') ? o! : ORIGINI[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
})

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: intestazioni(req.headers.get('origin')) })
}

// Password CRITTOGRAFICAMENTE casuale (randomInt, non Math.random: quella e' prevedibile e non va
// mai usata per un segreto). Almeno 12 caratteri: sotto quella soglia Supabase rifiuta.
function generaPassword(len = 14): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[randomInt(chars.length)]
  return out
}

const pulisci = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(req: NextRequest) {
  const origine = req.headers.get('origin')
  const H = intestazioni(origine)
  const no = (errore: string, stato: number) => NextResponse.json({ errore }, { status: stato, headers: H })

  if (origine && !ORIGINI.includes(origine)) return no('Richiesta non consentita.', 403)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ignoto'
  if (troppeRichieste(ip)) return no('Troppe richieste. Riprova fra qualche minuto.', 429)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return no('Richiesta non valida.', 400) }

  // Trappola: un campo che una persona non vede mai. Se arriva pieno rispondiamo ok e non facciamo
  // niente — dire "scartato" insegnerebbe al robot a non compilarlo.
  if (pulisci(corpo.sito)) return NextResponse.json({ ok: true }, { headers: H })

  // ── I SOLI campi che leggiamo dal corpo. Tutto il resto (perimetro, credito, listino) e' a codice.
  const tipo = corpo.tipo === 'privato' ? 'privato' : 'azienda'
  const email = pulisci(corpo.email, 160).toLowerCase()
  const telefono = pulisci(corpo.telefono, 40)
  const ragioneSociale = pulisci(corpo.ragione_sociale, 160)   // azienda: ragione sociale; privato: nome e cognome
  const piva = pulisci(corpo.piva, 20)
  const cf = pulisci(corpo.cf, 20).toUpperCase()
  const rappresentante = pulisci(corpo.rappresentante_legale, 160)

  // ── Validazione, con messaggi per chi compra, non per chi configura.
  if (!email) return no("Serve l'email.", 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return no("L'indirizzo email non sembra valido.", 400)
  if (!telefono) return no('Serve un numero di telefono.', 400)
  if (!ragioneSociale) return no(tipo === 'privato' ? 'Serve il nome e cognome.' : 'Serve la ragione sociale.', 400)
  if (tipo === 'azienda') {
    if (!piva) return no('Serve la partita IVA.', 400)
    if (!/^\d{11}$/.test(piva)) return no('La partita IVA deve avere 11 cifre.', 400)
    if (!rappresentante) return no('Serve il nome del rappresentante legale.', 400)
  } else {
    if (!cf) return no('Serve il codice fiscale.', 400)
    if (!/^[A-Z0-9]{11,16}$/.test(cf)) return no('Il codice fiscale non sembra valido.', 400)
  }

  const admin = createAdminSupabase()

  // Email gia' usata? Rispondo prima, con una frase utile invece dell'errore grezzo del database.
  // (L'unicita' vera la garantisce comunque l'indice clienti_email_key: qui e' solo cortesia, e
  //  sotto gestisco il 23505 in caso di due richieste simultanee.)
  const { data: gia } = await admin.from('clienti').select('id').eq('email', email).maybeSingle()
  if (gia) return no('Questa email è già registrata. Accedi al portale o usa il recupero password.', 409)

  // ── Inserimento cliente. Il codice progressivo, e la riprova se due registrazioni simultanee
  // (la normalita' di una porta pubblica) prendono lo stesso numero, e' la regola unica di
  // lib/codice-cliente.ts. Qui prima c'era la formula alfabetica, che su MULTIEXPRESS reggeva solo
  // perche' il suo ultimo codice in alfabeto era anche il piu' alto.
  const { data: inserito, error } = await inserisciClienteConCodice(admin, {
    master_id: MULTIEXPRESS,
    ragione_sociale: ragioneSociale,
    email,
    telefono: telefono || null,
    piva: tipo === 'azienda' ? piva : null,
    cf: tipo === 'privato' ? cf : null,
    rappresentante_legale: tipo === 'azienda' ? rappresentante : null,
    // PERIMETRO FISSO — mai dal corpo:
    listino_cliente_id: LISTINO_WEB,
    tipo_contratto: 'credito_scalare',   // nasce a credito scalare: senza credito non spedisce
    attivo: true,
    // credito NON impostato: default 0. api_* NON impostati: default esente/free.
  })
  if (error || !inserito) {
    const msg = String(error?.message || '')
    if (error?.code === '23505' && msg.includes('clienti_email_key'))
      return no('Questa email è già registrata. Accedi al portale o usa il recupero password.', 409)
    if (indirizzoInternoRifiutato(error))
      return no('Questo indirizzo email non può essere usato per registrarsi: usa la tua email.', 400)
    if (codiceGiaPreso(error))   // numero preso anche dopo i tentativi
      return no('Registrazione momentaneamente non disponibile. Riprova fra poco.', 503)
    console.error('[pubblico/registrazione] insert cliente', error)
    return no('Non siamo riusciti a completare la registrazione. Riprova o scrivici.', 500)
  }
  const nuovoCliente = { id: inserito.id as string }

  // ── Accesso: l'utente auth PRIMA delle credenziali. Se qui fallisce, la registrazione e' a
  // meta' (cliente senza login): cancello la riga appena creata — non ha storico attaccato, e'
  // nata in questa richiesta — per non lasciare un cliente-fantasma senza accesso.
  const password = generaPassword()
  const { data: authUser, error: aErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (aErr || !authUser?.user) {
    console.error('[pubblico/registrazione] createUser', aErr)
    // rollback della sola riga di questa richiesta; l'esito si legge, un cliente rimasto a meta' va visto
    const { error: dErr } = await admin.from('clienti').delete().eq('id', nuovoCliente.id)
    if (dErr) console.error('[pubblico/registrazione] rollback cliente NON riuscito', nuovoCliente.id, dErr.message)
    // Email gia' presente in auth ma non fra i clienti: caso raro, lo trattiamo come "gia' registrata".
    if (String(aErr?.message || '').toLowerCase().includes('already'))
      return no('Questa email è già registrata. Accedi al portale o usa il recupero password.', 409)
    return no('Non siamo riusciti ad attivare l’accesso. Riprova o scrivici.', 500)
  }

  // Riga utenti (client ADMIN: la riga e' di un altro utente, l'RLS bloccherebbe il client di
  // sessione). I campi di sistema li scrive solo la piattaforma — vedi il trigger su `utenti`.
  const { error: uErr } = await admin.from('utenti').insert({
    id: authUser.user.id, ruolo: 'cliente', master_id: MULTIEXPRESS,
    cliente_id: nuovoCliente.id, nome: ragioneSociale, attivo: true,
  })
  if (uErr) {
    console.error('[pubblico/registrazione] insert utenti', uErr)
    // deleteUser restituisce l'errore, non lo lancia: un .catch() qui non prendeva niente.
    const { error: duErr } = await admin.auth.admin.deleteUser(authUser.user.id)
    if (duErr) console.error('[pubblico/registrazione] rollback utente di login NON riuscito', authUser.user.id, duErr.message)
    const { error: dErr } = await admin.from('clienti').delete().eq('id', nuovoCliente.id)
    if (dErr) console.error('[pubblico/registrazione] rollback cliente NON riuscito', nuovoCliente.id, dErr.message)
    return no('Non siamo riusciti ad attivare l’accesso. Riprova o scrivici.', 500)
  }

  // ── Credenziali per email. Sul sito pubblico la password NON torna nella risposta (a differenza
  // del portale master, dove il master la legge per darla): esce solo dalla casella del cliente.
  try {
    await inviaCredenzialiCliente({
      email, nomeCliente: ragioneSociale, masterNome: 'MoovExpress',
      dominio: 'moovexpress.com', password,
    })
  } catch (e) {
    // L'accesso esiste comunque: se la mail non parte, il cliente puo' usare il recupero password.
    console.error('[pubblico/registrazione] email credenziali', e)
  }

  return NextResponse.json({
    ok: true,
    email,
    // Cosa dire al visitatore: controlla la posta, poi accedi e ricarica per spedire.
    messaggio: 'Account creato. Ti abbiamo inviato le credenziali via email. Accedi e ricarica il credito per spedire.',
  }, { headers: H })
}
