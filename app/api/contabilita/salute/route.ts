import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { chiSei } from '@/lib/contabilita-accesso'
import { saluteConto } from '@/lib/salute-conto'

// SALUTE DEL CONTO (lib/salute-conto): quanto ha il master, quanto deve dare e avere, quanto guadagna togliendo
// le spese e dove arriva se va avanti cosi'. Solo lettura. Gli stessi che vedono l'estratto conto: il titolare e
// i suoi admin, dove la contabilita' e' accesa (oggi Ecomize Solution).
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const c = await chiSei()
  if ('errore' in c) return c.errore
  try {
    return NextResponse.json(await saluteConto(createAdminSupabase(), c.masterId))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Non riesco a fare il conto' }, { status: 500 })
  }
}
