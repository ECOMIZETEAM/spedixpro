import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { registraAudit } from '@/lib/audit'
import { leggiEtichettaCompleta } from '@/lib/etichette'
import { attendiTmp } from '@/lib/tmp-completa'

// Su una spedizione provvisoria la rotta aspetta la LDV fino a ~20 s (vedi sotto): il tetto deve
// lasciare spazio anche a un tentativo lento del fornitore.
export const maxDuration = 60

const CAMPI = 'id,numero,stato,etichetta_url,etichetta_path,colli_dettaglio,raw_response,cliente_id,corriere_id,rif_ordine,contenuto'

// Scarica l'etichetta (LDV) PDF della spedizione creata via API
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b
  const { id } = await params
  const admin = createAdminSupabase()
  let { data: s } = await admin.from('spedizioni').select(CAMPI).eq('id', id).maybeSingle()
  if (!s || s.cliente_id !== ctx.clienteId) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // Registro degli accessi ai dati personali anche per l'API (l'etichetta porta il destinatario).
  const numeroSped = (s as any).numero
  after(() => registraAudit({ ruolo: 'api', azione: 'api_etichetta', risorsa: numeroSped, dettaglio: `cliente ${ctx.clienteId}` }))
  // leggiEtichettaCompleta sa dove vive il PDF (Storage o base64) ED è MULTICOLLO: su una spedizione
  // a più colli unisce tutte le etichette in un unico PDF, così chi si integra via API non riceve il
  // solo primo collo. Prima usava leggiEtichetta (singola) e non leggeva nemmeno colli_dettaglio.
  // SDA EXPRESS L esce com'e' arrivata da Poste (resaSda:false): da qui la catena della condivisione
  // scarica l'etichetta e la SALVA sulla riga del compratore (lib/moovexpress). Servita gia' riscritta,
  // il cliente finale avrebbe avuto la resa coi dati della gamba a monte invece che della sua riga, e
  // rileggerla per riscriverla cancellava i codici (provato il 13/10). La resa pulita la fa il portale
  // di chi stampa, sulla sua riga; chi si integra via API riceve la stessa 1011 di sempre.
  let et = await leggiEtichettaCompleta(admin, s as any, { resaSda: false })

  // SPEDIZIONE NATA PROVVISORIA (DVA, "TMP-<ordine>"): invece di rispondere subito che l'etichetta non
  // c'e', la si va a chiedere al fornitore e si aspetta qualche secondo (lib/tmp-completa, attendiTmp).
  // Solo appena creata (in_lavorazione): su una spedizione annullata o in annullo non c'e' niente da
  // aspettare. La catena della condivisione non passa mai di qui: nessun contratto-ponte ha DVA come
  // fornitore, e solo DVA produce numeri provvisori.
  const provvisoria = () => String(s?.numero || '').startsWith('TMP-')
  if (!et && provvisoria() && s.stato === 'in_lavorazione') {
    await attendiTmp(admin, s.id)
    const { data: riletta } = await admin.from('spedizioni').select(CAMPI).eq('id', id).maybeSingle()
    if (riletta) s = riletta
    et = await leggiEtichettaCompleta(admin, s as any, { resaSda: false })
  }
  if (!et) {
    // ANCORA NON PRONTA: 503 con Retry-After, non 404. Il 404 diceva "non esiste", e chi lo riceveva
    // non riprovava: lo salvava come se fosse l'etichetta. Il corpo resta JSON, come ogni errore.
    if (provvisoria() && s.stato === 'in_lavorazione') {
      return NextResponse.json(
        { error: 'Etichetta non ancora pronta: il corriere non ha ancora assegnato la lettera di vettura. Riprova tra 30 secondi.', retry_after: 30 },
        { status: 503, headers: { 'Retry-After': '30' } },
      )
    }
    return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })
  }
  const nomeFile = `ldv_${s.numero || s.id}.${et.ext}`

  // L'ETICHETTA ANCHE COME TESTO (base64 dentro un JSON), SOLO SE CHIESTA ESPLICITAMENTE: ?format=base64.
  // Il portale di CONTORNO SRL rovina ogni PDF che riceve da noi, Poste e SDA: il 22/10/2026 3UW1WLJ085420
  // e' uscita di qui intera (130.313 byte, verificata) ed e' arrivata al loro utente come file che Acrobat
  // non apre. Il resto della nostra API (JSON) lo leggono bene: e' il file binario che il loro programma
  // tratta come testo. Il base64 e' testo puro, quindi passa intatto.
  // Solo col parametro e non con "Accept: application/json": molti programmi mandano quell'intestazione
  // di default, e chi oggi riceve il PDF si ritroverebbe un JSON senza averlo chiesto. Senza parametro la
  // risposta resta il PDF byte per byte: la catena della condivisione lo SALVA cosi' com'e'.
  if ((req.nextUrl.searchParams.get('format') || '').toLowerCase() === 'base64') {
    return NextResponse.json({
      id: s.id,
      tracking: s.numero,
      filename: nomeFile,
      content_type: et.mime,
      label_base64: et.buffer.toString('base64'),
    })
  }
  return new NextResponse(et.buffer as any, {
    headers: {
      'Content-Type': et.mime,
      'Content-Disposition': `attachment; filename="${nomeFile}"`,
    },
  })
}

// ANCHE IN POST, identica: stessa chiave, stessi controlli, stesso PDF. La strada documentata resta GET.
// Il portale di CONTORNO SRL chiede l'etichetta in POST sulle spedizioni Poste (in GET sulle SDA):
// Next rispondeva 405 senza corpo, e il loro portale salvava quel vuoto come .pdf, che Acrobat non
// apre. 55 spedizioni su 55 dal 24/09/2026, mai un'etichetta arrivata. POST fa esattamente quello che
// fa GET, quindi accettarla non apre nulla di nuovo.
export const POST = GET
