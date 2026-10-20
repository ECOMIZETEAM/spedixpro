import { NextRequest, NextResponse, after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { ESITI_EVASIONE, PIATTAFORME_UNITI_EVASI, assorbitiDaEvadere } from '@/lib/evasione-ordini'
import { assorbitiDi } from '@/lib/ordini-uniti'
import { PREFISSO_ANNULLO } from '@/lib/shopify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Il segno lasciato su una riga Shopify rispedita mentre su Shopify c'e' forse ancora l'evasione
// della spedizione di prima (vedi sotto). Comincia col prefisso dell'annullo: se la spedizione nuova
// venisse annullata prima di essere evasa, la riga resta candidata dell'annullo (lib/shopify).
const EVASIONE_PRECEDENTE = `${PREFISSO_ANNULLO}: evasione precedente da annullare`

// IL PACCO NUOVO VALE ANCHE PER GLI ASSORBITI. Sulle piattaforme dove gli ordini uniti si evadono col
// tracking del capofila (lib/evasione-ordini), quando il capofila cambia spedizione si azzerano allo
// stesso modo gli assorbiti che l'evasione manda col pacco (assorbitiDaEvadere, la stessa regola). Mai
// quelli spediti a parte, nemmeno se poi la loro spedizione si e' annullata: hanno avuto la loro
// evasione, e rievaderli col pacco manderebbe al compratore una seconda email. Si leggono con la
// sessione del cliente e ogni scrittura resta vincolata al cliente.
async function azzeraAssorbitiDelPacco(supabase: any, capoId: string, clienteId: string) {
  const perCapo = await assorbitiDi(supabase, [capoId], 'id,unito_in,created_at,piattaforma,stato,spedizione_id,stato_pagamento,fulfillment_stato')
  const colPacco = assorbitiDaEvadere(perCapo.get(String(capoId)) || [])
  const conTraccia = colPacco.filter((r: any) => r.piattaforma === 'shopify' && ESITI_EVASIONE.includes(String(r.fulfillment_stato || ''))).map((r: any) => r.id)
  const altri = colPacco.map((r: any) => r.id).filter((id: string) => !conTraccia.includes(id))
  if (conTraccia.length) {
    const { error } = await supabase.from('ordini_ecommerce')
      .update({ fulfillment_stato: 'errore', fulfillment_errore: EVASIONE_PRECEDENTE, fulfillment_tentativi: 0 })
      .in('id', conTraccia).eq('cliente_id', clienteId).is('spedizione_id', null)
    if (error) throw new Error(error.message)
  }
  if (altri.length) {
    const { error } = await supabase.from('ordini_ecommerce')
      .update({ fulfillment_stato: null, fulfillment_errore: null, fulfillment_tentativi: 0 })
      .in('id', altri).eq('cliente_id', clienteId).is('spedizione_id', null)
    if (error) throw new Error(error.message)
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const ordineId = body.ordine_id
  const spedizioneId = body.spedizione_id || null
  if (!ordineId) return NextResponse.json({ error: 'ordine_id mancante' }, { status: 400 })

  // L'ordine puo' venire dalla sync API (ordini_ecommerce) o dall'import CSV (ordini_importati):
  // aggiorno per id in entrambe, aggiorna solo la tabella che contiene davvero quell'id.
  // SPEDIZIONE RIFATTA: l'esito dell'evasione VECCHIA non vale piu'.
  //
  // Se l'ordine viene rispedito (la prima spedizione annullata, o rifatta), qui cambiava solo
  // spedizione_id e restavano fulfillment_stato/errore/tentativi della volta prima. Con 'ok' vecchio
  // il tracking NUOVO non veniva mandato allo store mai piu' (l'evasione salta i gia' 'ok'), e con i
  // tentativi al massimo il recupero non lo ripescava. Si azzerano solo quando la spedizione cambia
  // davvero: un doppio clic sullo stesso ordine non deve far ripartire niente.
  if (spedizioneId) {
    // In due tempi. PRIMA la riga Shopify che porta la traccia di un'evasione nostra forse ancora
    // attiva: senza spedizione ma con un esito d'evasione (ok, attesa, errore), cioe' un ordine evaso e
    // poi staccato da una spedizione annullata (trigger trg_ordine_torna_da_spedire). Azzerata a null,
    // se la spedizione nuova venisse annullata prima di essere evasa la riga perderebbe la traccia, e
    // l'evasione col tracking morto resterebbe su Shopify per sempre. Con 'errore' l'evasione la lavora
    // comunque (salta solo gli 'ok') e prima toglie l'evasione morta (lib/shopify). Fino ad allora la
    // riga mostra «Store non aggiornato», ed e' vero.
    const { data: conTraccia } = await supabase.from('ordini_ecommerce')
      .update({ stato: 'spedito', spedizione_id: spedizioneId, fulfillment_stato: 'errore', fulfillment_errore: EVASIONE_PRECEDENTE, fulfillment_tentativi: 0 })
      .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
      .eq('piattaforma', 'shopify').is('spedizione_id', null).in('fulfillment_stato', ESITI_EVASIONE)
      .select('id,piattaforma')
    // POI le altre, come sempre.
    const { data: azzerate } = await supabase.from('ordini_ecommerce')
      .update({ stato: 'spedito', spedizione_id: spedizioneId, fulfillment_stato: null, fulfillment_errore: null, fulfillment_tentativi: 0 })
      .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
      .or(`spedizione_id.is.null,spedizione_id.neq.${spedizioneId}`)
      .select('id,piattaforma')
    const cambiata = [...(conTraccia || []), ...(azzerate || [])][0]
    if (cambiata && PIATTAFORME_UNITI_EVASI.has(String(cambiata.piattaforma))) {
      // L'ordine e' gia' legato alla spedizione: un errore qui non deve far fallire la risposta.
      try { await azzeraAssorbitiDelPacco(supabase, String(ordineId), utente.cliente_id) }
      catch (e: any) { console.error('[ORDINI][ASSORBITI DEL PACCO]', ordineId, e?.message) }
    }
    // AMAZON, ORDINI UNITI A QUESTO: viaggiano nel pacco del capofila e Amazon li conferma col
    // tracking del pacco (lib/amazonFulfill). Se il pacco e' cambiato, la loro conferma vecchia porta
    // il tracking di un'etichetta che non c'e' piu': tornano da confermare, e la spinta qui sotto li
    // rimanda col tracking nuovo (stesso pacco per Amazon: la conferma si corregge, non si somma).
    if (cambiata) {
      await supabase.from('ordini_ecommerce')
        .update({ fulfillment_stato: null, fulfillment_errore: null, fulfillment_tentativi: 0 })
        .eq('unito_in', ordineId).eq('cliente_id', utente.cliente_id).eq('piattaforma', 'amazon').is('spedizione_id', null)
    }
  }
  await supabase.from('ordini_ecommerce')
    .update({ stato: 'spedito', spedizione_id: spedizioneId })
    .eq('id', ordineId).eq('cliente_id', utente.cliente_id)
  await supabase.from('ordini_importati')
    .update({ stato: 'spedito', spedizione_id: spedizioneId, errore: null })
    .eq('id', ordineId).eq('cliente_id', utente.cliente_id)

  // EVASIONE SUBITO SUL NEGOZIO, non al prossimo giro.
  //
  // Finora il tracking tornava allo store SOLO alla creazione della distinta o col recupero ogni 20
  // minuti. Funzionava, ma in differita: chi spedisce dall'app guarda Shopify e vede ancora
  // "unfulfilled". E' esattamente la bocciatura 2.1.4 della review Shopify ("fulfilling them there
  // fails to update their status in the Shopify admin"): il revisore ha spedito e ha guardato
  // subito. Un merchant fa la stessa cosa.
  //
  // Qui e' il punto UNICO in cui un ordine diventa spedito e viene legato alla sua spedizione — le
  // tre pagine che spediscono da un ordine passano tutte di qua — quindi la spinta si mette una
  // volta sola invece che in ogni ramo di creazione.
  //
  // Resta best-effort e non blocca la risposta: fulfillMarketplace e' IDEMPOTENTE (salta gli ordini
  // gia' 'ok') e ha le sue guardie — non evade con una LDV provvisoria, per non mandare al
  // compratore un tracking finto. Quelle le riprende il recupero ogni 20 minuti, come prima.
  if (spedizioneId) {
    // La spedizione dev'essere DI QUESTO CLIENTE: l'id arriva dal corpo della richiesta, e senza
    // questo controllo si potrebbe far evadere la spedizione di un altro (gli aggiornamenti qui
    // sopra sono gia' vincolati al cliente, questa chiamata no).
    const { data: mia } = await supabase
      .from('spedizioni').select('id').eq('id', spedizioneId).eq('cliente_id', utente.cliente_id).maybeSingle()
    if (mia) {
      after(async () => {
        try {
          const { createAdminSupabase } = await import('@/lib/supabase-admin')
          const { fulfillMarketplace } = await import('@/lib/fulfillMarketplace')
          await fulfillMarketplace(createAdminSupabase(), [spedizioneId])
        } catch (e: any) {
          // L'ordine e' gia' segnato spedito da noi: se lo store non si aggiorna adesso ci pensa il
          // recupero. Non deve mai far fallire la spedizione.
          console.error('[ORDINI][FULFILL IMMEDIATO]', spedizioneId, e?.message)
        }
      })
    }
  }
  return NextResponse.json({ ok: true })
}
