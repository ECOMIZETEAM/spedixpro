import { NextRequest, NextResponse } from 'next/server'
import { confineGiornoRoma } from '@/lib/date-roma'
import { sessioneCliente, intestazione, erroreReport } from '../comune'
import { righeConsumabiliCliente } from './calcolo'

export async function GET(req: NextRequest) {
  const s = await sessioneCliente()
  if ('errore' in s) return s.errore
  const p = req.nextUrl.searchParams
  try {
    const { cliente, master } = await intestazione(s.supabase, s.clienteId, s.masterId)
    // Le spese del cliente stanno in 'movimenti'. Prima si leggeva 'movimenti_clienti', un registro
    // parallelo mai popolato: il report usciva sempre a zero anche con gli addebiti effettuati.
    const righe = await righeConsumabiliCliente(s.supabase, s.clienteId, {
      dal: confineGiornoRoma(p.get('dal'), 'dal'),
      al: confineGiornoRoma(p.get('al'), 'al'),
    })
    return NextResponse.json({ righe, master, cliente })
  } catch (e: any) {
    return erroreReport(e)
  }
}
