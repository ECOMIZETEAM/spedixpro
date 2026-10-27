import { NextRequest, NextResponse } from 'next/server'
import { randomInt, randomBytes } from 'crypto'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pianoById } from '@/lib/piani'
import { inviaRichiestaPartner } from '@/lib/email'
import { MASTER_VETRINA } from '@/lib/vetrina'

/* AUTO-REGISTRAZIONE MASTER dal SITO PUBBLICO (www.moovexpress.com/prezzi → "Attiva questo piano").
 *
 * Stessa filosofia della registrazione clienti (app/api/pubblico/registrazione), con UNA differenza
 * fondamentale: il master NON nasce operativo. Un master sotto MOOVY può creare clienti e
 * usare i contratti della rete — troppo per una porta pubblica. Quindi qui si crea solo una RICHIESTA:
 *   - master `attivo = false`, `registrazione_stato = 'da_approvare'`;
 *   - NESSUN accesso/credenziali (li crea l'admin quando approva, dal portale);
 *   - il piano scelto e la preferenza contratti (nostri/propri) restano registrati per la revisione.
 *
 * Difese da porta pubblica come le altre: perimetro FISSO a codice (parent = il master della vetrina,
 * lib/vetrina.ts, mai dal corpo), CORS stretto, freno per IP, trappola. Il corpo si legge campo per campo: un `parent_master_id`,
 * un `abbonamento_*`, un `attivo` inviati da fuori non arrivano MAI all'insert.
 */

const ORIGINI = ['https://www.moovexpress.com', 'https://moovexpress-web.vercel.app']

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

const pulisci = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
function slugify(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'master'
}
function suffisso(): string {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let o = ''; for (let i = 0; i < 5; i++) o += c[randomInt(c.length)]; return o
}

