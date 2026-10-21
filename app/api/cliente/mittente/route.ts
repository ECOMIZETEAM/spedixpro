import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { contoNatoDaShopify } from '@/lib/conti-shopify'
import { emailMittenteCliente } from '@/lib/dati-negozio'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { data: cliente, error } = await supabase
    .from('clienti').select('ragione_sociale,so_indirizzo,so_citta,so_provincia,so_cap,email,telefono,impostazioni')
    .eq('id', utente.cliente_id).single()
  if (error || !cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  // Il mittente e' la sede operativa (so_*), e basta. C'era un ripiego su nome, indirizzo, citta,
  // provincia e cap, colonne che in clienti non esistono: valeva sempre '' e faceva credere che ci
  // fosse un secondo posto da cui l'indirizzo potesse arrivare.
  const c: any = cliente
  const mittente = {
    nome: c.ragione_sociale || '',
    indirizzo: c.so_indirizzo || '',
    citta: c.so_citta || '',
    provincia: c.so_provincia || '',
    cap: c.so_cap || '',
    email: emailMittenteCliente(c),
    telefono: c.telefono || '',
  }

  // conto_shopify: solo al conto nato dall'installazione dell'app la pagina offre di riaprire la
  // schermata dei dati del negozio quando l'indirizzo manca.
  return NextResponse.json({ mittente, conto_shopify: contoNatoDaShopify(c) })
}
