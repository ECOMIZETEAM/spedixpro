import { NextRequest, NextResponse } from 'next/server'
import { confineGiornoRoma } from '@/lib/date-roma'
import { sessioneCliente, intestazione, erroreReport } from '../comune'
import { spedizioniReportCliente } from './calcolo'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { ivaVendite } from '@/lib/iva-vendita'

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
    // Come il master gli ha venduto ogni spedizione, IVA inclusa o esclusa (regola nel database,
    // lib/iva-vendita). Si chiede col client di servizio perche' le scelte del master non sono
    // leggibili dal cliente; il cliente e il master vengono dalla sessione, mai da un parametro.
    const inclusa = await ivaVendite(createAdminSupabase(), s.masterId, spedizioni.map((r: any) => ({ t: 'cliente' as const, s: s.clienteId, p: r.id })))
    return NextResponse.json({ spedizioni: spedizioni.map((r: any, i: number) => ({ ...r, iva_inclusa: inclusa[i] })), aliquotaIva })
  } catch (e: any) {
    return erroreReport(e)
  }
}
