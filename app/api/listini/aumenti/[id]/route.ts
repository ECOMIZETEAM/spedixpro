import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { accessoAumenti, eUuid, listiniDaPropagare } from '@/lib/aumento-listini-accesso'

// Un aumento dello storico. GET: in quali listini e con quanti prezzi. POST: annulla.
// L'annullo lo fa il database (`annulla_aumento_listino`): rimette il prezzo esatto di prima solo dove c'e'
// ancora il prezzo lasciato dall'aumento, e si annulla dall'ultimo all'indietro sullo stesso contratto.

export const maxDuration = 300
export const dynamic = 'force-dynamic'

async function righeDellAumento(admin: any, aumentoId: string) {
  return fetchAll<any>(() => admin.from('aumenti_listino_righe').select('id,listino_id,prezzo_prima,prezzo_dopo').eq('aumento_id', aumentoId).order('id'))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acc = await accessoAumenti(); if (acc instanceof NextResponse) return acc
  const { id } = await params
  if (!eUuid(id)) return NextResponse.json({ error: 'Aumento non valido' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: aum } = await admin.from('aumenti_listino').select('id').eq('id', id).eq('master_id', acc.masterId).maybeSingle()
  if (!aum) return NextResponse.json({ error: 'Aumento non trovato' }, { status: 404 })

  const righe = await righeDellAumento(admin, id)
  const perListino = new Map<string, { fasce: number; prima: number; dopo: number }>()
  for (const r of righe) {
    const x = perListino.get(r.listino_id) || { fasce: 0, prima: 0, dopo: 0 }
    x.fasce++; x.prima += Number(r.prezzo_prima); x.dopo += Number(r.prezzo_dopo)
    perListino.set(r.listino_id, x)
  }
  const { data: nomi } = await admin.from('listini_clienti').select('id,nome').eq('master_id', acc.masterId)
  const nomeDi = new Map((nomi || []).map((l: any) => [l.id, (l.nome || '').trim()]))
  return NextResponse.json({
    listini: [...perListino.entries()]
      .map(([lid, x]) => ({ id: lid, nome: nomeDi.get(lid) || 'Listino eliminato', fasce: x.fasce }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acc = await accessoAumenti(); if (acc instanceof NextResponse) return acc
  const { id } = await params
  if (!eUuid(id)) return NextResponse.json({ error: 'Aumento non valido' }, { status: 400 })
  const body = await req.json().catch(() => ({} as any))
  if (body?.azione !== 'annulla') return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  const admin = createAdminSupabase()

  const { data, error } = await admin.rpc('annulla_aumento_listino', { p_aumento: id, p_master: acc.masterId, p_utente: acc.utenteId })
  if (error) {
    const stato = error.code === '42501' ? 404 : error.code === '22023' ? 409 : 500
    if (stato === 500) console.error('[AUMENTI] annulla', error)
    return NextResponse.json({ error: stato === 500 ? 'Annullo non riuscito: nessun prezzo è stato cambiato.' : error.message }, { status: stato })
  }

  const listini = [...new Set((await righeDellAumento(admin, id)).map((r: any) => r.listino_id as string))]
  const daPropagare = await listiniDaPropagare(admin, acc.masterId, listini)
  if (daPropagare.length) {
    after(async () => {
      const { propagaListinoModificato } = await import('@/lib/listino-modificato')
      for (const lid of daPropagare) await propagaListinoModificato(createAdminSupabase(), lid)
    })
  }
  return NextResponse.json({ ok: true, ...(data as any) })
}
