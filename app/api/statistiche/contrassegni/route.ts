import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { fetchAll } from '@/lib/fetch-all'

// STATISTICHE — CONTRASSEGNI & RISCHIO (sola lettura). Incasso e rimessa contrassegni sul sottoalbero.
const n = (x: any) => Number(x || 0)
const r2 = (x: number) => Math.round(x * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00Z').toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59Z').toISOString() : new Date().toISOString()

  const admin = createAdminSupabase()
  const sub = await sottoAlberoMasterIds(admin, M)
  const sp = await fetchAll(() => admin.from('spedizioni')
    .select('numero,contrassegno,stato,stato_contrassegno,created_at,cliente_id,clienti(ragione_sociale),corrieri(nome_contratto)')
    .in('master_id', sub.length ? sub : [M]).gt('contrassegno', 0).gte('created_at', dalISO).lte('created_at', alISO)
    .order('created_at', { ascending: true }))

  const now = Date.now()
  let totale = 0, rimesso = 0, inAttesa = 0, esposizione = 0
  const perCorr = new Map<string, number>()
  const perCli = new Map<string, { nome: string; num: number; totale: number; attesa: number }>()
  const aging = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 } as Record<string, number>
  const vecchi: any[] = []

  for (const s of (sp || [])) {
    const imp = n((s as any).contrassegno)
    const pagato = (s as any).stato_contrassegno === 'pagato'
    const consegnata = (s as any).stato === 'consegnata'
    totale += imp
    const corr = (s as any).corrieri?.nome_contratto || '—'
    perCorr.set(corr, (perCorr.get(corr) || 0) + imp)
    const cliN = (s as any).clienti?.ragione_sociale || '—'
    const pc = perCli.get(cliN) || { nome: cliN, num: 0, totale: 0, attesa: 0 }
    pc.num++; pc.totale += imp
    if (pagato) { rimesso += imp }
    else {
      inAttesa += imp; pc.attesa += imp
      if (consegnata) esposizione += imp   // incassato dal corriere ma non ancora rimesso = rischio
      const giorni = Math.floor((now - Date.parse((s as any).created_at)) / 86400000)
      if (giorni <= 7) aging['0-7'] += imp; else if (giorni <= 15) aging['8-15'] += imp; else if (giorni <= 30) aging['16-30'] += imp; else aging['30+'] += imp
      vecchi.push({ ldv: (s as any).numero, cliente: cliN, importo: r2(imp), giorni })
    }
    perCli.set(cliN, pc)
  }

  return NextResponse.json({
    kpi: { totale: r2(totale), rimesso: r2(rimesso), inAttesa: r2(inAttesa), esposizione: r2(esposizione) },
    perCorriere: Array.from(perCorr.entries()).map(([corriere, importo]) => ({ corriere, importo: r2(importo) })).sort((a, b) => b.importo - a.importo),
    aging: Object.entries(aging).map(([fascia, importo]) => ({ fascia, importo: r2(importo) })),
    perCliente: Array.from(perCli.values()).map(c => ({ ...c, totale: r2(c.totale), attesa: r2(c.attesa) })).sort((a, b) => b.totale - a.totale).slice(0, 20),
    vecchi: vecchi.sort((a, b) => b.giorni - a.giorni).slice(0, 20),
  })
}
