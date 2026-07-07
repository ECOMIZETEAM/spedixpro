import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Copia tutte le zone (con le relative regioni/CAP) da un corriere a un altro.
// body: { fromCorriereId, toCorriereId }
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const { fromCorriereId, toCorriereId } = await req.json()
  if (!fromCorriereId || !toCorriereId || fromCorriereId === toCorriereId) {
    return NextResponse.json({ error: 'Seleziona un corriere di destinazione diverso' }, { status: 400 })
  }

  // Zone di origine con le loro regioni
  const { data: zoneOrigine } = await supabase.from('zone')
    .select('id,nome,descrizione,con_fuel, zone_cap(paese,provincia,cap,citta)')
    .eq('master_id', masterId).eq('corriere_id', fromCorriereId)
  if (!zoneOrigine?.length) return NextResponse.json({ error: 'Il corriere di origine non ha zone da copiare' }, { status: 400 })

  // Nomi già presenti sul corriere di destinazione: evita i doppioni
  const { data: zoneDest } = await supabase.from('zone').select('nome').eq('master_id', masterId).eq('corriere_id', toCorriereId)
  const nomiEsistenti = new Set((zoneDest || []).map((z: any) => (z.nome || '').trim().toLowerCase()))

  let create = 0, saltate = 0
  for (const z of zoneOrigine) {
    if (nomiEsistenti.has((z.nome || '').trim().toLowerCase())) { saltate++; continue }
    const { data: nuova, error } = await supabase.from('zone').insert({
      master_id: masterId, corriere_id: toCorriereId, nome: z.nome, descrizione: z.descrizione, con_fuel: z.con_fuel || false,
    }).select('id').single()
    if (error || !nuova) continue
    const caps = (z as any).zone_cap || []
    if (caps.length) {
      await supabase.from('zone_cap').insert(caps.map((c: any) => ({ zona_id: nuova.id, paese: c.paese, provincia: c.provincia, cap: c.cap, citta: c.citta })))
    }
    create++
  }
  return NextResponse.json({ ok: true, create, saltate })
}
