import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import {
  chiaveDestinatario, destinatarioDaEcommerce, destinatarioDaImportato, stessoDestinatario,
} from '@/lib/destinatario-chiave'
import { assorbitiDi, componiPacco } from '@/lib/ordini-uniti'

// UNISCE PIU' ORDINI IN UNO SOLO, quando vanno tutti alla stessa persona.
//
// Lo stesso compratore ordina tre volte nella stessa mattina: oggi partono tre pacchi e si pagano
// tre noli. Uniti, e' un pacco solo.
//
// LA REGOLA E' STRETTA E NON SI NEGOZIA: si uniscono solo se i dati del destinatario sono
// IDENTICI. Non si indovina e non ci si accontenta di "sembra lo stesso" — sbagliare qui vuol dire
// mandare la merce di uno a casa di un altro. L'unica tolleranza e' su come e' scritto lo stesso
// dato (maiuscole, accenti, spazi, punteggiatura): quella non cambia dove va il pacco.
//
// LO STORICO NON SI CANCELLA: gli ordini assorbiti restano, con `unito_in` che punta al capofila, e
// chi guarda dopo capisce cosa e' successo. Cancellarli farebbe sparire il numero d'ordine del negozio.
// Sul negozio gli assorbiti Shopify li evadiamo noi, col tracking del capofila, uno per uno, quando il
// pacco parte (lib/evasione-ordini); quelli Amazon li conferma il collegamento diretto, con una regola
// sua (lib/amazonFulfill). Sulle altre piattaforme il negozio continua a vederli aperti e a poterli
// marcare evasi da se': estendere l'evasione anche a loro e' una scelta ancora da fare.
//
// Si uniscono solo ordini ANCORA DA SPEDIRE: uno gia' partito ha la sua etichetta e i suoi soldi.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo,cliente_id,master_id').eq('id', user.id).single()

  const body = await req.json().catch(() => ({}))
  const tipo = body?.tipo === 'importati' ? 'importati' : 'ecommerce'
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : []
  if (ids.length < 2) return NextResponse.json({ error: 'Servono almeno due ordini da unire' }, { status: 400 })

  const tabella = tipo === 'importati' ? 'ordini_importati' : 'ordini_ecommerce'

  // Il perimetro lo fanno le regole per riga: si legge con la SESSIONE di chi chiede, non con la
  // chiave di servizio. Cosi' un ordine che non e' suo non torna, e non c'e' un controllo da
  // ricordarsi di scrivere a mano.
  const { data: ordini } = await supabase.from(tabella).select('*').in('id', ids)
  if (!ordini || ordini.length !== ids.length) {
    return NextResponse.json({ error: 'Alcuni ordini non esistono o non sono tuoi' }, { status: 404 })
  }

  // Un ordine che il negozio ha annullato non si unisce a un altro: finirebbe nel pacco del capofila
  // merce che il compratore non aspetta piu'.
  const annullati = ordini.filter((o: any) => o.stato === 'annullato')
  if (annullati.length) {
    return NextResponse.json({
      error: `Non unibili: ${annullati.length === 1 ? '1 ordine risulta annullato' : annullati.length + ' ordini risultano annullati'} sul negozio.`,
    }, { status: 400 })
  }

  const giaPartiti = ordini.filter((o: any) => o.spedizione_id || o.unito_in)
  if (giaPartiti.length) {
    return NextResponse.json({
      error: `Non unibili: ${giaPartiti.length} ordini hanno gia' una spedizione o sono gia' stati uniti.`,
    }, { status: 400 })
  }

  const chiavi = ordini.map((o: any) =>
    chiaveDestinatario(tipo === 'importati' ? destinatarioDaImportato(o) : destinatarioDaEcommerce(o)))
  if (!stessoDestinatario(chiavi)) {
    return NextResponse.json({
      error: 'I dati del destinatario non sono identici: questi ordini non si uniscono. Controlla nome, indirizzo, CAP, comune, telefono ed email.',
    }, { status: 400 })
  }

  // Il CAPOFILA e' il piu' vecchio: e' quello che il negozio ha visto per primo e che chi guarda
  // si aspetta di trovare.
  const ordinati = [...ordini].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
  const capo = ordinati[0]
  const assorbiti = ordinati.slice(1)

  const idsAssorbiti = assorbiti.map((o: any) => o.id)

  // ORDINI DEI NEGOZI: NIENTE COPIE SUL CAPOFILA. Il capofila e' anche l'ordine del negozio e la sync lo
  // riscrive con le sue sole righe: gli articoli e il totale copiati qui sparivano al giro dopo (eBay: 9
  // capofila su 9, 19/10/2026), e il contrassegno era quello del capofila applicato a tutto il pacco. Il
  // pacco ora si compone in lettura da tutti gli ordini uniti (lib/ordini-uniti): somma degli articoli e
  // del valore, contrassegno = somma dei soli ordini in contrassegno.
  if (tipo === 'ecommerce') {
    const { error: e2 } = await supabase.from(tabella).update({ unito_in: capo.id, stato: 'unito' }).in('id', idsAssorbiti)
    if (e2) return NextResponse.json({ error: e2.message }, { status: 400 })
    // Chi era gia' unito a uno degli ordini appena assorbiti ora punta al nuovo capofila. La lettura
    // segue comunque le catene (lib/ordini-uniti); cosi' pero' ogni assorbito dice da solo con chi parte.
    const { error: e3 } = await supabase.from(tabella).update({ unito_in: capo.id }).in('unito_in', idsAssorbiti)
    if (e3) console.error('[UNISCI] appiattimento unioni precedenti (le catene si seguono comunque):', e3.message)
    // L'unione e' gia' scritta: un errore nel ricomporre il pacco per la risposta non deve farla sembrare fallita.
    let membri: any[] = assorbiti
    try { membri = (await assorbitiDi(supabase, [capo.id], 'id,unito_in,created_at,articoli,totale,spedizione_id,stato_pagamento')).get(capo.id) || assorbiti } catch {}
    const pacco = componiPacco(capo, membri)
    return NextResponse.json({
      success: true, capofila: capo.id, uniti: assorbiti.length,
      numero: capo.numero_ordine || null,
      articoli: pacco.articoli.length,
      totale: pacco.totale,
    })
  }

  // ORDINI DA FILE: qui la riga e' solo nostra, nessuna sync la riscrive, e il pacco si scrive sul capofila.
  // Gli articoli si sommano: e' il contenuto del pacco unico.
  const articoli: any[] = []
  for (const o of ordinati) if (Array.isArray(o.articoli)) articoli.push(...o.articoli)
  const totale = ordinati.reduce((s: number, o: any) => s + (Number(o.totale_ordine) || 0), 0)

  const patchCapo: any = {
    articoli,
    totale_ordine: Math.round(totale * 100) / 100,
    // Il peso si somma: e' un pacco piu' pesante, non tre pacchi.
    peso: ordinati.reduce((s: number, o: any) => s + (Number(o.peso) || 0), 0) || null,
    // I COLLI NO. Qui si sommavano anche loro, contro la frase sopra e contro cio' che la pagina
    // chiede ("Unire N ordini in un pacco solo?"): ogni capofila finiva con tanti colli quanti ordini
    // uniti, perche' da Amazon, Shopify e Temu ogni ordine arriva con 1 collo di default. Finche' il
    // lotto spediva sempre un collo solo non si vedeva; la matita invece apriva la spedizione con N
    // colli e il peso diviso. Su 63 unioni (fino al 19/10/2026) 49 sono partite a un collo — 18 col
    // cliente che riportava a mano i colli a 1 — e 14 a piu' colli. Resta il numero piu' alto fra gli
    // ordini uniti: un collo per chi non ne dichiara, e chi ha davvero piu' scatole lo dice nel modulo.
    colli: Math.max(1, ...ordinati.map((o: any) => Math.round(Number(o.colli)) || 1)),
    // Il contrassegno si somma: chi consegna incassa una volta sola, ma l'intero importo. Un ordine
    // gia' pagato ha contrassegno 0 e non aggiunge niente (pagato 100 + contrassegno 90 = 90).
    contrassegno: ordinati.reduce((s: number, o: any) => s + (Number(o.contrassegno) || 0), 0) || 0,
    rif_destinatario: ordinati.map((o: any) => o.order_id).filter(Boolean).join(' + ').slice(0, 120) || capo.rif_destinatario,
  }

  const { error: e1 } = await supabase.from(tabella).update(patchCapo).eq('id', capo.id)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 })

  const { error: e2 } = await supabase.from(tabella)
    .update({ unito_in: capo.id, stato: 'unito' })
    .in('id', idsAssorbiti)
  if (e2) {
    // Il capofila e' gia' stato ingrossato: se gli assorbiti non si chiudono, spedirebbe la merce
    // di tutti e loro resterebbero da spedire. Si torna indietro.
    await supabase.from(tabella).update({
      articoli: capo.articoli, totale_ordine: capo.totale_ordine, peso: capo.peso, colli: capo.colli,
      contrassegno: capo.contrassegno, rif_destinatario: capo.rif_destinatario,
    }).eq('id', capo.id)
    return NextResponse.json({ error: e2.message }, { status: 400 })
  }
  // Chi era unito a uno degli assorbiti ora punta al nuovo capofila: i report del marketplace danno a
  // ogni ordine unito il tracking di chi lo punta, e un ordine intermedio una spedizione non ce l'ha.
  const { error: e3 } = await supabase.from(tabella).update({ unito_in: capo.id }).in('unito_in', idsAssorbiti)
  if (e3) console.error('[UNISCI] appiattimento unioni precedenti:', e3.message)

  return NextResponse.json({
    success: true, capofila: capo.id, uniti: assorbiti.length,
    numero: capo.order_id || null,
    articoli: articoli.length,
    totale: Math.round(totale * 100) / 100,
  })
}
