import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { confineGiornoRoma } from '@/lib/date-roma'
import { sessioneCliente, intestazione, erroreReport } from '../comune'
import { righeRettificheCliente } from './calcolo'

// MAI `costo_spedizione` ne' `rettifiche.costo_fornitore` in un report del cliente: sono quanto paga
// il MASTER, e la differenza col prezzo del cliente e' il guadagno del master. Una versione vecchia di
// questo report la mostrava: su una spedizione da 15,00 col costo master di 4,38 il cliente leggeva
// 10,62. I numeri vengono solo dai movimenti del cliente e dalla sua riga di rettifica (calcolo.ts).
export async function GET(req: NextRequest) {
  const s = await sessioneCliente()
  if ('errore' in s) return s.errore
  const p = req.nextUrl.searchParams
  try {
    const { cliente, master } = await intestazione(s.supabase, s.clienteId, s.masterId)
    const righe = await righeRettificheCliente(s.supabase, createAdminSupabase(), s.clienteId, {
      dal: confineGiornoRoma(p.get('dal'), 'dal'),
      al: confineGiornoRoma(p.get('al'), 'al'),
      vettore: p.get('vettore') || null,
    })
    return NextResponse.json({ righe, master, cliente })
  } catch (e: any) {
    return erroreReport(e)
  }
}
