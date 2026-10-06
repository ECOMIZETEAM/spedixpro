import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { calderoneCache } from '@/lib/cache-memoria'

// STATISTICHE — FATTURAZIONE: il RICAVO (quello che il master incassa dai clienti e dalla rete diretta),
// non il guadagno. Costruito sul CALDERONE (calderone_dettaglio_v2): ricavo per cliente/entità con lo
// stesso metodo verificato della pagina Report Guadagno (spedizioni per data creazione + voci operative
// + canone + consumabili). "Da fatturare" = ricavo dei clienti a fattura mensile (join per cliente_id →
// tipo_contratto, niente match per nome: regge gli omonimi).
const r2 = (x: number) => Math.round(x * 100) / 100
const n = (x: any) => Number(x || 0)
const LABEL_TIPO: Record<string, string> = { rete: 'Rete', proprie: 'Proprie', consumabili: 'Consumabili', canone: 'Canone' }

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const M = u?.master_id
  if (!M || ['cliente', 'agente'].includes((u?.ruolo || '').toLowerCase())) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const dalISO = req.nextUrl.searchParams.get('dal')
    ? new Date(req.nextUrl.searchParams.get('dal') + 'T00:00:00.000Z').toISOString()
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const alISO = req.nextUrl.searchParams.get('al')
    ? new Date(req.nextUrl.searchParams.get('al') + 'T23:59:59.999Z').toISOString()
    : new Date().toISOString()

  const admin = createAdminSupabase()
  let calData: any, cli: any
  try {
    [calData, cli] = await Promise.all([
      calderoneCache(admin, M, dalISO, alISO),
      admin.from('clienti').select('id,tipo_contratto').eq('master_id', M),
    ])
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }

  const tipoContratto = new Map<string, string>()
  for (const c of (cli?.data || [])) tipoContratto.set((c as any).id, (c as any).tipo_contratto || '')

  // CORREZIONE NODI-CODICE: il fatturato della VENDITA ingrosso (ponte->acquirente, o acquirente->sub su SDA)
  // e' azzerato dal calderone (gambe-ledger con master_target NULL) -> per un ponte il fatturato usciva ~0
  // (prima del fix annullo addirittura negativo). Si aggiunge l'adj ingrosso (lato ricavi) al totale e come
  // riga aggregata. Vuoto per i master non-codice. Resiliente.
  let fattIngrosso = 0
  try {
    const { data: adj } = await admin.rpc('guadagno_ingrosso_adj_v1', { p_master: M, p_dal: dalISO, p_al: alISO })
    const a: any = Array.isArray(adj) ? adj?.[0] : adj
    fattIngrosso = r2(n(a?.ricavi_adj))
  } catch { /* 0 */ }

  const perCliente = (calData?.perCliente || [])
  const righe = perCliente
    .map((c: any) => {
      const fattMensile = c.tipo === 'cliente' && tipoContratto.get(c.cliente_id) === 'fattura_mensile'
      const tipoLabel = c.tipo === 'cliente' ? (fattMensile ? 'Fattura mensile' : 'Credito prepagato') : (LABEL_TIPO[c.tipo] || '—')
      return { nome: c.nome, tipo: tipoLabel, fatturato: r2(n(c.ricavi)), _fattMensile: fattMensile }
    })
    .filter((r: any) => r.fatturato !== 0)
  if (fattIngrosso !== 0) righe.push({ nome: 'Fatturato ingrosso', tipo: 'Ingrosso', fatturato: fattIngrosso, _fattMensile: false })
  righe.sort((a: any, b: any) => b.fatturato - a.fatturato)

  const fatturatoTot = r2(n(calData?.totale?.ricavi) + fattIngrosso)
  const daFatturare = r2(righe.filter((r: any) => r._fattMensile).reduce((s: number, r: any) => s + r.fatturato, 0))

  return NextResponse.json({
    kpi: { fatturatoTot, daFatturare, clienti: righe.length },
    righe: righe.map(({ _fattMensile, ...r }: any) => r),
  })
}
