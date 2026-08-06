import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import {
  chiaveDestinatario, destinatarioDaEcommerce, destinatarioDaImportato, stessoDestinatario,
} from '@/lib/destinatario-chiave'

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
// LO STORICO NON SI CANCELLA: gli ordini assorbiti restano, con `unito_in` che punta al capofila.
// Il negozio continua a vederli e a poterli marcare evasi, e chi guarda dopo capisce cosa e'
// successo. Cancellarli farebbe sparire il numero d'ordine del negozio.
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

  // Gli articoli si sommano: e' il contenuto del pacco unico.
  const articoli: any[] = []
  for (const o of ordinati) if (Array.isArray(o.articoli)) articoli.push(...o.articoli)
  const totale = ordinati.reduce((s: number, o: any) => s + (Number(o.totale ?? o.totale_ordine) || 0), 0)

  const patchCapo: any = { articoli }
  if (tipo === 'importati') {
    patchCapo.totale_ordine = Math.round(totale * 100) / 100
    // Peso e colli si sommano davvero: e' un pacco piu' pesante, non tre pacchi.
    patchCapo.peso = ordinati.reduce((s: number, o: any) => s + (Number(o.peso) || 0), 0) || null
    patchCapo.colli = ordinati.reduce((s: number, o: any) => s + (Number(o.colli) || 0), 0) || null
    // Il contrassegno si somma: chi consegna incassa una volta sola, ma l'intero importo.
    patchCapo.contrassegno = ordinati.reduce((s: number, o: any) => s + (Number(o.contrassegno) || 0), 0) || 0
    patchCapo.rif_destinatario = ordinati.map((o: any) => o.order_id).filter(Boolean).join(' + ').slice(0, 120) || capo.rif_destinatario
  } else {
    patchCapo.totale = Math.round(totale * 100) / 100
  }

  const { error: e1 } = await supabase.from(tabella).update(patchCapo).eq('id', capo.id)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 })

  const { error: e2 } = await supabase.from(tabella)
    .update({ unito_in: capo.id, stato: 'unito' })
    .in('id', assorbiti.map((o: any) => o.id))
  if (e2) {
    // Il capofila e' gia' stato ingrossato: se gli assorbiti non si chiudono, spedirebbe la merce
    // di tutti e loro resterebbero da spedire. Si torna indietro.
    await supabase.from(tabella).update({
      articoli: capo.articoli,
      ...(tipo === 'importati'
        ? { totale_ordine: capo.totale_ordine, peso: capo.peso, colli: capo.colli, contrassegno: capo.contrassegno, rif_destinatario: capo.rif_destinatario }
        : { totale: capo.totale }),
    }).eq('id', capo.id)
    return NextResponse.json({ error: e2.message }, { status: 400 })
  }

  return NextResponse.json({
    success: true, capofila: capo.id, uniti: assorbiti.length,
    numero: capo.numero_ordine || capo.order_id || null,
    articoli: articoli.length,
    totale: Math.round(totale * 100) / 100,
  })
}
