import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DATI PER RICARICARE CON BONIFICO.
//
// Le ricariche self-service con carta sono sospese, e la pagina diceva soltanto "contatta il tuo
// referente": un vicolo cieco. Il cliente non puo' spedire finche' non ha credito, quindi deve
// almeno sapere DOVE versarlo. Chi incassa non e' MoovExpress ma il MASTER del cliente: i dati
// bancari sono i suoi (masters.iban/intestatario/banca), e la causale porta il codice cliente cosi'
// l'accredito si riconosce senza rincorrere nessuno.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo, cliente_id').eq('id', user.id).maybeSingle()
  if (u?.ruolo !== 'cliente' || !u?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Admin: il cliente non ha (giustamente) visibilita' sulla riga del suo master. Si restituisce
  // SOLO cio' che gli serve per pagare — mai il resto dell'anagrafica del master.
  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti')
    .select('codice_cliente,ragione_sociale,credito,master_id').eq('id', u.cliente_id).maybeSingle()
  if (!cli) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })
  const { data: m } = await admin.from('masters')
    .select('nome,iban,intestatario,banca,email_supporto,email').eq('id', cli.master_id).maybeSingle()

  const iban = String((m as any)?.iban || '').trim()
  return NextResponse.json({
    codice_cliente: cli.codice_cliente || null,
    ragione_sociale: cli.ragione_sociale || null,
    credito: Number(cli.credito || 0),
    // `pronto` distingue "il master non li ha ancora inseriti" da "non c'e' niente": la pagina
    // mostra un ripiego onesto invece di campi vuoti che sembrano un guasto.
    pronto: !!iban,
    iban: iban || null,
    intestatario: (m as any)?.intestatario || (m as any)?.nome || null,
    banca: (m as any)?.banca || null,
    causale: `Ricarica credito ${cli.codice_cliente || cli.ragione_sociale || ''}`.trim(),
    contatto: (m as any)?.email_supporto || (m as any)?.email || null,
    master: (m as any)?.nome || null,
  })
}
