import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Campi che il cliente può modificare (mai master_id/cliente_id/stato/spedizione_id)
const CAMPI_TESTO = [
  'destinatario', 'indirizzo', 'cap', 'localita', 'provincia', 'country',
  'telefono', 'email_destinatario', 'contenuto', 'note',
  'rif_mittente', 'rif_destinatario', 'order_id',
]
const CAMPI_NUM = ['peso', 'contrassegno', 'totale_ordine']

function toNumOrNull(v: any): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
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

  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'ID ordine mancante' }, { status: 400 })

  // Costruisce il patch solo dai campi ammessi e presenti nel body
  const patch: Record<string, any> = {}
  for (const k of CAMPI_TESTO) {
    if (k in body) {
      const v = (body[k] ?? '').toString().trim()
      patch[k] = v === '' ? null : v
    }
  }
  for (const k of CAMPI_NUM) {
    if (k in body) patch[k] = toNumOrNull(body[k])
  }
  if ('colli' in body) patch.colli = Math.max(1, Math.round(toNumOrNull(body.colli) ?? 1))

  // Normalizzazioni
  if (patch.provincia) patch.provincia = String(patch.provincia).toUpperCase()
  if (patch.country) patch.country = String(patch.country).toUpperCase()
  else if ('country' in patch) patch.country = 'IT'

  // Validazione minima obbligatori (se presenti nel body non devono essere vuoti)
  for (const k of ['destinatario', 'indirizzo', 'cap', 'localita', 'provincia']) {
    if (k in body && !patch[k]) {
      return NextResponse.json({ error: `Campo obbligatorio vuoto: ${k}` }, { status: 400 })
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
  }

  // Isolamento: solo ordini del cliente in sessione e non già spediti/archiviati
  const { data, error } = await supabase
    .from('ordini_importati')
    .update(patch)
    .eq('id', id)
    .eq('cliente_id', utente.cliente_id)
    .in('stato', ['da_spedire', 'errore'])
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) {
    return NextResponse.json({ error: 'Ordine non trovato o non modificabile' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
