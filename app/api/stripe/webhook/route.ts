import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { stripeConfigurato, stripeClient, pianoDaPrezzo, pianoApiDaPrezzo } from '@/lib/stripe'
import { pianoById, meseCorrente } from '@/lib/piani'

export const dynamic = 'force-dynamic'

// NOTIFICHE DEL CIRCUITO DI PAGAMENTO.
//
// E' l'unico posto in cui un abbonamento pagato con carta si attiva, si rinnova o si spegne: qui
// arriva la conferma che il denaro si e' mosso davvero. Nessun'altra rotta deve attivare un piano
// a pagamento, altrimenti basterebbe aprire la pagina di pagamento e chiuderla per averlo gratis.
//
// La chiamata arriva da fuori, senza sessione: l'unica cosa che la autentica e' la FIRMA sul corpo
// del messaggio. Senza la verifica della firma chiunque conoscesse l'indirizzo potrebbe regalarsi
// un piano da 150.000 spedizioni con una richiesta HTTP.
export async function POST(req: NextRequest) {
  if (!stripeConfigurato() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'non configurato' }, { status: 400 })
  }
  const firma = req.headers.get('stripe-signature') || ''
  const corpo = await req.text()          // il corpo GREZZO: la firma si verifica sui byte esatti

  const s = stripeClient()
  let evento: any
  try {
    evento = s.webhooks.constructEvent(corpo, firma, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e: any) {
    console.error('[STRIPE][WEBHOOK] firma non valida:', e?.message)
    return NextResponse.json({ error: 'firma non valida' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // Il master a cui appartiene l'evento: prima dai dati che ci siamo scritti noi, poi — se
  // mancassero — dal cliente sul circuito.
  async function masterDi(oggetto: any): Promise<any | null> {
    const id = oggetto?.metadata?.master_id
      || oggetto?.subscription_details?.metadata?.master_id
      || oggetto?.lines?.data?.[0]?.metadata?.master_id
    if (id) {
      const { data } = await admin.from('masters').select('id,nome,parent_master_id,abbonamento_piano,abbonamento_prezzo,abbonamento_piano_programmato').eq('id', id).maybeSingle()
      if (data) return data
    }
    const cust = typeof oggetto?.customer === 'string' ? oggetto.customer : oggetto?.customer?.id
    if (!cust) return null
    const { data } = await admin.from('masters').select('id,nome,parent_master_id,abbonamento_piano,abbonamento_prezzo,abbonamento_piano_programmato').eq('stripe_customer_id', cust).maybeSingle()
    return data || null
  }

  // Il master principale della rete: e' lui che incassa i canoni di tutti.
  async function rootId(): Promise<string | null> {
    const { data } = await admin.from('masters').select('id').is('parent_master_id', null).limit(1)
    return data?.[0]?.id || null
  }

  // ── I PACCHETTI API DEI CLIENTI ───────────────────────────────────────────
  // Passano dallo stesso circuito e quindi dalla stessa porta, ma sono un'altra cosa dai canoni
  // dei master: si riconoscono dal metadato `cliente_id`, che ci mettiamo noi quando apriamo la
  // cassa. Vengono trattati qui e la funzione esce: senza questo, un pagamento di un cliente
  // finirebbe nel ramo dei master, che cerca un master_id e non lo trova.
  const clienteDaEvento = (o: any): string | null =>
    o?.metadata?.cliente_id || o?.subscription_details?.metadata?.cliente_id || null

  try {
    const oggetto: any = evento.data.object

    // ── RICARICA CREDITO DEL CLIENTE ──────────────────────────────────────────
    // Riconosciuta dal metadato scopo='ricarica'. Va PRIMA di tutto: ha anche cliente_id e
    // finirebbe nel ramo dei pacchetti API. Il credito si muove QUI, a pagamento confermato —
    // mai aprendo la cassa — e SOLO via la RPC atomica (mai UPDATE diretto su `credito`).
    if (evento.type === 'checkout.session.completed' && oggetto?.metadata?.scopo === 'ricarica') {
      const clid = String(oggetto?.metadata?.cliente_id || '')
      const importoPagato = Number(oggetto?.amount_total || 0) / 100   // quello che ha pagato davvero
      const rif = 'ricarica:' + String(oggetto?.payment_intent || oggetto?.id)   // chiave d'idempotenza
      if (!clid || !(importoPagato > 0)) {
        console.error('[STRIPE][RICARICA] dati mancanti', oggetto?.id)
        return NextResponse.json({ ricevuto: true })
      }
      // Se questa ricarica è già stata accreditata (ri-consegna del webhook), non ripeterla.
      const { data: gia } = await admin.from('movimenti').select('id').eq('tipo', 'ricarica').eq('riferimento', rif).maybeSingle()
      if (gia) return NextResponse.json({ ricevuto: true })
      // Master del cliente AUTOREVOLE dal database (non dal metadato) + salva il customer per gli
      // addebiti futuri fuori sessione.
      const { data: cliRic } = await admin.from('clienti').select('master_id, stripe_customer_id').eq('id', clid).maybeSingle()
      if (!cliRic) { console.error('[STRIPE][RICARICA] cliente non trovato', clid); return NextResponse.json({ ricevuto: true }) }
      const cust = typeof oggetto?.customer === 'string' ? oggetto.customer : oggetto?.customer?.id
      if (cust && !cliRic.stripe_customer_id) await admin.from('clienti').update({ stripe_customer_id: cust }).eq('id', clid)
      const { error: eRic } = await admin.rpc('registra_movimento_cliente', {
        p_master_id: cliRic.master_id, p_cliente_id: clid, p_tipo: 'ricarica',
        p_descrizione: 'Ricarica credito con carta', p_importo: importoPagato,
        p_riferimento: rif, p_spedizione_id: null, p_created_by: null, p_richiedi_capienza: false,
      })
      if (eRic) { console.error('[STRIPE][RICARICA] accredito fallito', clid, eRic.message); return NextResponse.json({ error: 'errore' }, { status: 500 }) }
      console.log('[STRIPE][RICARICA] accreditati', importoPagato, '€ a', clid)
      return NextResponse.json({ ricevuto: true })
    }

    let clienteId = clienteDaEvento(oggetto)
    if (!clienteId && oggetto?.customer) {
      const { data: c } = await admin.from('clienti').select('id').eq('api_stripe_customer_id', String(oggetto.customer)).maybeSingle()
      clienteId = c?.id || null
    }
    if (clienteId) {
      switch (evento.type) {
        case 'checkout.session.completed':
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          // PAGAMENTO SINGOLO: nessun abbonamento da leggere, il pacchetto si attiva e basta.
          // Non si salva l'id di un abbonamento che non esiste, altrimenti il portale mostrerebbe
          // un rinnovo automatico che nessuno ha attivato.
          if (evento.type === 'checkout.session.completed' && oggetto?.mode === 'payment') {
            const cod = String(oggetto?.metadata?.piano_api || '')
            if (oggetto?.payment_status === 'paid' && cod) {
              await admin.from('clienti').update({
                api_piano: cod, api_scaduto_dal: null, api_limite_sforato_dal: null,
              }).eq('id', clienteId)
              console.log('[STRIPE][API] pacchetto attivato con pagamento singolo', clienteId, cod)
            }
            break
          }
          const subId = evento.type === 'checkout.session.completed'
            ? (typeof oggetto.subscription === 'string' ? oggetto.subscription : oggetto.subscription?.id)
            : oggetto.id
          if (!subId) break
          const sub = await s.subscriptions.retrieve(subId, { expand: ['items.data.price'] })
          const codice = pianoApiDaPrezzo(sub.items.data[0]?.price as any) || String(oggetto?.metadata?.piano_api || '')
          const attivo = ['active', 'trialing', 'past_due'].includes(sub.status)
          if (!attivo || !codice) break
          await admin.from('clienti').update({
            api_piano: codice,
            api_stripe_subscription_id: sub.id,
            api_stripe_customer_id: String(sub.customer),
            api_scaduto_dal: null,          // ha pagato: il conto alla rovescia si azzera
          }).eq('id', clienteId)
          console.log('[STRIPE][API] pacchetto attivato', clienteId, codice)
          break
        }
        case 'invoice.paid': {
          await admin.from('clienti').update({ api_scaduto_dal: null }).eq('id', clienteId)
          break
        }
        case 'invoice.payment_failed':
        case 'invoice.payment_action_required': {
          // Il conto alla rovescia parte UNA volta sola: se ripartisse a ogni tentativo del
          // circuito, i tre giorni non scadrebbero mai.
          const { data: c } = await admin.from('clienti').select('api_scaduto_dal').eq('id', clienteId).maybeSingle()
          if (!c?.api_scaduto_dal) {
            await admin.from('clienti').update({ api_scaduto_dal: new Date().toISOString() }).eq('id', clienteId)
          }
          break
        }
        case 'customer.subscription.deleted': {
          // Disdetta: torna al pacchetto gratuito, non resta senza niente.
          await admin.from('clienti').update({
            api_piano: 'free', api_stripe_subscription_id: null, api_scaduto_dal: null,
          }).eq('id', clienteId)
          break
        }
      }
      return NextResponse.json({ received: true })
    }
  } catch (e: any) {
    console.error('[STRIPE][API] evento non elaborato:', e?.message)
    return NextResponse.json({ received: true })
  }

  try {
    switch (evento.type) {
      // ── Piano attivato o cambiato ─────────────────────────────────────────
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const o = evento.data.object
        const m = await masterDi(o)
        if (!m) break
        // CANONE PAGATO UNA TANTUM. Nessun abbonamento da leggere: si attiva il piano, si sblocca
        // il congelamento e si registra l'incasso. NON si salva stripe_subscription_id, altrimenti
        // il portale mostrerebbe un rinnovo automatico che non esiste e il mese dopo nessuno lo
        // solleciterebbe.
        if (evento.type === 'checkout.session.completed' && o?.mode === 'payment') {
          const pUna = pianoById(String(o?.metadata?.piano || ''))
          if (o?.payment_status === 'paid' && pUna) {
            const mese = String(o?.metadata?.mese || meseCorrente())
            await admin.from('masters').update({
              abbonamento_piano: pUna.id, abbonamento_limite: pUna.limite, abbonamento_prezzo: pUna.prezzo,
              abbonamento_mese: mese, pagamento_scaduto_dal: null,
            }).eq('id', m.id)
            try {
              await admin.from('abbonamenti_pagamenti').upsert({
                master_id: m.id, root_id: await rootId(), piano: pUna.id, mese,
                importo: pUna.prezzo, pagato: true, pagato_il: new Date().toISOString(),
                metodo: 'carta', stripe_invoice_id: String(o?.payment_intent || o?.id),
              }, { onConflict: 'stripe_invoice_id' })
            } catch (e: any) { console.error('[STRIPE] incasso una tantum non registrato:', e?.message) }
            console.log('[STRIPE] canone pagato una tantum', m.nome, pUna.id, mese)
          }
          break
        }
        const subId = evento.type === 'checkout.session.completed'
          ? (typeof o.subscription === 'string' ? o.subscription : o.subscription?.id)
          : o.id
        if (!subId) break
        const sub = await s.subscriptions.retrieve(subId, { expand: ['items.data.price'] })
        const piano = pianoDaPrezzo(sub.items.data[0]?.price as any) || pianoById(String(o?.metadata?.piano || ''))
        const attivo = ['active', 'trialing', 'past_due'].includes(sub.status)
        await admin.from('masters').update({
          stripe_subscription_id: sub.id,
          stripe_stato: sub.status,
          // Il piano si toglie solo quando l'abbonamento e' davvero chiuso (evento apposito):
          // uno stato 'past_due' significa che il circuito sta ancora riprovando, e spegnere la
          // rete di qualcuno al primo tentativo fallito sarebbe sproporzionato.
          ...(attivo && piano ? {
            abbonamento_piano: piano.id, abbonamento_limite: piano.limite, abbonamento_prezzo: piano.prezzo,
            // Il cambio programmato e' arrivato a destinazione: l'attesa si chiude qui, altrimenti
            // la schermata continuerebbe ad annunciare un passaggio gia' avvenuto.
            ...(piano.id === m.abbonamento_piano_programmato
              ? { abbonamento_piano_programmato: null, abbonamento_programmato_dal: null } : {}),
          } : {}),
        }).eq('id', m.id)

        break
      }

      // ── Canone incassato (primo mese e tutti i rinnovi) ───────────────────
      case 'invoice.paid': {
        const inv = evento.data.object
        const m = await masterDi(inv)
        if (!m) break
        const root = await rootId()
        // Da quale piano viene questo incasso. Il punto in cui il circuito espone il prezzo della
        // riga e' cambiato fra le versioni della sua interfaccia: si provano le forme note e, se
        // nessuna risponde, si va a leggerlo direttamente sull'abbonamento — che e' la fonte sicura.
        const riga = inv.lines?.data?.[0]
        let piano = pianoDaPrezzo(riga?.price) || pianoDaPrezzo(riga?.pricing?.price_details?.price)
        if (!piano) {
          const subRif = inv.subscription || inv.parent?.subscription_details?.subscription
            || riga?.subscription || riga?.parent?.subscription_item_details?.subscription
          const subId = typeof subRif === 'string' ? subRif : subRif?.id
          if (subId) {
            try {
              const sub = await s.subscriptions.retrieve(subId, { expand: ['items.data.price'] })
              piano = pianoDaPrezzo(sub.items.data[0]?.price as any)
            } catch { /* si ripiega sul piano gia' registrato */ }
          }
        }
        // Si registra il TOTALE incassato, cioe' il prezzo del piano: e' la stessa cifra che
        // registrano i pagamenti con bonifico (139 €, non 113,93), altrimenti gli incassi della
        // pagina Abbonamenti sarebbero la somma di due grandezze diverse.
        const incassato = Number(inv.amount_paid ?? inv.total ?? 0) / 100
        await admin.from('abbonamenti_pagamenti').upsert({
          master_id: m.id, root_id: root, piano: piano?.id || m.abbonamento_piano || null,
          mese: meseCorrente(new Date(Number(inv.created || 0) * 1000)),
          importo: incassato, pagato: true, pagato_il: new Date(Number(inv.created || 0) * 1000).toISOString(),
          metodo: 'carta', stripe_invoice_id: inv.id,
        }, { onConflict: 'stripe_invoice_id' })
        // Canone del mese gia' assolto: il rinnovo automatico interno non deve riaddebitarlo.
        // E il conto alla rovescia si azzera: il pagamento e' entrato, la rete riparte da sola.
        await admin.from('masters').update({
          abbonamento_mese: meseCorrente(), stripe_stato: 'active', pagamento_scaduto_dal: null,
        }).eq('id', m.id)
        break
      }

      // ── Pagamento non riuscito: il circuito riprovera' da solo ────────────
      //
      // In entrambi i casi parte il conto alla rovescia verso il congelamento. La data di partenza
      // si scrive UNA volta sola: il circuito riprova piu' volte e ogni tentativo fallito manda un
      // evento — riscriverla a ogni colpo sposterebbe sempre piu' in la' il congelamento, che non
      // arriverebbe mai. Per questo l'aggiornamento della data e' separato e condizionato.
      case 'invoice.payment_failed':
      case 'invoice.payment_action_required': {
        const m = await masterDi(evento.data.object)
        if (m) {
          // 'past_due' = la carta ha detto no, va cambiata.
          // 'conferma_richiesta' = la banca chiede al titolare di confermare (3D Secure): la carta
          // e' buona, manca un clic. Sono due cose diverse e la schermata le dice in modo diverso.
          const stato = evento.type === 'invoice.payment_failed' ? 'past_due' : 'conferma_richiesta'
          await admin.from('masters').update({ stripe_stato: stato }).eq('id', m.id)
          await admin.from('masters')
            .update({ pagamento_scaduto_dal: new Date().toISOString() })
            .eq('id', m.id).is('pagamento_scaduto_dal', null)
        }
        break
      }

      // ── Abbonamento chiuso: il portale torna bloccato dalla scelta piano ──
      case 'customer.subscription.deleted': {
        const m = await masterDi(evento.data.object)
        if (m) await admin.from('masters').update({
          stripe_subscription_id: null, stripe_stato: 'canceled',
          abbonamento_piano: null, abbonamento_limite: null, abbonamento_prezzo: null,
          abbonamento_piano_programmato: null, abbonamento_programmato_dal: null,
          pagamento_scaduto_dal: null,
        }).eq('id', m.id)
        break
      }
    }
  } catch (e: any) {
    console.error('[STRIPE][WEBHOOK]', evento?.type, e?.message)
    // 500: il circuito riprova. Meglio una ripetizione (che i vincoli sul database reggono) che
    // un pagamento incassato e non registrato.
    return NextResponse.json({ error: 'errore interno' }, { status: 500 })
  }

  return NextResponse.json({ ricevuto: true })
}
