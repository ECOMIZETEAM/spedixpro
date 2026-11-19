import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COSTO_SMS_EUR, smsConfigurato } from '@/lib/sms'
import { confineGiornoRoma } from '@/lib/date-roma'

export const dynamic = 'force-dynamic'

// Stato credito SMS del master + storico + clienti (per il trasferimento). Solo staff del master.
//
// STORICO: un portafoglio alla volta. Prima erano le ultime 80 righe di movimenti_sms del master,
// mescolando il SUO credito con quello dei portafogli dei clienti e senza dire di chi: per GENIUS
// nessuna delle 80 era del master (332 invii e 122 rimborsi dei clienti), e il suo acquisto da 100 €
// non compariva. Ora: il portafoglio del master (cliente_id null) se non si sceglie un cliente, il
// periodo nei giorni di Roma e le pagine.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  if (!u?.master_id || !['master', 'admin', 'operatore'].includes(ruolo)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const p = req.nextUrl.searchParams
  const clienteSel = p.get('clienteId') || ''                       // vuoto = portafoglio del master
  const dal = confineGiornoRoma(p.get('dal'), 'dal')
  const al = confineGiornoRoma(p.get('al'), 'al')
  const perPagina = Math.min(100, Math.max(1, parseInt(p.get('perPagina') || '25', 10) || 25))
  const pagina = Math.max(1, parseInt(p.get('pagina') || '1', 10) || 1)

  const admin = createAdminSupabase()
  const [{ data: m, error: eM }, { data: clienti, error: eC }] = await Promise.all([
    admin.from('masters').select('credito,credito_sms,parent_master_id,impostazioni,stripe_customer_id,sms_test_abilitato').eq('id', u.master_id).maybeSingle(),
    // Senza i clienti-ledger "(ingrosso)": sono la contabilita' di un master collegato, non un cliente
    // a cui girare SMS.
    admin.from('clienti').select('id,ragione_sociale,credito_sms').eq('master_id', u.master_id).eq('ledger', false).order('ragione_sociale'),
  ])
  if (eM || eC) return NextResponse.json({ error: 'Lettura non riuscita: ' + (eM || eC)!.message }, { status: 500 })
  const nomeCliente = new Map<string, string>((clienti || []).map((c: any) => [c.id, c.ragione_sociale]))
  if (clienteSel && !nomeCliente.has(clienteSel)) return NextResponse.json({ error: 'Il cliente non e\' tuo' }, { status: 403 })

  let q = admin.from('movimenti_sms').select('id,tipo,descrizione,importo,quantita_sms,saldo_dopo,cliente_id,created_at', { count: 'exact' })
    .eq('master_id', u.master_id)
  q = clienteSel ? q.eq('cliente_id', clienteSel) : q.is('cliente_id', null)
  if (dal) q = q.gte('created_at', dal)
  if (al) q = q.lte('created_at', al)
  const { data: mov, count, error: eMov } = await q
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((pagina - 1) * perPagina, pagina * perPagina - 1)
  if (eMov) return NextResponse.json({ error: 'Lettura dello storico non riuscita: ' + eMov.message }, { status: 500 })

  // Colonna Cliente. Sul portafoglio del master il trasferimento non dice a chi e' andato: la stessa
  // operazione (sms_trasferisci) scrive la riga gemella sul cliente nello stesso istante, ed e' da li'
  // che si legge il nome.
  const aChi = new Map<string, string>()
  const istanti = (mov || []).filter((x: any) => !x.cliente_id && x.tipo === 'trasferimento').map((x: any) => x.created_at)
  if (istanti.length) {
    const { data: gemelle, error: eG } = await admin.from('movimenti_sms').select('cliente_id,created_at')
      .eq('master_id', u.master_id).eq('tipo', 'trasferimento').not('cliente_id', 'is', null).in('created_at', istanti)
    if (eG) return NextResponse.json({ error: 'Lettura dello storico non riuscita: ' + eG.message }, { status: 500 })
    for (const g of (gemelle || [])) aChi.set((g as any).created_at, nomeCliente.get((g as any).cliente_id) || '—')
  }
  const movimenti = (mov || []).map((x: any) => ({
    ...x,
    cliente: x.cliente_id ? (nomeCliente.get(x.cliente_id) || '—') : (aChi.get(x.created_at) || null),
  }))

  return NextResponse.json({
    creditoWallet: Number(m?.credito || 0),
    creditoSms: Number(m?.credito_sms || 0),
    costoSms: COSTO_SMS_EUR,
    movimenti,
    totaleMovimenti: count || 0,
    pagina, perPagina,
    clienti: clienti || [],
    // Il gateway Esendex/Skebby è UNICO e globale (conto E&A): l'SMS di prova, che spende il credito
    // vero, è riservato al master RADICE (senza genitore). gatewayPronto = env credenziali presenti.
    radice: !m?.parent_master_id,
    // Chi può vedere le PROVE SMS: il radice o un master esplicitamente abilitato (es. Ecomize LL).
    puoTestare: !m?.parent_master_id || !!m?.sms_test_abilitato,
    gatewayPronto: smsConfigurato(),
    cartaSalvata: !!m?.stripe_customer_id,
    auto: (() => { const a = ((m?.impostazioni as any) || {}).sms_auto || {}; return { attiva: !!a.attiva, soglia: Number(a.soglia) || 100, pacchetto: Number(a.pacchetto) || 1000 } })(),
  })
}
