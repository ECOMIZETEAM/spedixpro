import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { calcolaPrezzoListino, creaCalcolatoreCorriere } from '@/lib/pricing'

// Guadagno sulle rettifiche peso:
//   per ogni rettifica  guadagno = (extra addebitato al cliente) - (extra pagato al corriere)
//   extra cliente  = prezzo_listino_cliente(peso_corriere) - prezzo_listino_cliente(peso_originale)
//   extra corriere = prezzo_listino_corriere(peso_corriere) - prezzo_listino_corriere(peso_originale)
function dataDa(periodo: string): string {
  const d = new Date()
  if (periodo === 'giornaliero') d.setHours(0, 0, 0, 0)
  else if (periodo === 'settimanale') { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0) }
  else if (periodo === 'annuale') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }
  else { d.setDate(1); d.setHours(0, 0, 0, 0) }
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = utente?.master_id
  if (!M || ['cliente','agente'].includes((utente?.ruolo || '').toLowerCase())) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0 })

  const periodo = req.nextUrl.searchParams.get('periodo') || 'mensile'
  const dal = dataDa(periodo)
  const admin = createAdminSupabase()

  const { data: rett } = await admin.from('rettifiche')
    .select('spedizione_id,cliente_id,target_master_id,peso_reale,created_at')
    .eq('master_id', M).gte('created_at', dal)
  if (!rett || !rett.length) return NextResponse.json({ guadagno: 0, ricavi: 0, costi: 0, periodo })

  const spedIds = Array.from(new Set(rett.map((r: any) => r.spedizione_id).filter(Boolean)))
  const { data: speds } = await admin.from('spedizioni')
    .select('id,peso_reale,peso_volume,lunghezza,larghezza,altezza,dest_provincia,dest_cap,dest_paese,corriere_id')
    .in('id', spedIds)
  const spedById = new Map<string, any>()
  ;(speds || []).forEach((s: any) => spedById.set(s.id, s))

  const calcCorr = await creaCalcolatoreCorriere(admin, M)   // costo corriere in memoria
  const listinoCache = new Map<string, string | null>()
  async function listinoDi(r: any): Promise<string | null> {
    if (r.cliente_id) {
      const k = 'c:' + r.cliente_id
      if (!listinoCache.has(k)) { const { data: c } = await admin.from('clienti').select('listino_cliente_id').eq('id', r.cliente_id).maybeSingle(); listinoCache.set(k, c?.listino_cliente_id || null) }
      return listinoCache.get(k) || null
    }
    if (r.target_master_id) {
      const k = 'm:' + r.target_master_id
      if (!listinoCache.has(k)) { const { data: m } = await admin.from('masters').select('parent_listino_id').eq('id', r.target_master_id).maybeSingle(); listinoCache.set(k, m?.parent_listino_id || null) }
      return listinoCache.get(k) || null
    }
    return null
  }

  let ricavo = 0, costo = 0
  for (const r of rett) {
    const s = spedById.get(r.spedizione_id)
    if (!s) continue
    const pesoOrig = Number(s.peso_reale || 0) || 1
    const pesoCorr = Number(r.peso_reale || 0) || pesoOrig
    const listinoId = await listinoDi(r)
    const pkg = (w: number) => [{ weight: w, length: Number(s.lunghezza) || 0, width: Number(s.larghezza) || 0, height: Number(s.altezza) || 0 }]

    let cliOrig = 0, cliCorr = 0
    if (listinoId) {
      const base = { listinoId, provincia: s.dest_provincia || '', cap: s.dest_cap || '', paese: s.dest_paese || 'IT', corriereId: s.corriere_id }
      cliOrig = (await calcolaPrezzoListino(admin, { ...base, packages: pkg(pesoOrig) }))?.prezzo || 0
      cliCorr = (await calcolaPrezzoListino(admin, { ...base, packages: pkg(pesoCorr) }))?.prezzo || 0
    }
    const corrOrig = calcCorr({ ...s, peso_reale: pesoOrig })?.totale || 0
    const corrCorr = calcCorr({ ...s, peso_reale: pesoCorr })?.totale || 0

    ricavo += (cliCorr - cliOrig)     // extra addebitato al cliente
    costo += (corrCorr - corrOrig)    // extra pagato al corriere
  }

  const ricavi = Math.round(ricavo * 100) / 100
  const costi = Math.round(costo * 100) / 100
  const guadagno = Math.round((ricavi - costi) * 100) / 100
  return NextResponse.json({ guadagno, ricavi, costi, periodo })
}
