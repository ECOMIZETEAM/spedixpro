import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'
import { pianoById, meseCorrente } from '@/lib/piani'
import { giorniNelMese } from '@/lib/abbonamento-cambi'
import { stripeConfigurato, stripeClient, prezzoStripe, aliquotaIva, clienteStripe, primoDelProssimoMese, idPrezzo } from '@/lib/stripe'

// Attivazione o cambio piano PAGANDO CON CARTA.
//
// Chi ha gia' l'abbonamento non ripassa dalla cassa: si cambia il piano sull'abbonamento che ha
// gia', e il circuito calcola da solo il conguaglio dei giorni rimanenti del mese. Chi non ce l'ha
// viene mandato alla pagina di pagamento.
//
// Il piano NON si attiva qui: si attiva quando il pagamento e' andato a buon fine, e a dirlo e' il
// circuito con una notifica firmata (/api/stripe/webhook). Attivarlo qui vorrebbe dire regalare il
// piano a chi apre la pagina di pagamento e poi chiude la finestra.
export async function POST(req: NextRequest) {
  if (!stripeConfigurato()) return NextResponse.json({ error: 'Pagamento con carta non ancora attivo.' }, { status: 400 })

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const corpo = await req.json().catch(() => ({} as any))
  const pianoId = corpo?.pianoId
  // Una tantum invece dell'abbonamento. Non e' un'alternativa che si offre: e' il ripiego per chi
  // la banca ha gia' rifiutato, perche' molte carte aziendali e prepagate non accettano il mandato
  // ricorrente pur avendo i soldi sopra.
  const singolo = corpo?.modo === 'singolo'
  const piano = pianoById(String(pianoId || ''))
  if (!piano || !String(pianoId).startsWith('enterprise_')) return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('id,nome,email,parent_master_id,abbonamento_esente,abbonamento_piano,abbonamento_mese,stripe_customer_id,stripe_subscription_id,stripe_stato')
    .eq('id', utente.master_id).single()
  if (!m) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  if (!m.parent_master_id) return NextResponse.json({ error: 'Il master principale non ha canone.' }, { status: 400 })
  if (m.abbonamento_esente) return NextResponse.json({ error: 'Il tuo abbonamento è gratuito: nessun pagamento da fare.' }, { status: 400 })
  if (m.abbonamento_piano === pianoId && m.stripe_subscription_id) {
    // "Hai già questo piano" NON deve bloccare chi ha il canone NON pagato (addebito fallito, es. fondi
    // insufficienti): se c'è una fattura Stripe APERTA, mando a saldarla (anche con un'altra carta). La UI
    // redirige su `url`. Così chi ha un addebito fallito può ri-pagare invece di restare bloccato.
    try {
      const sTmp = stripeClient()
      const aperte = await sTmp.invoices.list({ customer: m.stripe_customer_id!, status: 'open', limit: 1 })
      const inv = aperte.data[0] as any
      if (inv?.hosted_invoice_url) return NextResponse.json({ url: inv.hosted_invoice_url })
    } catch (e: any) { console.error('[CHECKOUT][sospeso]', e?.message) }
    return NextResponse.json({ error: 'Hai già questo piano' }, { status: 400 })
  }

  // IL MESE IN CORSO E' GIA' SALDATO: l'abbonamento parte dal mese prossimo.
  //
  // Succede a chi paga per altra via — un bonifico segnato a mano dagli incassi — e poi va a
  // mettere la carta nello stesso mese. Senza questo pagherebbe DUE VOLTE lo stesso canone: la
  // cassa addebita il mese pieno il giorno stesso dell'attivazione. E' successo davvero con
  // Central Poste, agosto saldato fuori dal circuito.
  // Questa variabile esisteva gia' qui, calcolata e mai usata: l'intenzione c'era, il collegamento no.
  //
  // Il circuito vuole l'inizio addebiti ad almeno 48 ore di distanza: se si attiva a fine mese il
  // primo del mese prossimo e' troppo vicino, e si prende la scadenza piu' lontana fra le due —
  // che cade comunque nel mese nuovo, quindi il mese gia' pagato non viene mai riaddebitato.
  const meseGiaPagato = !!m.abbonamento_piano && m.abbonamento_mese === meseCorrente()
  const inizioAddebiti = Math.max(primoDelProssimoMese(), Math.floor(Date.now() / 1000) + 49 * 3600)

  const s = stripeClient()
  const { price } = await prezzoStripe(pianoId)
  const iva = await aliquotaIva()
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')

  // ── Ha gia' un abbonamento attivo: si cambia il piano su quello ──
  //
  // UPGRADE e DOWNGRADE non sono simmetrici, e non e' un dettaglio:
  //
  //  · l'UPGRADE deve valere SUBITO — di norma lo si fa perche' si sta per sfondare il limite e le
  //    spedizioni stanno per fermarsi. Aspettare il mese prossimo lo renderebbe inutile. Si paga
  //    subito la differenza per i giorni che restano, non un mese intero.
  //
  //  · il DOWNGRADE parte dal PRIMO DEL MESE DOPO. Il mese in corso e' gia' stato pagato al prezzo
  //    alto: abbassare il limite adesso vorrebbe dire togliere qualcosa di gia' pagato, e per di
  //    piu' rischiare di bloccare una rete che aveva gia' spedito oltre il nuovo limite.
  if (m.stripe_subscription_id) {
    try {
      const sub = await s.subscriptions.retrieve(m.stripe_subscription_id, { expand: ['items.data.price'] })
      if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
        const voce = sub.items.data[0]
        const prezzoOra = Number((voce.price as any)?.unit_amount || 0)
        const inSalita = (price.unit_amount || 0) > prezzoOra

        if (inSalita) {
          // Un eventuale downgrade programmato va tolto di mezzo, altrimenti resterebbe li' ad
          // aspettare e il mese prossimo riporterebbe giu' un piano appena alzato.
          if (sub.schedule) {
            try { await s.subscriptionSchedules.release(String(sub.schedule)) } catch { }
          }
          // Il piano cambia SUBITO — il limite si alza adesso, ed e' il senso dell'upgrade — ma
          // senza il conteggio dei giorni del circuito: il conguaglio lo calcoliamo noi.
          await s.subscriptions.update(sub.id, {
            items: [{ id: voce.id, price: price.id }],
            proration_behavior: 'none',
            metadata: { master_id: m.id, piano: pianoId },
          })
          // NON si addebita adesso. Si accumula il CONGUAGLIO — la differenza di piano proporzionata
          // ai giorni che restano nel mese — come voce IN SOSPESO sul circuito (un invoiceItem SENZA
          // fattura): si aggancia da sola alla prossima fattura di rinnovo, cosi' il master paga
          // rinnovo + conguaglio in un colpo, il primo del mese. Regola decisa da chi vende: chi fa
          // upgrade il 28 non paga la differenza piena per tre giorni di utilizzo, ma la sua quota.
          // Prima qui si addebitava la differenza PIENA subito, con una fattura a parte: quella strada
          // in produzione non incassava (restavano righe a 0) e comunque non era la regola voluta.
          const mese = meseCorrente()
          const gg = giorniNelMese(mese)
          const restanti = Math.max(0, gg - new Date().getUTCDate() + 1)
          const conguaglio = Math.round(((price.unit_amount || 0) - prezzoOra) / gg * restanti)   // centesimi
          if (conguaglio > 0) {
            await s.invoiceItems.create({
              customer: String(sub.customer), amount: conguaglio, currency: 'eur',
              description: `Conguaglio ${piano.nome} — ${restanti} giorni di utilizzo`,
              metadata: { master_id: m.id, tipo: 'conguaglio', mese, piano: pianoId },
            })
            // Nessuna invoices.create: la voce resta in sospeso e la incassa il rinnovo.
          }
          await admin.from('masters').update({
            abbonamento_piano_programmato: null, abbonamento_programmato_dal: null,
          }).eq('id', m.id)
          return NextResponse.json({ aggiornato: true, immediato: true, conguaglio: conguaglio / 100 })
        }

        // Downgrade: si programma per la fine del periodo pagato.
        const sched = sub.schedule
          ? await s.subscriptionSchedules.retrieve(String(sub.schedule))
          : await s.subscriptionSchedules.create({ from_subscription: sub.id })
        // La fase da tenere e' quella IN CORSO, non l'ultima: con il rinnovo agganciato al primo del
        // mese le fasi sono due (il pezzo di mese iniziale e poi il primo mese pieno), e prendere
        // l'ultima faceva rifiutare l'operazione — si stava spostando l'inizio di una fase gia'
        // cominciata. Il piano nuovo deve partire dalla fine di QUELLA in corso.
        const corrente = sched.phases.find(f => f.start_date === sched.current_phase?.start_date) || sched.phases[0]
        await s.subscriptionSchedules.update(sched.id, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price: idPrezzo((corrente.items[0] as any).price), quantity: 1 }],
              start_date: corrente.start_date, end_date: corrente.end_date,
            },
            { items: [{ price: price.id, quantity: 1 }] },
          ],
          metadata: { master_id: m.id, piano: pianoId },
        })
        const dal = new Date(Number(corrente.end_date) * 1000).toISOString()
        await admin.from('masters').update({
          abbonamento_piano_programmato: pianoId, abbonamento_programmato_dal: dal,
        }).eq('id', m.id)
        return NextResponse.json({ aggiornato: true, immediato: false, dal })
      }
    } catch (e: any) {
      console.error('[STRIPE] cambio piano fallito', m.id, e?.message)
      return NextResponse.json({ error: 'Cambio piano non riuscito: riprova o contatta l\'assistenza.' }, { status: 400 })
    }
  }

  // ── Prima attivazione: pagina di pagamento ──
  const customer = await clienteStripe(admin, m as any)
  let sessione
  try {
    sessione = singolo ? await s.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(Number(piano.prezzo) * 100),
          tax_behavior: 'inclusive',
          product_data: { name: `MoovExpress ${piano.nome} — canone ${meseCorrente()}` },
        },
      }],
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      metadata: { master_id: m.id, piano: pianoId, modo: 'singolo', mese: meseCorrente() },
      success_url: `${base}/dashboard/abbonamento?pagamento=ok`,
      cancel_url: `${base}/dashboard/abbonamento`,
    }) : await s.checkout.sessions.create({
      mode: 'subscription',
      customer,
      // L'ABBONAMENTO PARTE OGGI: canone pieno subito, e poi pieno ogni mese.
      //
      // Prima lo agganciavo al primo del mese: il circuito allora mostrava "0,00 € dovuti oggi" e
      // il mese in corso finiva addebitato a parte, dopo. Tecnicamente tornava, ma alla cassa
      // sembrava che il mese fosse gratis — e un cliente che legge zero pensa zero.
      // Cosi' invece l'importo e' quello vero, scritto dove lo si guarda.
      // Il rinnovo cade nel giorno dell'attivazione anziche' il primo del mese: si perde
      // l'allineamento col contatore spedizioni, che resta per mese di calendario.
      line_items: [{ price: price.id, quantity: 1, tax_rates: iva.length ? iva : undefined }],
      subscription_data: {
        metadata: { master_id: m.id, piano: pianoId },
        // Solo per chi il mese in corso l'ha gia' pagato (vedi sopra). Per tutti gli altri non
        // cambia niente: canone pieno subito, come prima.
        //
        // IL CONGELAMENTO CONTINUA A FUNZIONARE. L'abbonamento nasce 'trialing', che il webhook
        // conta gia' fra gli stati attivi, e il controllo giornaliero lo lascia stare perche' ha
        // una carta agganciata — giustamente, se ne occupa il circuito. Al primo addebito, il mese
        // prossimo: se va a buon fine arriva `invoice.paid` e il mese si segna pagato; se va a
        // vuoto arriva `invoice.payment_failed`, parte il conto alla rovescia e tre giorni dopo si
        // congela, esattamente come per chiunque altro.
        ...(meseGiaPagato ? { trial_end: inizioAddebiti } : {}),
      },
      // LA CARTA SI PRENDE COMUNQUE, anche quando oggi non c'e' niente da pagare. E' il default
      // del circuito, ma qui e' il punto di tutta l'operazione e non deve dipendere da un default:
      // senza carta agganciata, il mese prossimo non ci sarebbe niente da addebitare e il canone
      // resterebbe scoperto in silenzio.
      payment_method_collection: 'always',
      metadata: { master_id: m.id, piano: pianoId },
      success_url: `${base}/dashboard/abbonamento?pagamento=ok`,
      cancel_url: `${base}/dashboard/abbonamento?pagamento=annullato`,
      locale: 'it',
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },   // partita IVA in fattura
      // Senza questo la cassa non si apre proprio: chiedendo la partita IVA e l'indirizzo a un
      // cliente che esiste gia', il circuito vuole il permesso esplicito di aggiornarne
      // l'anagrafica con quello che l'utente digita. Mancava, e il tasto non faceva nulla.
      customer_update: { name: 'auto', address: 'auto' },
    })
  } catch (e: any) {
    // Un errore qui lasciava la pagina muta: la risposta non era JSON e la schermata non aveva
    // niente da mostrare. Meglio un messaggio, e il motivo vero nei log.
    console.error('[STRIPE][CASSA]', m.id, e?.message)
    return NextResponse.json({ error: 'Non riesco ad aprire il pagamento in questo momento. Riprova, o scrivici se continua.' }, { status: 400 })
  }
  return NextResponse.json({ url: sessione.url })
}
