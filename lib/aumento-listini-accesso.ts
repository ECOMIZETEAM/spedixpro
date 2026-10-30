import { NextResponse } from 'next/server'
import { getPermessiUtente, haPermesso } from '@/lib/permessi'
import { gestisceLaRete } from '@/lib/ruoli'
import { createServerSupabase } from '@/lib/supabase'

// Chi puo' aumentare i listini: il master e l'admin, l'operatore se ha "modifica listini". Non l'agente
// (sola lettura), non il cliente ne' l'autista: gestisceLaRete li tiene fuori tutti.
// Le rotte scrivono con la chiave di servizio, che salta la RLS: il master si prende da qui, mai dalla
// richiesta, e le funzioni del database ricontrollano che contratto e listini siano suoi.
export async function accessoAumenti(): Promise<{ masterId: string; utenteId: string } | NextResponse> {
  const p = await getPermessiUtente()
  if (!p) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  if (!p.masterId || !gestisceLaRete(p) || !haPermesso(p, 'admin.pricelists.edit')) {
    return NextResponse.json({ error: 'Non autorizzato a modificare i listini' }, { status: 403 })
  }
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  return { masterId: p.masterId, utenteId: user.id }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const eUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** Listini che, cambiando prezzo, vanno riportati a chi li usa per comprare (sotto-master, master collegati). */
export async function listiniDaPropagare(admin: any, masterId: string, listini: string[]): Promise<string[]> {
  const scelti = new Set(listini)
  const out = new Set<string>()
  const { data: sub } = await admin.from('masters').select('parent_listino_id').not('parent_listino_id', 'is', null)
  for (const m of (sub || []) as any[]) if (scelti.has(m.parent_listino_id)) out.add(m.parent_listino_id)
  const { data: ledger } = await admin.from('clienti').select('listino_cliente_id').eq('master_id', masterId).eq('ledger', true)
  for (const c of (ledger || []) as any[]) if (scelti.has(c.listino_cliente_id)) out.add(c.listino_cliente_id)
  return [...out]
}

/** Riallinea sotto-master e collegati di questi listini, uno alla volta. Torna quanti listini ha riallineato. */
export async function riallinea(admin: any, masterId: string, listini: string[]): Promise<number> {
  const daPropagare = await listiniDaPropagare(admin, masterId, listini)
  const { propagaListinoModificato } = await import('@/lib/listino-modificato')
  for (const id of daPropagare) await propagaListinoModificato(admin, id)
  return daPropagare.length
}
