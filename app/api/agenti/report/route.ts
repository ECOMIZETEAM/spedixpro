import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'
import { calcolaGuadagnoAgente } from '@/lib/guadagno-agente'

// REPORT AGENTI del master: per ogni SUO agente, quanto ha guadagnato nel periodo (col metodo di
// compenso assegnato) → così il master sa quanto deve dargli. Solo master/admin/operatore (non
// l'agente stesso, non i clienti). Ogni master vede i PROPRI agenti (master_id = suo).
function inizioMese(): string {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString()
}
const LABEL_METODO: Record<string, string> = {
  listino: 'Listino personale', perc_netto: '% sul netto', perc_lordo: '% sul lordo', fisso: 'Fisso a spedizione',
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const M = utente.master_id
  const admin = createAdminSupabase()

  const dalParam = req.nextUrl.searchParams.get('dal')
  const alParam = req.nextUrl.searchParams.get('al')
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : inizioMese()
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()

  // I MIEI agenti (eventualmente uno solo, se filtrato dal report).
  const agenteId = req.nextUrl.searchParams.get('agenteId')
  let q = admin.from('utenti')
    .select('id,nome,cognome,agente_metodo,agente_valore,listino_agente_id')
    .eq('master_id', M).eq('ruolo', 'agente')
  if (agenteId) q = q.eq('id', agenteId)
  const { data: agenti } = await q.order('cognome', { ascending: true })

  const righe: any[] = []
  let totale = 0
  for (const a of (agenti || [])) {
    const esito = await calcolaGuadagnoAgente(admin, { master_id: M, ...(a as any) }, dal, alEnd)
    totale += esito.guadagno
    righe.push({
      id: (a as any).id,
      nome: [(a as any).nome, (a as any).cognome].filter(Boolean).join(' ').trim() || '—',
      metodo: esito.metodo, metodoLabel: LABEL_METODO[esito.metodo] || esito.metodo, valore: esito.valore,
      guadagno: esito.guadagno, numSpedizioni: esito.numSpedizioni, lordo: esito.lordo, base: esito.base,
      margineAgente: esito.margineAgente,   // prezzo cliente − costo del listino dell'agente (mai il netto del master)
      senzaListino: !!esito.senzaListino,
    })
  }
  righe.sort((a, b) => b.guadagno - a.guadagno)
  return NextResponse.json({ dal, al: alEnd, totale: Math.round(totale * 100) / 100, agenti: righe })
}
