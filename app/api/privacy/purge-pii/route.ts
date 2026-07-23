import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// PURGE PII (requisito Amazon Data Protection Policy, dichiarato nel profilo SP-API):
// i dati personali degli acquirenti AMAZON vengono anonimizzati entro 31 giorni dalla spedizione.
// Perimetro: ordini_importati con order_id in formato Amazon (XXX-XXXXXXX-XXXXXXX) gia' spediti
// da oltre 31 giorni -> destinatario/indirizzo/telefono/email e raw azzerati; restano i dati non
// personali (SKU, importi, localita'/CAP aggregati) per statistiche e contabilita'.
// Nello stesso giro: pulizia del log di audit oltre i 13 mesi (retention dichiarata: 12+ mesi).

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()

  // Ordini Amazon spediti da oltre 31 giorni e non ancora anonimizzati
  const { data: righe } = await admin.from('ordini_importati')
    .select('id')
    .eq('stato', 'spedito')
    .neq('destinatario', '[dati rimossi]')
    .lt('created_at', soglia)
    .filter('order_id', 'match', '^\\d{3}-\\d{7}-\\d{7}$')
    .limit(1000)

  let anonimizzati = 0
  if (righe?.length) {
    const { error } = await admin.from('ordini_importati')
      .update({ destinatario: '[dati rimossi]', indirizzo: '[dati rimossi]', telefono: null, email_destinatario: null, raw: null })
      .in('id', righe.map((r: any) => r.id))
    if (!error) anonimizzati = righe.length
  }

  // Retention audit: 13 mesi
  const sogliaAudit = new Date(Date.now() - 396 * 24 * 3600 * 1000).toISOString()
  await admin.from('audit_accessi').delete().lt('created_at', sogliaAudit)

  console.log(`[PURGE-PII] ordini Amazon anonimizzati=${anonimizzati}`)
  return NextResponse.json({ ok: true, anonimizzati })
}
