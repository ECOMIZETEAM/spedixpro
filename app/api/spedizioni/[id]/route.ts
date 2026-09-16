import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { colliDaRaw } from '@/lib/colli-dettaglio'

export const dynamic = 'force-dynamic'

// Dettaglio "pesante" di UNA spedizione: colli_dettaglio (blob escluso da SPED_COLS della lista) + pesi
// e misure. Serve al modale dettaglio (mostrare i colli di un MULTICOLLO, che la lista non porta) e alla
// correzione peso/misure multicollo. RLS: il client dell'utente vede solo le spedizioni del suo tenant.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data, error } = await supabase.from('spedizioni')
    // Tutti i campi che la FINESTRA di dettaglio mostra: da quando l'elenco manda la riga leggera
    // (?colonne=lista) questi non arrivano piu' dalla lista, e li porta questa chiamata — che il
    // dettaglio fa comunque all'apertura. Niente costo_spedizione: e' il costo del master, e questa
    // rotta la chiama anche il portale cliente.
    .select('id,numero,tracking_number,stato,created_at,cliente_id,colli,colli_dettaglio,peso_reale,peso_volume,peso_fatturato,lunghezza,larghezza,altezza,contenuto,note,servizi_accessori,contrassegno,assicurazione,valore_merce,costo_totale,richiedi_ritiro,data_ritiro,intervallo_ritiro,mitt_nome,mitt_indirizzo,mitt_citta,mitt_provincia,mitt_cap,mitt_paese,mitt_telefono,mitt_email,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_telefono,dest_email,raw_response')
    .eq('id', id).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  // MULTICOLLO senza colli_dettaglio salvato (tipico SpediamoPro): ricostruisco i colli dal raw_response
  // (parcels in mm/grammi) così il dettaglio e la correzione li mostrano invece di "singolo collo".
  const cd = Array.isArray((data as any).colli_dettaglio) ? (data as any).colli_dettaglio : []
  const colliDettaglio = cd.length > 0 ? cd : colliDaRaw((data as any).raw_response)
  // raw_response non serve al client (grande): lo tolgo dalla risposta.
  const { raw_response: _raw, ...pulito } = data as any
  return NextResponse.json({ ...pulito, colli_dettaglio: colliDettaglio })
}
