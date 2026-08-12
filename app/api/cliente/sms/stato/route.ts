import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COSTO_SMS_EUR, smsConfigurato } from '@/lib/sms'

export const dynamic = 'force-dynamic'

// Stato SMS del CLIENTE: quanti ne restano, gli inviati (con esito) e i pacchetti comprati, più la
// configurazione dell'auto-ricarica. Solo l'utente del portale cliente, solo per sé.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).maybeSingle()
  if (!u?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: cli } = await admin.from('clienti').select('credito_sms,impostazioni,stripe_customer_id').eq('id', u.cliente_id).maybeSingle()
  const { data: mov } = await admin.from('movimenti_sms')
    .select('tipo,descrizione,quantita_sms,importo,spedizione_id,created_at')
    .eq('cliente_id', u.cliente_id).order('created_at', { ascending: false }).limit(150)

  // SMS DAVVERO inviati = spedizioni con notifica_sms a true (il flag si accende solo a invio riuscito).
  // NON si usano le righe 'consumo' di movimenti_sms: un invio fallito consuma e poi rimborsa, ma
  // resterebbe in elenco come se fosse partito (è quello che confondeva).
  const { data: spSms } = await admin.from('spedizioni')
    .select('numero,created_at').eq('cliente_id', u.cliente_id).eq('notifica_sms', true)
    .order('created_at', { ascending: false }).limit(100)
  const inviati = (spSms || []).map((s: any) => ({ numero: s.numero, quando: s.created_at }))
  // Ricariche ricevute = acquisti (carta) o trasferimenti dal master. Quantità dal campo o dall'importo.
  const acquisti = (mov || []).filter(m => (m.tipo === 'acquisto' || m.tipo === 'trasferimento') && Number(m.importo) > 0).map(m => ({
    quantita: Number(m.quantita_sms) || Math.round(Number(m.importo) / COSTO_SMS_EUR) || 0, quando: m.created_at,
  }))

  const imp = (cli?.impostazioni as any) || {}
  const auto = imp.sms_auto || { attiva: false, soglia: 100, pacchetto: 1000 }
  const credito = Number(cli?.credito_sms || 0)

  return NextResponse.json({
    creditoSms: credito,
    costoSms: COSTO_SMS_EUR,
    smsDisponibili: Math.floor(credito / COSTO_SMS_EUR),
    gatewayPronto: smsConfigurato(),
    cartaSalvata: !!cli?.stripe_customer_id,
    auto: { attiva: !!auto.attiva, soglia: Number(auto.soglia) || 100, pacchetto: Number(auto.pacchetto) || 1000 },
    inviati, acquisti,
  })
}
