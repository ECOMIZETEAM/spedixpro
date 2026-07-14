import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Listino assegnato all'AGENTE (il suo costo), in SOLA LETTURA.
// Ritorna nome + fasce/prezzi raggruppati per corriere e zona.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,listino_agente_id').eq('id', user.id).single()
  if ((u?.ruolo || '').toLowerCase() !== 'agente') return NextResponse.json({ error: 'Solo agenti' }, { status: 403 })
  const listinoId = (u as any)?.listino_agente_id
  if (!listinoId) return NextResponse.json({ assegnato: false, corrieri: [] })

  const { data: listino } = await supabase.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale').eq('id', listinoId).maybeSingle()
  const { data: aggCorr } = await supabase.from('listini_clienti_corrieri').select('corriere_id,fattore_volume').eq('listino_id', listinoId)
  const fattorePerCorr = new Map<string, number>()
  for (const a of (aggCorr || [])) { const fv = parseFloat((a as any)?.fattore_volume); if ((a as any)?.corriere_id && fv > 0) fattorePerCorr.set((a as any).corriere_id, fv) }

  const { data: fasce } = await supabase.from('listini_clienti_fasce')
    .select('corriere_id,peso_max,prezzo,tipo,fuel,zone(nome),corrieri(nome_contratto)')
    .eq('listino_id', listinoId).order('peso_max', { ascending: true })

  const defFattore = parseFloat((listino as any)?.fattore_volume) || 5000
  // Griglia come il listino corrieri del master: righe = fasce peso, colonne = zone.
  const perCorr = new Map<string, any>()
  for (const f of (fasce || [])) {
    const cid = (f as any).corriere_id
    if (!cid) continue
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
  const ordZona = (a: string, b: string) => (a === 'Italia' ? -1 : b === 'Italia' ? 1 : a.localeCompare(b))
  const corrieri = Array.from(perCorr.values())
    .sort((a, b) => a.nome_contratto.localeCompare(b.nome_contratto))
    .map((c) => ({
      nome_contratto: c.nome_contratto,
      fattore: c.fattore,
      zone: Array.from(c.zoneSet).sort(ordZona as any),
      fasce: Array.from(c.fasce.values()).sort((a: any, b: any) => (a.tipo === 'oltre' ? 1 : 0) - (b.tipo === 'oltre' ? 1 : 0) || a.peso_max - b.peso_max),
    }))
  return NextResponse.json({
    assegnato: true,
    nome: (listino as any)?.nome || 'Listino',
    solo_peso_reale: !!(listino as any)?.solo_peso_reale,
    corrieri,
  })
}
