import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { conMemoria, type ContatoreLetture } from '@/lib/db-memoria'
import { prezziPerRighe, type RigaDaPrezzare } from '@/lib/anteprima-prezzi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Un blocco di 13 righe ha richiesto circa 10 secondi, misurato DA LOCALE il 13/10/2026 (quasi tutto
// attesa di rete verso il database, vedi lib/db-memoria.ts; dal server e' atteso meno, ma non e'
// stato misurato). Senza un tetto esplicito varrebbe quello breve di default.
export const maxDuration = 60

/* ANTEPRIMA DEI PREZZI per l'import da file e gli ordini dei negozi (portale CLIENTE).
 *
 * Il cliente manda un blocco di ordini; per ciascuno torna l'elenco dei contratti con cui puo'
 * spedirlo e il prezzo che gli verra' addebitato con ognuno. Il calcolo sta in
 * lib/anteprima-prezzi.ts: qui ci sono solo il perimetro e la forma dei dati.
 *
 * PERCHE' STA SOTTO /api/cliente/ E NON ACCANTO AL PREVENTIVO. Il middleware apre all'agente le
 * scritture per PREFISSO, e '/api/spedizioni/tariffe' e' in quell'elenco: una rotta chiamata
 * '/api/spedizioni/tariffe-lotto' gli sarebbe stata aperta da sola, senza che nessuno lo decidesse.
 *
 * PERIMETRO. Solo il ruolo cliente, e solo per se stesso: cliente, master e listino vengono dalla
 * SESSIONE, mai dal corpo della richiesta. Il corpo e' ricostruito campo per campo.
 *
 * SOLA LETTURA. I client passati al calcolo sono quelli di lib/db-memoria.ts, che sanno fare solo
 * from(...) e letture: da li' non si prenota credito e non si tocca un ordine. La garanzia copre il
 * calcolo che riceve quei client, non una funzione che se ne creasse uno suo. */

// Quante righe in una chiamata. La pagina manda blocchi piu' piccoli; il tetto serve a chi chiama
// la rotta a mano, perche' ogni riga costa letture al database di produzione.
const MAX_RIGHE = 25

// Stringhe COSI' COME ARRIVANO (niente trim, niente maiuscole): sono gli stessi valori che la
// pagina mandera' alla creazione, e l'anteprima coincide con l'addebito solo se i due calcoli
// partono dagli stessi identici dati. Il taglio serve solo a non accettare testi smisurati.
//
// Si accettano SOLO stringhe e numeri. String()/Number() su qualunque cosa sollevano un'eccezione
// con un corpo scritto a mano (un oggetto con un toString che non e' una funzione, un array annidato
// migliaia di volte): fuori dal try, la rotta risponderebbe 500.
const testo = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, max)
const numero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

function rigaDalCorpo(r: any): RigaDaPrezzare | null {
  const id = testo(r?.id, 80)
  if (!id) return null
  const c = (r?.collo && typeof r.collo === 'object') ? r.collo : {}
  return {
    id,
    cap: testo(r?.cap, 20),
    citta: testo(r?.citta, 120),
    provincia: testo(r?.provincia, 60),
    paese: testo(r?.paese, 60) || 'IT',
    collo: { weight: numero(c.weight), length: numero(c.length), width: numero(c.width), height: numero(c.height) },
    contrassegno: numero(r?.contrassegno),
    haContenuto: r?.haContenuto === true,
  }
}