export async function POST(req: NextRequest) {
  const origine = req.headers.get('origin')
  const H = intestazioni(origine)
  const no = (errore: string, stato: number) => NextResponse.json({ errore }, { status: stato, headers: H })

  if (origine && !ORIGINI.includes(origine)) return no('Richiesta non consentita.', 403)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ignoto'
  if (troppeRichieste(ip)) return no('Troppe richieste. Riprova fra qualche minuto.', 429)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return no('Richiesta non valida.', 400) }

  // Trappola anti-robot: campo invisibile a una persona.
  if (pulisci(corpo.sito)) return NextResponse.json({ ok: true }, { headers: H })

  // ── I SOLI campi letti dal corpo. Perimetro, stato e piano-attivo restano a codice.
  const email = pulisci(corpo.email, 160).toLowerCase()
  const telefono = pulisci(corpo.telefono, 40)
  const ragioneSociale = pulisci(corpo.ragione_sociale, 160)
  const piva = pulisci(corpo.piva, 20)
  const pianoId = pulisci(corpo.piano, 40)
  const contrattiPreferenza = corpo.contratti === 'propri' ? 'propri' : corpo.contratti === 'misto' ? 'misto' : 'nostri'
  const volume = pulisci(corpo.volume, 40)
  // Corrieri di interesse: solo BRAND (mai i nomi dei fornitori tecnici), da una lista chiusa.
  const CORRIERI_VALIDI = ['BRT', 'Poste', 'UPS', 'SDA', 'GLS', 'DHL']
  const corrieri = Array.isArray(corpo.corrieri)
    ? Array.from(new Set((corpo.corrieri as unknown[]).map(v => pulisci(v, 20)).filter(v => CORRIERI_VALIDI.includes(v))))
    : []
  const token = randomBytes(16).toString('hex')   // 32 hex → pagina pubblica "stato richiesta"

  // ── Validazione.
  if (!email) return no("Serve l'email.", 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return no("L'indirizzo email non sembra valido.", 400)
  if (!telefono) return no('Serve un numero di telefono.', 400)
  if (!ragioneSociale) return no('Serve la ragione sociale.', 400)
  if (!piva || !/^\d{11}$/.test(piva)) return no('Serve la partita IVA (11 cifre).', 400)
  const piano = pianoById(pianoId)
  if (!piano) return no('Piano non valido.', 400)
  // Piani NASCOSTI (riservati a singoli master concordati fuori listino): non richiedibili in
  // autoregistrazione pubblica — li assegna la piattaforma.
  if ((piano as any).nascosto) return no('Piano non valido.', 400)

  const admin = createAdminSupabase()

  // Email già usata da un master? (indice unico masters_email garantisce la corsa; qui è cortesia.)
  const { data: giaM } = await admin.from('masters').select('id').eq('email', email).maybeSingle()
  if (giaM) return no('Questa email è già registrata. Se hai già un account, accedi al portale.', 409)

  // ── Inserimento come RICHIESTA (attivo=false, da approvare). Riprova sullo slug in caso di collisione.
  let creato: { id: string } | null = null
  for (let t = 0; t < 6 && !creato; t++) {
    const slug = `${slugify(ragioneSociale)}-${suffisso()}`.slice(0, 60)
    const { data, error } = await admin.from('masters').insert({
      nome: ragioneSociale, slug, email, telefono, piva, partita_iva: piva,
      parent_master_id: MASTER_VETRINA,      // PERIMETRO FISSO, mai dal corpo
      tipo_contratto: 'credito_scalare',
      attivo: false,                          // non opera finché non lo approva l'admin
      autoregistrato_il: new Date().toISOString(),
      registrazione_stato: 'da_approvare',
      contratti_preferenza: contrattiPreferenza,
      piano_richiesto: piano.id,
      corrieri_interesse: corrieri.length ? corrieri : null,
      volume_stimato: volume || null,
      richiesta_token: token,
    }).select('id').single()
    if (!error && data) { creato = data; break }
    const msg = String(error?.message || '')
    if (error?.code === '23505' && /slug/.test(msg)) continue
    if (error?.code === '23505' && /email/.test(msg)) return no('Questa email è già registrata. Accedi al portale.', 409)
    console.error('[pubblico/registrazione-master] insert master', error)
    return no('Non siamo riusciti a inviare la richiesta. Riprova o scrivici.', 500)
  }
  if (!creato) return no('Registrazione momentaneamente non disponibile. Riprova fra poco.', 503)

  // Email al richiedente: "richiesta ricevuta / in revisione" con link alla pagina di stato.
  const linkStato = `https://www.moovexpress.com/stato-richiesta/${token}`
  try { await inviaRichiestaPartner({ to: email, nome: ragioneSociale, piano: piano.nome, link: linkStato }) } catch {}

  // Avvisa chi deve approvare. La campanella (app/api/notifiche/mie) mostra solo le notifiche del PROPRIO
  // master, non risale la catena come il pannello da approvare: quindi una riga al master della vetrina
  // (MOOVY) e una al suo padre (MULTIEXPRESS), che le riceveva fino al 27/10 e approva come prima.
  try {
    const { data: vetrina } = await admin.from('masters').select('parent_master_id').eq('id', MASTER_VETRINA).maybeSingle()
    const destinatari = [MASTER_VETRINA, vetrina?.parent_master_id].filter(Boolean) as string[]
    const messaggio = `${ragioneSociale} — piano ${piano.nome}, listini ${contrattiPreferenza === 'propri' ? 'PROPRI' : contrattiPreferenza === 'misto' ? 'MISTI (nostri+suoi)' : 'MoovExpress'}${corrieri.length ? ', corrieri: ' + corrieri.join(', ') : ''}${volume ? ', ~' + volume + '/mese' : ''}. Da approvare.`
    await admin.from('notifiche').insert(destinatari.map(m => ({
      master_id: m, cliente_id: null, gruppi: ['Amministratore'],
      oggetto: 'Nuova richiesta rivenditore', link: '/dashboard/clienti/master', messaggio,
    })))
  } catch {}

  return NextResponse.json({
    ok: true,
    token,
    messaggio: 'Richiesta ricevuta! La verifichiamo e ti ricontattiamo per attivare l’account.',
  }, { headers: H })
}
