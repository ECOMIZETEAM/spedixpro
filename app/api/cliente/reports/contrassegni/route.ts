import { NextRequest, NextResponse } from 'next/server'
import { confineGiornoRoma } from '@/lib/date-roma'
import { sessioneCliente, intestazione, erroreReport } from '../comune'
import { righeContrassegniCliente } from './calcolo'

export async function GET(req: NextRequest) {
  const s = await sessioneCliente()
  if ('errore' in s) return s.errore
  const p = req.nextUrl.searchParams
  try {
    const { cliente, master } = await intestazione(s.supabase, s.clienteId, s.masterId)
    const righe = await righeContrassegniCliente(s.supabase, s.clienteId, {
      dal: confineGiornoRoma(p.get('dal'), 'dal'),
      al: confineGiornoRoma(p.get('al'), 'al'),
      statoSpedizione: p.get('statoSpedizione'),
      // Il filtro "Stato Contrassegni" della pagina c'era ma non veniva mai mandato.
      statoContrassegno: p.get('statoContrassegno'),
    })
    return NextResponse.json({ righe, master, cliente })
  } catch (e: any) {
    return erroreReport(e)
  }
}
