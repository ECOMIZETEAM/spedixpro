import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'
import { calcolaGuadagnoAgente } from '@/lib/guadagno-agente'
import { confineGiornoRoma, giornoRoma, inizioGiornoRomaISO } from '@/lib/date-roma'

// REPORT AGENTI del master: per ogni SUO agente, quanto ha guadagnato nel periodo (col metodo di
// compenso assegnato) → così il master sa quanto deve dargli. Solo master/admin/operatore (non
// l'agente stesso, non i clienti). Ogni master vede i PROPRI agenti (master_id = suo).
const LABEL_METODO: Record<string, string> = {
  listino: 'Listino personale', perc_netto: '% sul netto', perc_lordo: '% sul lordo', fisso: 'Fisso a spedizione',
}

// Le spedizioni di un agente pesano: un report di qualche settimana su un master grande non sta
// nella finestra breve.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const M = utente.master_id
  const admin = createAdminSupabase()

  // Giorni di Roma. Prima il giorno era quello di Greenwich, e il "dal" predefinito della pagina era
  // l'ultimo giorno del mese prima: le 894 spedizioni di spedizioni 2000 del 30/09 finivano nel report
  // agenti di ottobre. Senza date: dal primo del mese (di Roma) a adesso.
  const dalParam = req.nextUrl.searchParams.get('dal')
  const alParam = req.nextUrl.searchParams.get('al')
  const dal = confineGiornoRoma(dalParam, 'dal') || inizioGiornoRomaISO(giornoRoma().slice(0, 8) + '01')
  const alEnd = confineGiornoRoma(alParam || dalParam, 'al') || new Date().toISOString()

  // I MIEI agenti (eventualmente uno solo, se filtrato dal report).
  const agenteId = req.nextUrl.searchParams.get('agenteId')
  let q = admin.from('utenti')
    .select('id,nome,cognome,agente_metodo,agente_valore,listino_agente_id')
    .eq('master_id', M).eq('ruolo', 'agente')
  if (agenteId) q = q.eq('id', agenteId)
  const { data: agenti, error: errAgenti } = await q.order('cognome', { ascending: true })
  if (errAgenti) return NextResponse.json({ error: 'Agenti non letti: ' + errAgenti.message }, { status: 500 })

  const righe: any[] = []
  let totale = 0
  try {
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
  } catch (e: any) {
    console.error('[REPORT AGENTI]', e?.message || e)
    return NextResponse.json({ error: 'Calcolo non riuscito: ' + (e?.message || 'errore di lettura') }, { status: 500 })
  }
  righe.sort((a, b) => b.guadagno - a.guadagno)
  return NextResponse.json({ dal, al: alEnd, totale: Math.round(totale * 100) / 100, agenti: righe })
}
