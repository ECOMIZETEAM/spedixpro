import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Storico contrassegni di un destinatario (per telefono), su TUTTA la rete: quante spedizioni COD ha
// ricevuto e quante sono finite male (reso al mittente / non consegnato / in giacenza = non ritira).
// Serve all'ALERT anti-destinatari-che-rifiutano nella creazione spedizione: AVVERTE, non blocca.
// Ritorna solo conteggi aggregati (nessun dato di altri clienti). Via RPC admin (SECURITY DEFINER).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ mostra: false })

  const tel = (req.nextUrl.searchParams.get('telefono') || '').trim()
  if (tel.replace(/[^0-9]/g, '').length < 9) return NextResponse.json({ mostra: false })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { data } = await admin.rpc('storico_cod_destinatario', { p_telefono: tel })
  const r: any = (Array.isArray(data) && data[0]) || {}
  const totCod = Number(r.tot_cod || 0)
  const resi = Number(r.resi || 0)
  const nonConsegnato = Number(r.non_consegnato || 0)
  const giacenza = Number(r.giacenza || 0)
  const rifiutati = resi + nonConsegnato
  // La spedizione IN CORSO potrebbe essere già a sistema (se il numero è dell'ultima creata): l'alert
  // ha senso se c'è almeno un COD PRECEDENTE andato male o fermo in giacenza.
  return NextResponse.json({
    mostra: rifiutati > 0 || giacenza > 0,
    totCod, resi, nonConsegnato, giacenza, rifiutati,
  })
}
