import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// LE SEZIONI OPERATIVE DEL CIRCUITO INTERNO.
//
//   partenza  i pacchi che i clienti hanno generato e che devono ancora uscire
//   arrivo    quelli in viaggio verso di noi o gia' in deposito, da mettere in consegna
//   consegne  la giornata degli autisti: chi ha consegnato cosa, e cosa e' rimasto indietro
//
// Sono tre letture sulla stessa realta', divise per quello che l'operatore deve fare adesso: e'
// il motivo per cui non basta l'elenco spedizioni generale.

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const vista = req.nextUrl.searchParams.get('vista') || 'partenza'
  const giorno = req.nextUrl.searchParams.get('giorno') || new Date().toISOString().slice(0, 10)

  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, utente.master_id)

  // Solo i contratti interni della rete: se non ce n'e' nessuno la sezione e' vuota, non e' un errore.
  const { data: contratti } = await admin.from('corrieri').select('id').eq('tipo', 'interno').in('master_id', rete)
  const corrieriIds = (contratti || []).map((c: any) => c.id)
  if (!corrieriIds.length) return NextResponse.json({ vista, righe: [], senzaContratto: true })

  if (vista === 'consegne') {
    const da = `${giorno}T00:00:00.000Z`, a = `${giorno}T23:59:59.999Z`
    const { data: sc } = await admin.from('scansioni_interne')
      .select('id,tipo,created_at,operatore,filiale,note,autista_id,autisti(nome),spedizioni(numero,dest_nome,dest_citta,dest_cap,contrassegno)')
      .eq('master_id', utente.master_id)
      .in('tipo', ['consegna', 'tentata'])
      .gte('created_at', da).lte('created_at', a)
      .order('created_at', { ascending: false }).limit(1000)
    return NextResponse.json({ vista, giorno, righe: sc || [] })
  }

  // "in partenza" = generate e non ancora uscite; "in arrivo" = in viaggio o gia' qui da consegnare.
  const stati = vista === 'arrivo'
    ? ['in_transito', 'in_consegna', 'in_giacenza']
    : ['in_lavorazione', 'spedita']
  const { data: sp } = await admin.from('spedizioni')
    .select('id,numero,stato,created_at,dest_nome,dest_citta,dest_cap,dest_provincia,dest_indirizzo,colli,peso_reale,contrassegno,cliente_id,clienti(ragione_sociale)')
    .in('corriere_id', corrieriIds).in('stato', stati)
    .order('created_at', { ascending: false }).limit(500)

  return NextResponse.json({ vista, righe: sp || [] })
}
