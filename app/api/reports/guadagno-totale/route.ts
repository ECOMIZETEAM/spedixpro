import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// REPORT GUADAGNO TOTALE — "il calderone": TUTTO il guadagno del master in un periodo, UNA cifra.
//
// = Spedizioni (margine, per DATA CREAZIONE: stessa base della card Guadagno Spedizioni e del Report
//   Spedizioni — guadagno_spedizioni_serie_v1)
// + Rettifiche + Rimborsi + Resi + Giacenze + Commissioni + Accessori + Logistica (margine a catena,
//   PER TIPO, in UNA sola chiamata guadagno_master_serie_v1 — chain-aware e dedup dei self dei sub)
// + Canone abbonamento (NON nei movimenti: da abbonamenti_pagamenti = incassato come ROOT − pagato come
//   master; per i rivenditori e' 0, lo incassa l'apex piattaforma).
//
// NON si sommano le "card" a schermo una per una: la card "Supplementi" somma per DESCRIZIONE
// (giacenz/riconsegn/supplement) e ridonda su giacenze+rettifiche (doppio conteggio) — qui si conta PER
// TIPO, una volta sola. ESCLUSI i pass-through (non sono profitto): 'ricarica' (deposito credito) e
// 'contrassegno' (cassa COD incassata per conto del cliente, senza spedizione_id).
//
// Prova di non-sovrapposizione (MULTIEXPRESS set. 2026): la chiamata unica sugli 8 tipi = somma delle 8
// voci per-tipo, al centesimo; totale operativo 60.263,76 (spedizioni 39.215,38 + altri 21.048,38),
// canone 0. Verificato sui dati veri prima del rilascio.
const TIPI_OPERATIVI = ['rettifica', 'rimborso', 'reso', 'giacenza', 'commissione', 'accessorio', 'logistica']

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
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || ['cliente', 'agente'].includes((utente?.ruolo || '').toLowerCase())) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dalParam = req.nextUrl.searchParams.get('dal')
  const alParam = req.nextUrl.searchParams.get('al')
  const dal = dalParam ? new Date(dalParam + 'T00:00:00.000Z').toISOString() : dataDa(periodo)
  const alEnd = dalParam ? new Date((alParam || dalParam) + 'T23:59:59.999Z').toISOString() : new Date().toISOString()
  const perMese = (Date.parse(alEnd) - Date.parse(dal)) / 86400000 > 92
  const admin = createAdminSupabase()
  const r2 = (x: number) => Math.round(x * 100) / 100

  const [sped, altri, canoneInc, canonePag, consInc, consPag] = await Promise.all([
    // SPEDIZIONI col metodo esatto del Report Spedizioni (data creazione)
    admin.rpc('guadagno_spedizioni_serie_v1', { p_master: M, p_dal: dal, p_al: alEnd, p_per_mese: perMese }),
    // Le altre 7 voci operative, PER TIPO, in un colpo (chain-aware, niente doppi conteggi)
    admin.rpc('guadagno_master_serie_v1', { p_master: M, p_dal: dal, p_al: alEnd, p_per_mese: perMese, p_tipi: TIPI_OPERATIVI }),
    // Canone: incassato come ROOT (quello che il master incassa dai suoi, se e' lui a fatturare il canone)
    admin.from('abbonamenti_pagamenti').select('importo').eq('root_id', M).eq('pagato', true).gte('pagato_il', dal).lte('pagato_il', alEnd),
    // Canone: pagato come master (il proprio canone = costo)
    admin.from('abbonamenti_pagamenti').select('importo').eq('master_id', M).eq('pagato', true).gte('pagato_il', dal).lte('pagato_il', alEnd),
    // CONSUMABILI (tipo 'consumabile', senza spedizione_id): ricavo = quello che il master addebita
    admin.from('movimenti').select('importo').eq('tipo', 'consumabile').eq('master_id', M).gte('created_at', dal).lte('created_at', alEnd),
    // CONSUMABILI costo = quello che il parent addebita al master
    admin.from('movimenti').select('importo').eq('tipo', 'consumabile').eq('master_target_id', M).neq('master_id', M).gte('created_at', dal).lte('created_at', alEnd),
  ])
  if (sped.error) return NextResponse.json({ error: sped.error.message }, { status: 500 })
  if (altri.error) return NextResponse.json({ error: altri.error.message }, { status: 500 })

  let ricavi = 0, costi = 0
  for (const row of (sped.data || [])) { ricavi += Number((row as any).ricavi || 0); costi += Number((row as any).costi || 0) }
  for (const row of (altri.data || [])) { ricavi += Number((row as any).ricavi || 0); costi += Number((row as any).costi || 0) }
  const canoneIncassato = (canoneInc.data || []).reduce((s: number, x: any) => s + Number(x.importo || 0), 0)
  const canonePagato = (canonePag.data || []).reduce((s: number, x: any) => s + Number(x.importo || 0), 0)
  // Consumabili: importi negativi (addebiti) → il ricavo è -importo
  const consIncassato = (consInc.data || []).reduce((s: number, x: any) => s + (-(Number(x.importo || 0))), 0)
  const consPagato = (consPag.data || []).reduce((s: number, x: any) => s + (-(Number(x.importo || 0))), 0)
  ricavi += canoneIncassato + consIncassato
  costi += canonePagato + consPagato

  ricavi = r2(ricavi)
  costi = r2(costi)
  return NextResponse.json({ guadagno: r2(ricavi - costi), ricavi, costi, periodo })
}
