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
  const perCorr = new Map<string, any>()
  for (const f of (fasce || [])) {
    const cid = (f as any).corriere_id
    if (!cid) continue
    if (!perCorr.has(cid)) {
      perCorr.set(cid, {
        nome_contratto: (f as any).corrieri?.nome_contratto || 'Corriere',
        fattore: fattorePerCorr.get(cid) || defFattore,
        righe: [] as any[],
      })
    }
    perCorr.get(cid).righe.push({
      zona: (f as any).zone?.nome || '—',
      peso_max: (f as any).peso_max,
      prezzo: (f as any).prezzo,
      tipo: (f as any).tipo,
      fuel: Number((f as any).fuel) || 0,
    })
  }
  const corrieri = Array.from(perCorr.values()).sort((a, b) => a.nome_contratto.localeCompare(b.nome_contratto))
  return NextResponse.json({
    assegnato: true,
    nome: (listino as any)?.nome || 'Listino',
    solo_peso_reale: !!(listino as any)?.solo_peso_reale,
    corrieri,
  })
}
