import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Guadagno supplementi (giacenze, riconsegne, ecc.): legge la lista movimenti
// (movimenti_clienti) filtrata per quei nomi. Importo positivo = incasso (addebito
// al cliente, es. svincolo giacenza), negativo = costo. Dedup per LDV: se compare
// piu' volte la stessa LDV non la riconto.
function dataDa(periodo: string): string {
  const d = new Date()
  if (periodo === 'giornaliero') d.setHours(0, 0, 0, 0)
  else if (periodo === 'settimanale') { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0) }
  else if (periodo === 'annuale') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }
  else { d.setDate(1); d.setHours(0, 0, 0, 0) }
  return d.toISOString()
}

function estraiLdv(desc: string): string {
  const s = desc || ''
  const m1 = s.match(/spedizione\s+([A-Za-z0-9\-\/]{5,})/i)
  if (m1) return m1[1].toUpperCase()
  const m2 = s.match(/\b([A-Za-z0-9\-\/]{8,})\b/)
  return m2 ? m2[1].toUpperCase() : ''
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || (utente?.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dal = dataDa(periodo)
  const admin = createAdminSupabase()

  const { data: mov } = await admin.from('movimenti_clienti')
    .select('descrizione,importo,totale,created_at')
    .eq('master_id', M).gte('created_at', dal)
    .or('descrizione.ilike.%giacenz%,descrizione.ilike.%riconsegn%,descrizione.ilike.%supplement%')

  const seen = new Set<string>()
  let ricavi = 0, costi = 0
  for (const r of (mov || [])) {
    const ldv = estraiLdv(r.descrizione || '')
    if (ldv) { if (seen.has(ldv)) continue; seen.add(ldv) }   // stessa LDV -> non la riconto
    const imp = Number(r.importo || 0)
    if (imp >= 0) ricavi += imp
    else costi += -imp
  }

  ricavi = Math.round(ricavi * 100) / 100
  costi = Math.round(costi * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
