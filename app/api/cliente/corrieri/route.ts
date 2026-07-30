import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { data: cliente } = await supabase
    .from('clienti').select('listino_cliente_id').eq('id', utente.cliente_id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ corrieri: [] })

  // Niente campo `tipo`: e' il provider tecnico e non deve arrivare al cliente (nessuno lo usava).
  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('corrieri(id,nome_contratto,attivo,master_id)')
    .eq('listino_id', cliente.listino_cliente_id)

  // Contratti in pausa: qui non si controllava affatto, quindi un contratto sospeso restava
  // selezionabile dal cliente e la spedizione veniva poi rifiutata alla creazione. Vale anche la
  // pausa messa da un master SOPRA: la sospensione scende per tutta la catena.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const masterDelContratto = (fasce || []).map((f: any) => f.corrieri?.master_id).find(Boolean) || null
  const sospesiSopra = await contrattiSospesiSopra(masterDelContratto)

  // Corrieri disattivati dal master per questo cliente (default = attivo)
  const { data: abil } = await supabase.from('clienti_corrieri_abilitati')
    .select('corriere_id, abilitato').eq('cliente_id', utente.cliente_id)
  const disattivati = new Set((abil || []).filter((a: any) => a.abilitato === false).map((a: any) => a.corriere_id))

  // Corrieri distinti presenti nel listino, esclusi i disattivati
  const map = new Map<string, { id: string; nome: string }>()
  for (const f of fasce || []) {
    const c = (f as any).corrieri
    if (!c?.id || map.has(c.id) || disattivati.has(c.id)) continue
    if (c.attivo === false) continue                                    // in pausa dal proprio master
    if (sospesoDallaCatena(c.nome_contratto, sospesiSopra)) continue    // in pausa da un livello sopra
    map.set(c.id, { id: c.id, nome: c.nome_contratto || 'Corriere' })
  }

  return NextResponse.json({ corrieri: Array.from(map.values()) })
}
