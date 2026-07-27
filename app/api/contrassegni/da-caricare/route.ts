import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// AREA DI SOSTA dei contrassegni ("da caricare").
// Ci finiscono i contrassegni sia dall'UPLOAD del file corriere sia dalle RIMESSE accettate dalla
// rete. Restano qui, gia' divisi per destinatario (cliente o sotto-master), finche' il master non
// verifica e decide A CHI caricarli: solo allora nascono le distinte.
//   GET  -> gruppi per destinatario, con numero spedizioni e totale
//   POST -> { destinatari: ['c:<clienteId>' | 'm:<masterId>'] } crea le distinte per quelli scelti

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ gruppi: [], totale: 0, spedizioni: 0 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ gruppi: [], totale: 0, spedizioni: 0 })
  const admin = createAdminSupabase()

  const righe = await fetchAll(() => admin.from('cod_da_caricare')
    .select('id,spedizione_id,importo,cliente_id,target_master_id,origine,created_at')
    .eq('master_id', utente.master_id).order('created_at', { ascending: true }))
  if (!righe.length) return NextResponse.json({ gruppi: [], totale: 0, spedizioni: 0 })

  // Nomi destinatari + numeri LDV (per il dettaglio a video)
  const cliIds = Array.from(new Set(righe.map((r: any) => r.cliente_id).filter(Boolean)))
  const mstIds = Array.from(new Set(righe.map((r: any) => r.target_master_id).filter(Boolean)))
  const spedIds = Array.from(new Set(righe.map((r: any) => r.spedizione_id).filter(Boolean)))
  const [{ data: cli }, { data: mst }] = await Promise.all([
    cliIds.length ? admin.from('clienti').select('id,ragione_sociale').in('id', cliIds) : Promise.resolve({ data: [] as any[] }),
    mstIds.length ? admin.from('masters').select('id,nome').in('id', mstIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeCli = new Map((cli || []).map((c: any) => [c.id, c.ragione_sociale]))
  const nomeMst = new Map((mst || []).map((m: any) => [m.id, m.nome]))
  const numeroSped = new Map<string, string>()
  for (let i = 0; i < spedIds.length; i += 300) {
    const { data: sp } = await admin.from('spedizioni').select('id,numero').in('id', spedIds.slice(i, i + 300))
    for (const s of (sp || [])) numeroSped.set((s as any).id, (s as any).numero)
  }

  const mappa = new Map<string, any>()
  for (const r of righe as any[]) {
    const chiave = r.cliente_id ? `c:${r.cliente_id}` : `m:${r.target_master_id}`
    if (!mappa.has(chiave)) {
      mappa.set(chiave, {
        chiave, tipo: r.cliente_id ? 'cliente' : 'sotto-master',
        nome: r.cliente_id ? (nomeCli.get(r.cliente_id) || '—') : (nomeMst.get(r.target_master_id) || '—'),
        spedizioni: 0, totale: 0, origini: new Set<string>(), ldv: [] as string[],
      })
    }
    const g = mappa.get(chiave)
    g.spedizioni++; g.totale += Number(r.importo) || 0
    g.origini.add(r.origine)
    if (g.ldv.length < 200) g.ldv.push(numeroSped.get(r.spedizione_id) || '')
  }
  const gruppi = Array.from(mappa.values())
    .map(g => ({ ...g, totale: Math.round(g.totale * 100) / 100, origini: Array.from(g.origini) }))
    .sort((a, b) => (a.tipo === b.tipo ? b.totale - a.totale : a.tipo === 'cliente' ? -1 : 1))

  return NextResponse.json({
    gruppi,
    totale: Math.round(gruppi.reduce((s, g) => s + g.totale, 0) * 100) / 100,
    spedizioni: righe.length,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const body = await req.json().catch(() => ({}))
  const destinatari: string[] = Array.isArray(body.destinatari) ? body.destinatari.filter(Boolean) : []
  if (!destinatari.length) return NextResponse.json({ error: 'Seleziona almeno un destinatario da caricare' }, { status: 400 })

  const admin = createAdminSupabase()
  const cliIds = destinatari.filter(d => d.startsWith('c:')).map(d => d.slice(2))
  const mstIds = destinatari.filter(d => d.startsWith('m:')).map(d => d.slice(2))

  // Righe in sosta per i destinatari scelti (solo le MIE)
  const righe: any[] = []
  if (cliIds.length) {
    const r = await fetchAll(() => admin.from('cod_da_caricare')
      .select('id,spedizione_id,importo,cliente_id,target_master_id')
      .eq('master_id', mio).in('cliente_id', cliIds).order('id', { ascending: true }))
    righe.push(...r)
  }
  if (mstIds.length) {
    const r = await fetchAll(() => admin.from('cod_da_caricare')
      .select('id,spedizione_id,importo,cliente_id,target_master_id')
      .eq('master_id', mio).in('target_master_id', mstIds).order('id', { ascending: true }))
    righe.push(...r)
  }
  if (!righe.length) return NextResponse.json({ error: 'Nessun contrassegno da caricare per i destinatari scelti' }, { status: 400 })

  // Numeri LDV + anti-duplicato: mai due volte nella distinta dello STESSO master
  const spedIds = Array.from(new Set(righe.map(r => r.spedizione_id)))
  const numeroSped = new Map<string, string>()
  for (let i = 0; i < spedIds.length; i += 300) {
    const { data: sp } = await admin.from('spedizioni').select('id,numero').in('id', spedIds.slice(i, i + 300))
    for (const s of (sp || [])) numeroSped.set((s as any).id, (s as any).numero)
  }
  const mieDist = await fetchAll(() => admin.from('distinte_contrassegni').select('id').eq('master_id', mio).order('id', { ascending: true }))
  const giaMie = new Set<string>()
  for (let i = 0; i < mieDist.length; i += 200) {
    const r = await fetchAll(() => admin.from('distinte_contrassegni_righe')
      .select('spedizione_id').in('distinta_id', mieDist.slice(i, i + 200).map((d: any) => d.id)).order('id', { ascending: true }))
    for (const x of r) if ((x as any).spedizione_id) giaMie.add((x as any).spedizione_id)
  }

  const perDest = new Map<string, any[]>()
  let giaCaricate = 0
  for (const r of righe) {
    if (giaMie.has(r.spedizione_id)) { giaCaricate++; continue }
    const k = r.cliente_id ? `c:${r.cliente_id}` : `m:${r.target_master_id}`
    if (!perDest.has(k)) perDest.set(k, [])
    perDest.get(k)!.push(r)
  }

  const { data: ultima } = await admin.from('distinte_contrassegni')
    .select('numero').eq('master_id', mio).order('numero', { ascending: false }).limit(1).maybeSingle()
  let numero = (ultima?.numero || 1000)
  let create = 0, totaleCaricato = 0

  for (const [k, rows] of perDest) {
    const totale = Math.round(rows.reduce((s, r) => s + (Number(r.importo) || 0), 0) * 100) / 100
    if (totale <= 0) continue
    numero++
    const versoCliente = k.startsWith('c:')
    const { data: dist } = await admin.from('distinte_contrassegni').insert({
      master_id: mio, numero,
      cliente_id: versoCliente ? k.slice(2) : null,
      target_master_id: versoCliente ? null : k.slice(2),
      totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
    }).select('id').single()
    if (!dist?.id) continue
    await admin.from('distinte_contrassegni_righe').insert(rows.map(r => ({
      distinta_id: dist.id, spedizione_id: r.spedizione_id,
      numero_spedizione: numeroSped.get(r.spedizione_id) || '',
      importo_cod: Number(r.importo) || 0, importo_sistema: Number(r.importo) || 0,
    })))
    // stato_contrassegno GLOBALE = stato verso il CLIENTE finale: si tocca solo per le distinte cliente.
    if (versoCliente) {
      await admin.from('spedizioni')
        .update({ stato_contrassegno: 'in_distinta', distinta_contrassegno_id: dist.id })
        .in('id', rows.map(r => r.spedizione_id)).neq('stato_contrassegno', 'pagato')
    }
    create++; totaleCaricato += totale
  }

  // Le righe caricate escono dall'area di sosta (comprese quelle saltate perche' gia' in distinta:
  // restare in sosta non avrebbe senso, sono gia' state gestite).
  const idsUsati = righe.map(r => r.id)
  for (let i = 0; i < idsUsati.length; i += 500) {
    await admin.from('cod_da_caricare').delete().in('id', idsUsati.slice(i, i + 500))
  }

  return NextResponse.json({
    success: true, distinteCreate: create,
    totaleCaricato: Math.round(totaleCaricato * 100) / 100,
    spedizioniCaricate: righe.length - giaCaricate, giaCaricate,
  })
}
