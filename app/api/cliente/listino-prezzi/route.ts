import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Listino PREZZI del cliente (quello che paga lui), in SOLA LETTURA.
// Stessa forma dell'API agente: corrieri con fasce (peso×zona) + supplementi per tab.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  if (!u?.cliente_id) return NextResponse.json({ error: 'Solo clienti' }, { status: 403 })
  const { data: cliente } = await supabase.from('clienti').select('listino_cliente_id').eq('id', u.cliente_id).single()
  const listinoId = cliente?.listino_cliente_id
  if (!listinoId) return NextResponse.json({ assegnato: false, corrieri: [] })

  const { data: listino } = await supabase.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale').eq('id', listinoId).maybeSingle()
  const { data: aggCorr } = await supabase.from('listini_clienti_corrieri').select('corriere_id,fattore_volume').eq('listino_id', listinoId)
  const fattorePerCorr = new Map<string, number>()
  for (const a of (aggCorr || [])) { const fv = parseFloat((a as any)?.fattore_volume); if ((a as any)?.corriere_id && fv > 0) fattorePerCorr.set((a as any).corriere_id, fv) }

  // Corrieri disattivati dal master per questo cliente → nascosti.
  const { data: abil } = await supabase.from('clienti_corrieri_abilitati').select('corriere_id,abilitato').eq('cliente_id', u.cliente_id)
  const disattivati = new Set((abil || []).filter((a: any) => a.abilitato === false).map((a: any) => a.corriere_id))

  const { data: fasce } = await supabase.from('listini_clienti_fasce')
    .select('corriere_id,peso_max,prezzo,tipo,fuel,zone(nome),corrieri(nome_contratto)')
    .eq('listino_id', listinoId).order('peso_max', { ascending: true })

  const defFattore = parseFloat((listino as any)?.fattore_volume) || 5000
  const perCorr = new Map<string, any>()
  for (const f of (fasce || [])) {
    const cid = (f as any).corriere_id
    if (!cid || disattivati.has(cid)) continue
    if (!perCorr.has(cid)) {
      perCorr.set(cid, {
        nome_contratto: (f as any).corrieri?.nome_contratto || 'Corriere',
        fattore: fattorePerCorr.get(cid) || defFattore,
        zoneSet: new Set<string>(),
        fasce: new Map<string, any>(),
      })
    }
    const e = perCorr.get(cid)
    const zonaNome = (f as any).zone?.nome || '—'
    e.zoneSet.add(zonaNome)
    const key = (f as any).tipo + '|' + (f as any).peso_max
    if (!e.fasce.has(key)) e.fasce.set(key, { peso_max: Number((f as any).peso_max), tipo: (f as any).tipo, fuel: Number((f as any).fuel) || 0, prezzi: {} as Record<string, number> })
    e.fasce.get(key).prezzi[zonaNome] = Number((f as any).prezzo)
  }

  const parse = (s: any) => { try { return JSON.parse(s) } catch { return null } }
  const { data: suppl } = await supabase.from('listini_clienti_supplementi')
    .select('corriere_id,tipo,nome,descrizione,valore,tipo_calcolo').eq('listino_id', listinoId)
  const supplPerCorr = new Map<string, any[]>()
  for (const s of (suppl || [])) {
    const cid = (s as any).corriere_id; if (!cid) continue
    const d = parse((s as any).descrizione)
    const row = {
      tipo: (s as any).tipo,
      nome: (s as any).nome ?? d?.nome ?? null,
      valore_max: d?.valore_max != null ? Number(d.valore_max) : null,
      prezzo: Number(d?.prezzo_fisso ?? d?.prezzo ?? (s as any).valore ?? 0),
      perc: Number(d?.perc ?? 0),
    }
    if (!supplPerCorr.has(cid)) supplPerCorr.set(cid, [])
    supplPerCorr.get(cid)!.push(row)
  }
  const ordScaglioni = (a: any, b: any) => {
    const va = a.valore_max, vb = b.valore_max
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return va - vb
  }

  const ordZona = (a: string, b: string) => (a === 'Italia' ? -1 : b === 'Italia' ? 1 : a.localeCompare(b))
  const corrieri = Array.from(perCorr.entries())
    .sort((a, b) => a[1].nome_contratto.localeCompare(b[1].nome_contratto))
    .map(([cid, c]) => {
      const sup = supplPerCorr.get(cid) || []
      const perTipo = (t: string) => sup.filter((r: any) => r.tipo === t)
      return {
        nome_contratto: c.nome_contratto,
        fattore: c.fattore,
        zone: Array.from(c.zoneSet).sort(ordZona as any),
        fasce: Array.from(c.fasce.values()).sort((a: any, b: any) => (a.tipo === 'oltre' ? 1 : 0) - (b.tipo === 'oltre' ? 1 : 0) || a.peso_max - b.peso_max),
        supplementi: {
          assicurazione: perTipo('assicurazione').sort(ordScaglioni),
          contrassegno: perTipo('contrassegno').sort(ordScaglioni),
          accessorio: perTipo('accessorio'),
          giacenza: [...perTipo('giacenza'), ...perTipo('giacenza_apertura')],
          ritiro: perTipo('ritiro'),
          sponda: perTipo('sponda'),
        },
      }
    })

  return NextResponse.json({
    assegnato: true,
    nome: (listino as any)?.nome || 'Listino',
    solo_peso_reale: !!(listino as any)?.solo_peso_reale,
    corrieri,
  })
}
