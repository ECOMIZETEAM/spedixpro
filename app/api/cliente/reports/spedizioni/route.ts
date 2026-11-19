import { NextRequest, NextResponse } from 'next/server'
import { confineGiornoRoma } from '@/lib/date-roma'
import { sessioneCliente, intestazione, erroreReport } from '../comune'
import { spedizioniReportCliente } from './calcolo'

export async function GET(req: NextRequest) {
  const s = await sessioneCliente()
  if ('errore' in s) return s.errore
  const p = req.nextUrl.searchParams
  try {
    // L'aliquota IVA del PDF e' quella della scheda del cliente (vuota = 22): prima era 22 per tutti.
    const { aliquotaIva } = await intestazione(s.supabase, s.clienteId, s.masterId)
    const spedizioni = await spedizioniReportCliente(s.supabase, s.clienteId, {
      dal: confineGiornoRoma(p.get('dal'), 'dal'),
      al: confineGiornoRoma(p.get('al'), 'al'),
      stato: p.get('stato') || null,
      contrassegno: p.get('contrassegno') || null,
      provincia: p.get('provincia') || null,
      vettore: p.get('vettore') || null,
    })
    return NextResponse.json({ spedizioni, aliquotaIva })
  } catch (e: any) {
    return erroreReport(e)
  }
}
