import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { stripeConfigurato, stripeClient } from '@/lib/stripe'

/* ADDEBITO SU CARTA SALVATA, senza uscire dal portale.
 *
 * Serve al momento della spedizione: se il credito non basta, il cliente preme "Paga con la carta"
 * e questa rotta addebita la carta che ha gia' salvato (ricaricando la prima volta) per l'importo
 * mancante. Nessun redirect, nessuna cassa: l'addebito parte "off_session" e, appena il circuito
 * conferma, il credito sale — subito, cosi' la spedizione puo' partire.
 *
 * Il credito si muove SOLO via la RPC atomica registra_movimento_cliente, e con la STESSA chiave
 * d'idempotenza della ricarica ('ricarica:'+id del pagamento): se il webhook arriva a bordo dopo,
 * trova gia' fatto e non raddoppia.
 *
 * Se la carta chiede l'autenticazione della banca (3DS) non si puo' fare in silenzio: si torna un
 * segnale e il portale manda il cliente sulla Ricarica normale (cassa Stripe), che il 3DS lo sa
 * gestire. Se non c'e' nessuna carta salvata, stessa cosa: prima si ricarica una volta. */

const MIN = 1        // qui non c'e' minimo di ricarica: si copre l'esatto mancante di UNA spedizione
const MAX = 5000

// SOSPESE su decisione del super master: niente addebito carta self-service (né ricarica né
// pagamento della singola spedizione con carta). Per riattivare: rimettere a false.
const RICARICHE_SOSPESE = true

export async function POST(req: NextRequest) {
  if (RICARICHE_SOSPESE) {
    return NextResponse.json({ error: 'Il pagamento con carta è temporaneamente sospeso.' }, { status: 503 })
  }
  if (!stripeConfigurato()) {
    return NextResponse.json({ error: 'Il pagamento con carta non è ancora attivo.' }, { status: 400 })
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).maybeSingle()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const corpo = await req.json().catch(() => ({} as any))
  // Arrotondo per ECCESSO al centesimo: l'addebito deve coprire il mancante, mai lasciarlo scoperto
  // di un centesimo per un arrotondamento. In euro, due decimali.
  const importo = Math.ceil((Number(corpo?.importo) || 0) * 100) / 100
  if (!(importo >= MIN)) return NextResponse.json({ error: 'Importo non valido.' }, { status: 400 })
  if (importo > MAX) return NextResponse.json({ error: `Per importi oltre ${MAX} € usa la ricarica o scrivici.` }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti')
    .select('id, master_id, stripe_customer_id')
    .eq('id', u.cliente_id).maybeSingle()
  if (!cli) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  // Senza customer non c'e' nessuna carta salvata: si passa dalla ricarica (che la salva).
  if (!cli.stripe_customer_id) {
    return NextResponse.json({ serve_ricarica: true, error: 'Nessuna carta salvata. Ricarica una volta per salvarla.' }, { status: 409 })
  }

  const s = stripeClient()

  // La carta salvata: la prima carta del customer. (Salvata al primo pagamento con
  // setup_future_usage='off_session'.)
  const carte = await s.paymentMethods.list({ customer: cli.stripe_customer_id, type: 'card', limit: 1 })
  const carta = carte.data[0]
  if (!carta) {
    return NextResponse.json({ serve_ricarica: true, error: 'Nessuna carta salvata. Ricarica una volta per salvarla.' }, { status: 409 })
  }

  const rif = 'ricarica:'   // completato sotto con l'id del PaymentIntent (chiave d'idempotenza comune alla ricarica)

  try {
    const pi = await s.paymentIntents.create({
      amount: Math.round(importo * 100),
      currency: 'eur',
      customer: cli.stripe_customer_id,
      payment_method: carta.id,
      off_session: true,   // il cliente non e' alla cassa: addebito iniziato da noi
      confirm: true,       // parte subito
      metadata: { scopo: 'ricarica', cliente_id: cli.id, master_id: cli.master_id },
    })

    if (pi.status !== 'succeeded') {
      // requires_action/requires_payment_method fuori sessione = serve il cliente presente (3DS).
      return NextResponse.json({ serve_autenticazione: true, error: 'La carta richiede la conferma della banca: completa dalla Ricarica.' }, { status: 409 })
    }

    // Pagato davvero: accredito ORA, atomico e idempotente (stessa chiave del webhook: chi arriva
    // secondo trova gia' fatto e non raddoppia).
    const chiave = rif + pi.id
    const { data: gia } = await admin.from('movimenti').select('id').eq('tipo', 'ricarica').eq('riferimento', chiave).maybeSingle()
    if (!gia) {
      const { error: eRic } = await admin.rpc('registra_movimento_cliente', {
        p_master_id: cli.master_id, p_cliente_id: cli.id, p_tipo: 'ricarica',
        p_descrizione: 'Addebito su carta salvata', p_importo: importo,
        p_riferimento: chiave, p_spedizione_id: null, p_created_by: null, p_richiedi_capienza: false,
      })
      if (eRic) {
        // Il denaro e' stato preso ma l'accredito e' fallito: NON perdere il pagamento — il webhook
        // (payment_intent.succeeded, stessa chiave) lo recupera. Segnalo al cliente di riprovare fra poco.
        console.error('[PAGA-CARTA] addebitato ma accredito fallito', cli.id, pi.id, eRic.message)
        return NextResponse.json({ error: 'Pagamento ricevuto, credito in aggiornamento: riprova tra pochi secondi.' }, { status: 202 })
      }
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    // Carta rifiutata / serve autenticazione: si dirotta sulla Ricarica (cassa Stripe con 3DS).
    const code = e?.code || e?.raw?.code
    if (code === 'authentication_required') {
      return NextResponse.json({ serve_autenticazione: true, error: 'La carta richiede la conferma della banca: completa dalla Ricarica.' }, { status: 409 })
    }
    console.error('[PAGA-CARTA] addebito fallito', cli.id, code, e?.message)
    return NextResponse.json({ error: 'La carta è stata rifiutata. Prova con la Ricarica o un’altra carta.' }, { status: 402 })
  }
}
