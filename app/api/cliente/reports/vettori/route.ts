import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { marchioCorriere } from '@/lib/corriere-logo'
import { sessioneCliente, erroreReport } from '../comune'

export const dynamic = 'force-dynamic'

// Le voci del filtro "Vettore" dei report del cliente: i MARCHI pubblici dei contratti con cui ha
// spedito davvero. Il filtro dei report confronta lo stesso marchio che il file scrive nella colonna
// Corriere, quindi una voce scelta qui trova esattamente le righe con quel Corriere.
// Prima la tendina era scritta a mano (SDA, GLS, BRT, Poste, DHL) e il valore scelto non veniva
// nemmeno mandato: il report usciva sempre con tutti i corrieri.
// Chiave di servizio (la lettura dei contratti dipende dalle regole del master), ma solo sui
// contratti delle spedizioni di QUESTO cliente, e ne esce solo il marchio: mai il tipo, che e' il
// fornitore tecnico.
export async function GET() {
  const s = await sessioneCliente()
  if ('errore' in s) return s.errore
  try {
    const adminDb = createAdminSupabase()
    const { data, error } = await adminDb.from('corrieri')
      .select('nome_contratto, spedizioni!inner(id)')
      .eq('spedizioni.cliente_id', s.clienteId)
      .limit(1, { referencedTable: 'spedizioni' })
    if (error) throw new Error('lettura dei contratti non riuscita: ' + error.message)
    const marchi = Array.from(new Set((data || [])
      .map((c: any) => marchioCorriere(c.nome_contratto || ''))
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
    return NextResponse.json({ vettori: marchi })
  } catch (e: any) {
    return erroreReport(e)
  }
}