// UNA LETTURA FALLITA NON E' UN RIFIUTO. La pagina tratta 400/401/403 come una decisione ("non
// puoi"): mostra il testo e smette di chiedere. Se un inciampo del database nel leggere l'utente o
// il cliente uscisse di qui come 403 "Non autorizzato", il cliente leggerebbe di non essere
// autorizzato su tutta la colonna dei prezzi — mentre puo' spedire. Un inciampo e' un 503: la
// pagina lo ritenta da sola.
const inciampo = () => NextResponse.json({ error: 'Errore tecnico nel calcolo dei prezzi: riprova tra poco.' }, { status: 503 })
// "Nessuna riga" di single() e' una risposta, non un guasto.
const guasto = (e: any): boolean => !!e && e.code !== 'PGRST116'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: erroreSessione } = await supabase.auth.getUser()
  if (!user) {
    const e: any = erroreSessione
    if (e && (e.name === 'AuthRetryableFetchError' || Number(e.status) >= 500)) return inciampo()
    return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  }

  const { data: utente, error: erroreUtente } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (guasto(erroreUtente)) return inciampo()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  let corpo: any
  try { corpo = await req.json() } catch { return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 }) }

  const grezze: any[] = Array.isArray(corpo?.righe) ? corpo.righe : []
  if (!grezze.length) return NextResponse.json({ righe: [] })
  if (grezze.length > MAX_RIGHE) {
    return NextResponse.json({ error: `Troppi ordini in una sola richiesta (massimo ${MAX_RIGHE}).` }, { status: 400 })
  }
  const righe = grezze.map(rigaDalCorpo).filter((r): r is RigaDaPrezzare => !!r)

  // Il mittente entra nel prezzo (supplemento di origine, copertura in partenza): deve essere lo
  // stesso che la pagina mandera' alla creazione, che senza provincia del mittente rifiuta.
  const mittente = { cap: testo(corpo?.mittente?.cap, 20), provincia: testo(corpo?.mittente?.provincia, 60) }
  if (!mittente.cap.trim() || !mittente.provincia.trim()) {
    return NextResponse.json({ error: 'Indirizzo di partenza incompleto: servono CAP e provincia del mittente.' }, { status: 400 })
  }

  const { data: cliente, error: erroreCliente } = await supabase.from('clienti')
    .select('master_id,listino_cliente_id,impostazioni,vieta_inserimento').eq('id', utente.cliente_id).single()
  if (guasto(erroreCliente)) return inciampo()
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  // Chi non puo' inserire spedizioni non ha un prezzo da vedere: la creazione lo fermerebbe.
  if ((cliente as any).vieta_inserimento === true) {
    return NextResponse.json({ error: 'Inserimento spedizioni non consentito per questo cliente.' }, { status: 403 })
  }

  const lettureUtente: ContatoreLetture = { letture: 0, riusi: 0 }
  const lettureAdmin: ContatoreLetture = { letture: 0, riusi: 0 }
  try {
    const esiti = await prezziPerRighe({
      dbUtente: conMemoria(supabase, lettureUtente),
      dbAdmin: conMemoria(createAdminSupabase(), lettureAdmin),
      clienteId: utente.cliente_id,
      cliente: cliente as any,
      mittente,
    }, righe)
    // LETTURE TORNATE CON ERRORE: le funzioni dei prezzi guardano quasi tutte solo `data`, e su un
    // errore ripiegano in silenzio (listino non letto = regole di default). Il guscio sa sollevare
    // al loro posto (erroreComeEccezione), ma accenderlo senza sapere se in produzione qualche
    // lettura fallisce SEMPRE per qualche cliente vorrebbe dire togliergli i prezzi — e fermargli
    // le spedizioni di massa. Sulle 200 spedizioni di prova del 13/10/2026 gli errori sono zero;
    // qui si misura sul traffico vero. Se questo log resta vuoto, l'opzione si puo' accendere.
    if (lettureUtente.errori || lettureAdmin.errori) {
      console.error('[ANTEPRIMA] letture tornate con errore', { cliente: utente.cliente_id, sessione: lettureUtente.errori || null, servizio: lettureAdmin.errori || null })
    }
    return NextResponse.json({ righe: esiti })
  } catch (e: any) {
    console.error('[ANTEPRIMA] calcolo fallito', { cliente: utente.cliente_id, righe: righe.length, errore: e?.message || String(e) })
    return NextResponse.json({ error: 'Errore tecnico nel calcolo dei prezzi: riprova tra poco.' }, { status: 500 })
  }
}
