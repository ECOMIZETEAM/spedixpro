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
//
// La legge un componente solo, app/cliente/DatiBonifico: lo mostrano la pagina Ricarica credito e il
// riquadro "credito insufficiente" di Nuova spedizione, Ordini e Import. Le regole stanno qui.
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
  // Il client di servizio non ha i tipi delle tabelle: si dichiarano qui le sole colonne lette.
  const mr = (m || {}) as {
    nome?: string | null; iban?: string | null; intestatario?: string | null; banca?: string | null
    email_supporto?: string | null; email?: string | null
  }

  // L'IBAN esce nella forma elettronica, senza spazi e in maiuscolo: e' quella che il pulsante "copia"
  // mette negli appunti, e in Impostazioni il campo e' libero, senza nessun controllo.
  const iban = String(mr.iban || '').replace(/\s+/g, '').toUpperCase()
  // Basta l'IBAN: "contatta il master" solo se il master non ce l'ha (decisione di Lorenzo del
  // 21/10/2026). Chiedere anche l'intestatario mandava sul ripiego un master con l'IBAN ma senza
  // intestatario, e i suoi clienti non avrebbero saputo dove versare.
  const pronto = !!iban
  // L'intestatario esce solo se il master l'ha scritto, senza ripiegare sul suo nome (masters.nome):
  // il nome commerciale puo' non essere quello del conto, e la banca di chi paga confronta nome e IBAN
  // prima del bonifico (Verification of Payee, Reg. UE 2024/886, dal 9/10/2025). Se non tornano lo
  // avvisa, e il negozio abbandona il bonifico o lo manda "a rischio": meglio nessun nome che uno
  // sbagliato presentato come quello del conto. Al 21/10/2026 i 4 master con l'IBAN (su 51) hanno
  // tutti intestatario e banca: per i loro 388 clienti attivi a credito scalare non cambia niente.
  const intestatario = String(mr.intestatario || '').trim()
  return NextResponse.json({
    codice_cliente: cli.codice_cliente || null,
    ragione_sociale: cli.ragione_sociale || null,
    credito: Number(cli.credito || 0),
    // `pronto` distingue "il master non li ha ancora inseriti" da "non c'e' niente": la pagina
    // mostra un ripiego onesto invece di campi vuoti che sembrano un guasto.
    pronto,
    iban: pronto ? iban : null,
    intestatario: pronto ? (intestatario || null) : null,
    banca: pronto ? (mr.banca || null) : null,
    causale: `Ricarica credito ${cli.codice_cliente || cli.ragione_sociale || ''}`.trim(),
    contatto: mr.email_supporto || mr.email || null,
    master: mr.nome || null,
  })
}
