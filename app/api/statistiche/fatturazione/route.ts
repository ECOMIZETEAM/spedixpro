import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// STATISTICHE — FATTURAZIONE (sola lettura). Fatturato del master ai propri clienti/sotto-master
// diretti, con quota "da fatturare" (clienti a fattura mensile).
const TIPI = ['spedizione', 'rimborso', 'rettifica']
const n = (x: any) => Number(x || 0)
const r2 = (x: number) => Math.round(x * 100) / 100

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const dalISO = req.nextUrl.searchParams.get('dal') ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00Z').toISOString() : new Date(new Date().getFullYear(), 0, 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al') ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59Z').toISOString() : new Date().toISOString()

  const admin = createAdminSupabase()
  const { data: figli } = await admin.from('masters').select('id,nome').eq('parent_master_id', M)
  const subDiretti = new Map<string, string>((figli || []).map((f: any) => [f.id, f.nome]))
  const subIds = Array.from(subDiretti.keys())

  const movM = await fetchAll(() => admin.from('movimenti').select('cliente_id,importo,tipo,created_at').eq('master_id', M)
    .not('cliente_id', 'is', null).not('spedizione_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO).in('tipo', TIPI).order('created_at', { ascending: true }))
  let movSub: any[] = []
  if (subIds.length) movSub = await fetchAll(() => admin.from('movimenti').select('master_id,master_target_id,importo,created_at')
    .in('master_id', subIds).not('spedizione_id', 'is', null).gte('created_at', dalISO).lte('created_at', alISO).in('tipo', TIPI))

  const perMese = new Map<string, number>()
  const ricavoCli = new Map<string, number>()
  for (const m of movM) { const v = -n(m.importo); ricavoCli.set(m.cliente_id, (ricavoCli.get(m.cliente_id) || 0) + v); const k = m.created_at.slice(0, 7); perMese.set(k, (perMese.get(k) || 0) + v) }
  const ricavoSub = new Map<string, number>()
  for (const m of movSub) if (m.master_id === m.master_target_id) { const v = -n(m.importo); ricavoSub.set(m.master_id, (ricavoSub.get(m.master_id) || 0) + v); const k = m.created_at.slice(0, 7); perMese.set(k, (perMese.get(k) || 0) + v) }

  // Clienti (nome + tipo contratto per il "da fatturare")
  const cliIds = Array.from(ricavoCli.keys())
  const cliInfo = new Map<string, { nome: string; mensile: boolean }>()
  if (cliIds.length) { const { data: cs } = await admin.from('clienti').select('id,ragione_sociale,tipo_contratto').in('id', cliIds); for (const c of (cs || [])) cliInfo.set((c as any).id, { nome: (c as any).ragione_sociale, mensile: (c as any).tipo_contratto === 'fattura_mensile' }) }

  const righe = cliIds.map(cid => ({ nome: cliInfo.get(cid)?.nome || 'Cliente', fatturato: r2(ricavoCli.get(cid) || 0), tipo: cliInfo.get(cid)?.mensile ? 'Fattura mensile' : 'Credito' }))
  for (const [smid, v] of ricavoSub) righe.push({ nome: (subDiretti.get(smid) || 'Sotto-master') + ' (rete)', fatturato: r2(v), tipo: 'Rete' })
  righe.sort((a, b) => b.fatturato - a.fatturato)

  const fatturatoTot = r2(righe.reduce((a, r) => a + r.fatturato, 0))
  const daFatturare = r2(cliIds.filter(cid => cliInfo.get(cid)?.mensile).reduce((a, cid) => a + (ricavoCli.get(cid) || 0), 0))

  return NextResponse.json({
    kpi: { fatturatoTot, daFatturare, clienti: righe.length },
    serieMese: Array.from(perMese.entries()).sort().map(([mese, v]) => ({ mese, fatturato: r2(v) })),
    righe,
  })
}
