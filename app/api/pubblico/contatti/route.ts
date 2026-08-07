import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

/* Le richieste che arrivano dal SITO PUBBLICO (www.moovexpress.com) diventano un'email.
 *
 * Sta qui e non nel progetto del sito per una ragione sola: la chiave dell'invio esiste
 * gia' qui e funziona da mesi. Duplicarla in un secondo progetto vuol dire due chiavi da
 * ruotare, due posti in cui puo' scadere, e il giorno che una smette di funzionare non si
 * capisce quale. Un posto solo che manda posta.
 *
 * E' una rotta PUBBLICA su un dominio di produzione, quindi e' anche una porta aperta:
 * le difese sono tre e nessuna e' decorativa.
 *   1. ORIGINE — risponde solo alle pagine del nostro sito, con i CORS stretti.
 *   2. TRAPPOLA — un campo che una persona non vede mai; se arriva pieno si scarta in silenzio.
 *   3. FRENO — poche richieste per indirizzo IP: senza, un robot ci fa spedire mille email
 *      e Resend ci sospende il dominio, bloccando anche le credenziali dei clienti veri.
 */

const ORIGINI = [
  'https://www.moovexpress.com',
  'https://moovexpress-web.vercel.app',
]

const A = process.env.CONTATTI_A || 'info@moovexpress.com'

const ETICHETTE: Record<string, string> = {
  spedire: 'Ha pacchi da spedire',
  rivendere: 'Vuole rivendere con il proprio marchio',
  api: 'Vuole collegare il gestionale con le API',
  altro: 'Altro',
}

// Freno in memoria: non sopravvive al riavvio della funzione, e va bene cosi'. Serve a
// fermare la raffica, non a tenere un registro. Un contatore persistente per un modulo
// contatti sarebbe piu' fragile del problema che risolve.
const visti = new Map<string, number[]>()
const FINESTRA = 10 * 60 * 1000   // 10 minuti
const MAX = 5

function troppeRichieste(ip: string): boolean {
  const ora = Date.now()
  const precedenti = (visti.get(ip) || []).filter(t => ora - t < FINESTRA)
  precedenti.push(ora)
  visti.set(ip, precedenti)
  // La mappa non cresce all'infinito: ogni tanto si buttano via gli indirizzi vecchi.
  if (visti.size > 5000) {
    for (const [k, v] of visti) if (!v.some(t => ora - t < FINESTRA)) visti.delete(k)
  }
  return precedenti.length > MAX
}

const intestazioni = (origine: string | null) => ({
  'Access-Control-Allow-Origin': ORIGINI.includes(origine || '') ? origine! : ORIGINI[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
})

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: intestazioni(req.headers.get('origin')) })
}

const pulisci = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function POST(req: NextRequest) {
  const origine = req.headers.get('origin')
  const H = intestazioni(origine)
  const no = (errore: string, stato: number) => NextResponse.json({ errore }, { status: stato, headers: H })

  if (origine && !ORIGINI.includes(origine)) return no('Richiesta non consentita.', 403)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ignoto'
  if (troppeRichieste(ip)) return no('Troppe richieste. Riprova fra qualche minuto.', 429)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return no('Richiesta non valida.', 400) }

  // Trappola: chi compila un campo che non si vede non e' una persona. Rispondiamo ok
  // e non mandiamo niente: se dicessimo "scartato" imparerebbero a non compilarlo.
  if (pulisci(corpo.sito)) return NextResponse.json({ ok: true }, { headers: H })

  const nome = pulisci(corpo.nome, 120)
  const email = pulisci(corpo.email, 160)
  const azienda = pulisci(corpo.azienda, 160)
  const telefono = pulisci(corpo.telefono, 40)
  const volume = pulisci(corpo.volume, 40)
  const messaggio = pulisci(corpo.messaggio, 4000)
  const tipo = pulisci(corpo.tipo, 40)

  if (!nome || !email) return no("Servono almeno il nome e l'email.", 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return no("L'indirizzo email non sembra valido.", 400)

  const chiave = process.env.RESEND_API_KEY
  if (!chiave) {
    console.error('[pubblico/contatti] RESEND_API_KEY assente: messaggio NON inviato', { email })
    return no('Il modulo non è al momento disponibile.', 503)
  }

  const righe: [string, string][] = [
    ['Cosa serve', ETICHETTE[tipo] || tipo || '—'],
    ['Nome', nome],
    ['Azienda', azienda || '—'],
    ['Email', email],
    ['Telefono', telefono || '—'],
    ['Spedizioni al mese', volume || 'non dichiarato'],
  ]

  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:15px;color:#111;line-height:1.6">
      <h2 style="margin:0 0 16px;font-size:18px">Nuova richiesta dal sito</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${righe.map(([k, v]) =>
          `<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${escape(v)}</strong></td></tr>`
        ).join('')}
      </table>
      ${messaggio ? `<p style="margin:18px 0 0;white-space:pre-wrap">${escape(messaggio)}</p>` : ''}
    </div>`

  try {
    const resend = new Resend(chiave)
    const daRaw = process.env.EMAIL_FROM || 'MoovExpress <noreply@moovexpress.com>'
    const r: any = await resend.emails.send({
      from: daRaw.includes('<') ? daRaw : `MoovExpress <${daRaw}>`,
      to: A,
      // Si risponde direttamente a chi ha scritto, senza ricopiare l'indirizzo a mano.
      replyTo: email,
      subject: `Sito — ${ETICHETTE[tipo] || 'richiesta'}: ${nome}${azienda ? ` (${azienda})` : ''}`,
      html,
    })
    if (r?.error) {
      console.error('[pubblico/contatti] invio rifiutato', r.error)
      return no('Non siamo riusciti a inviare il messaggio.', 502)
    }
  } catch (e) {
    console.error('[pubblico/contatti] invio fallito', e)
    return no('Non siamo riusciti a inviare il messaggio.', 502)
  }

  return NextResponse.json({ ok: true }, { headers: H })
}
