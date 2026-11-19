import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { leggiCostiGestione, puoGestireCosti, riepilogoCosti } from '@/lib/costi-gestione'
import { guadagnoOperativo } from '@/lib/guadagno-totale'

// REPORT GUADAGNO TOTALE — "il calderone": TUTTO il guadagno del master in un periodo, UNA cifra.
// Il conto sta in lib/guadagno-totale (lo usa anche la Salute del conto): qui solo periodo e costi di gestione.

function dataDa(periodo: string): string {
  const d = new Date()
  if (periodo === 'giornaliero') d.setHours(0, 0, 0, 0)
  else if (periodo === 'settimanale') { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0) }
  else if (periodo === 'annuale') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }
  else { d.setDate(1); d.setHours(0, 0, 0, 0) }  // mensile: dal 1° del mese
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || ['cliente', 'agente'].includes((utente?.ruolo || '').toLowerCase())) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')
  const alParam = req.nextUrl.searchParams.get('al')
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const admin = createAdminSupabase()
  const r2 = (x: number) => Math.round(x * 100) / 100

  let ricavi: number, costi: number, guadagno: number
  try { ({ ricavi, costi, guadagno } = await guadagnoOperativo(admin, M, dal, alEnd)) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }

  // COSTI DI GESTIONE (lib/costi-gestione): personale, affitto, mezzi... che il master segna a parte.
  // Il Guadagno Totale resta quello operativo e combacia ancora col Report Guadagno; sotto si aggiunge
  // l'utile netto. Solo al titolare e ai suoi admin (ci sono gli stipendi): l'operatore vede la card
  // come prima. Se la lettura non riesce la card resta quella di sempre, senza le due righe.
  if (puoGestireCosti(utente as any)) {
    try {
      const giornoDal = dal.slice(0, 10), giornoAl = alEnd.slice(0, 10)
      const voci = await leggiCostiGestione(admin, M, giornoDal, giornoAl)
      const costiGestione = riepilogoCosti(voci, giornoDal, giornoAl).totale
      return NextResponse.json({ guadagno, ricavi, costi, periodo, costiGestione, utileNetto: r2(guadagno - costiGestione) })
    } catch { /* senza costi di gestione */ }
  }
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
