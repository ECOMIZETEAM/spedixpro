import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// STATO DI UNA SPEDIZIONE APPENA CREATA.
//
// Alcuni corrieri non restituiscono la lettera di vettura nell'istante in cui accettano l'ordine:
// la preparano qualche secondo dopo. La creazione, per non lasciare la spedizione senza un
// identificativo, la registra con un numero provvisorio (TMP-…) e la completa in background.
// Risultato: il messaggio "spedizione generata" mostrava un numero che non esiste per il corriere,
// e il codice di prenotazione del ritiro non lo mostrava affatto.
//
// Questa rotta esiste perche' la schermata possa richiedere il numero vero appena c'e' e
// aggiornare il messaggio. Restituisce solo cio' che serve a scriverlo — niente raw_response,
// che contiene i dati tecnici del fornitore.
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

  // Client UTENTE, non admin: la visibilita' la decide RLS, esattamente come in elenco. Con il
  // client admin questa rotta lascerebbe leggere il numero di qualunque spedizione conoscendone l'id.
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: sped } = await supabase
    .from('spedizioni')
    .select('id,numero,tracking_number,etichetta_url,richiedi_ritiro,raw_response')
    .eq('id', id).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Il codice del ritiro arriva come "CP124656395 03-08-2026": il numero e' il primo pezzo.
  const cr = String((sped.raw_response as any)?._codiceRitiro || '').trim()
  const codiceRitiro = cr ? cr.split(/\s+/)[0] : null

  const numero = String(sped.numero || '')
  return NextResponse.json({
    numero,
    // Vero quando il numero e' ancora quello provvisorio: la schermata sa che deve richiedere ancora.
    provvisorio: /^(TMP|DVA)-/.test(numero),
    codiceRitiro,
    richiediRitiro: !!sped.richiedi_ritiro,
    etichettaPronta: !!sped.etichetta_url,
  })
}
