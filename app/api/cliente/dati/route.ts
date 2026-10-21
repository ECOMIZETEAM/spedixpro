import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { contoNatoDaShopify } from '@/lib/conti-shopify'
import { emailMittenteCliente, fondiImpostazioniNegozio } from '@/lib/dati-negozio'
async function getClienteId(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  return utente?.cliente_id || null
}
export async function GET() {
  const supabase = await createServerSupabase()
  const id = await getClienteId(supabase)
  if (!id) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: cliente } = await supabase.from('clienti').select('*').eq('id', id).single()
  if (!cliente) return NextResponse.json({ error: 'Non trovato' })
  // Due campi calcolati qui, perche' le pagine non ripetano la regola:
  // - conto_shopify: il conto e' nato dall'installazione dell'app. Solo a lui i messaggi "manca
  //   l'indirizzo" offrono di riaprire la schermata dei dati del negozio; gli altri clienti non la hanno.
  // - email_mittente: l'email da precompilare nel mittente. Il conto Shopify ha un indirizzo nostro che
  //   non riceve posta, e finiva in ogni spedizione (lib/dati-negozio, emailMittenteCliente).
  // Il PUT di questa rotta li ignora: legge solo impostazioni ed eori.
  return NextResponse.json({ ...cliente, conto_shopify: contoNatoDaShopify(cliente), email_mittente: emailMittenteCliente(cliente) })
}
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabase()
  const id = await getClienteId(supabase)
  if (!id) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  // il cliente puo aggiornare solo le proprie impostazioni (non credito, non listino, ecc.)
  const payload: any = {}
  if (body.impostazioni !== undefined) {
    // Per un conto nato da Shopify le impostazioni si fondono sulla riga di adesso: la pagina Stampa e
    // Notifiche rimanda la copia letta all'apertura, e se era aperta sotto la schermata del primo accesso
    // cancellava l'email vera appena data e rimetteva la schermata (lib/dati-negozio, fondiImpostazioniNegozio).
    // Per tutti gli altri clienti resta com'era: l'oggetto arriva e si scrive.
    const { data: riga } = await supabase.from('clienti').select('email,impostazioni').eq('id', id).maybeSingle()
    payload.impostazioni = riga && contoNatoDaShopify(riga) ? fondiImpostazioniNegozio(riga, body.impostazioni) : body.impostazioni
  }
  // EORI: il cliente può impostare il proprio codice doganale (serve per le spedizioni extra-UE).
  if (body.eori !== undefined) payload.eori = body.eori ? String(body.eori).trim().slice(0, 30) : null
  if (Object.keys(payload).length === 0) return NextResponse.json({ ok: true })
  const { error } = await supabase.from('clienti').update(payload).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
// La pagina Impostazioni salva via PUT: stesso comportamento del PATCH (solo impostazioni).
export async function PUT(req: NextRequest) { return PATCH(req) }