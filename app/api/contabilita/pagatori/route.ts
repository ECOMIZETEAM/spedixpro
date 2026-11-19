import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'
import { eDiscendente } from '@/lib/rete-masters'
import { contabilitaAttiva, leggiPagatori, pulisciIban, pulisciNome, ricordaPagatore } from '@/lib/contabilita-banca'

export const dynamic = 'force-dynamic'

// CHI PAGA I BONIFICI di un cliente o di un sotto-master (lib/contabilita-banca): i nomi come compaiono
// sull'estratto conto, anche piu' d'uno (due conti), con l'IBAN quando lo si conosce. Li gestisce chi puo'
// ricaricare: master, admin, operatore. La tabella e' chiusa ad anon e authenticated, quindi il master
// si prende dalla sessione e il cliente deve essere suo.

type Contesto = { userId: string, masterId: string, targetTipo: 'cliente' | 'master', targetId: string }

async function contesto(target: string): Promise<Contesto | NextResponse> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!u?.master_id || u.cliente_id || !gestisceLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  // In prova solo per alcuni master: per gli altri la funzione non c'e', e la pagina non mostra niente.
  if (!contabilitaAttiva(u.master_id)) return NextResponse.json({ attiva: false })

  const admin = createAdminSupabase()
  // "m:<id>" e' un sotto-master, come in /api/movimenti/crea; dall'indirizzo i due punti arrivano come %3A.
  let t = target
  if (t.includes('%')) { try { t = decodeURIComponent(t) } catch {} }
  const sotto = t.startsWith('m:')
  const id = sotto ? t.slice(2) : t
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Cliente non valido' }, { status: 400 })
  if (sotto) {
    if (!(await eDiscendente(admin, id, u.master_id))) return NextResponse.json({ error: 'Sotto-master non trovato' }, { status: 404 })
  } else {
    const { data: cl } = await admin.from('clienti').select('id,master_id').eq('id', id).maybeSingle()
    if (!cl || (cl as any).master_id !== u.master_id) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })
  }
  return { userId: user.id, masterId: u.master_id, targetTipo: sotto ? 'master' : 'cliente', targetId: id }
}

export async function GET(req: NextRequest) {
  const c = await contesto(req.nextUrl.searchParams.get('target') || '')
  if (c instanceof NextResponse) return c
  try {
    return NextResponse.json({ attiva: true, pagatori: await leggiPagatori(createAdminSupabase(), c.masterId, c.targetTipo, c.targetId) })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const c = await contesto(String(body?.target || ''))
  if (c instanceof NextResponse) return c
  const nome = pulisciNome(body?.nome)
  if (!nome) return NextResponse.json({ error: 'Scrivi il nome come compare sul bonifico' }, { status: 400 })
  const ibanScritto = String(body?.iban || '').trim()
  const iban = ibanScritto ? pulisciIban(ibanScritto) : null
  if (ibanScritto && !iban) return NextResponse.json({ error: 'IBAN non valido' }, { status: 400 })
  try {
    const admin = createAdminSupabase()
    await ricordaPagatore(admin, { masterId: c.masterId, targetTipo: c.targetTipo, targetId: c.targetId, nome, iban, origine: 'manuale', createdBy: c.userId })
    return NextResponse.json({ ok: true, pagatori: await leggiPagatori(admin, c.masterId, c.targetTipo, c.targetId) })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const c = await contesto(req.nextUrl.searchParams.get('target') || '')
  if (c instanceof NextResponse) return c
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Nome non valido' }, { status: 400 })
  const admin = createAdminSupabase()
  // Il filtro su master e cliente e' il permesso: un nome di un altro non si trova, quindi non si cancella.
  const { data, error } = await admin.from('pagatori_bonifico').delete()
    .eq('id', id).eq('master_id', c.masterId).eq('target_tipo', c.targetTipo).eq('target_id', c.targetId).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data?.length) return NextResponse.json({ error: 'Nome non trovato' }, { status: 404 })
  return NextResponse.json({ ok: true, pagatori: await leggiPagatori(admin, c.masterId, c.targetTipo, c.targetId) })
}
