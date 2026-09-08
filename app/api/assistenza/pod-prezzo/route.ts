import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { risolviPrezzoPod } from '@/lib/pod-prezzo'

// Anteprima del costo di una POD PRIMA di aprirla: il cliente digita la LDV e sa subito quanto paga.
// Il prezzo definitivo resta quello BLOCCATO al momento dell'apertura (tickets.pod_prezzo): questa e'
// solo l'anteprima. Il cliente vede solo le PROPRIE spedizioni.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!u?.cliente_id) return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })

  const ldv = (req.nextUrl.searchParams.get('ldv') || '').trim()
  if (ldv.length < 4 || ldv.length > 40) return NextResponse.json({ trovata: false })

  const admin = createAdminSupabase()
  // Solo una LDV univoca e del cliente: se ambigua o non sua, niente anteprima (nessun prezzo trapela).
  const { data: sps } = await admin.from('spedizioni')
    .select('id,cliente_id,master_id,corriere_id').ilike('numero', ldv).limit(2)
  if (!sps || sps.length !== 1 || (sps[0] as any).cliente_id !== u.cliente_id) {
    return NextResponse.json({ trovata: false })
  }
  const sp = sps[0] as any
  const prezzo = await risolviPrezzoPod(admin, {
    masterId: u.master_id,          // il master del cliente e' chi addebita
    clienteId: u.cliente_id,
    corriereId: sp.corriere_id,
  })
  return NextResponse.json({ trovata: true, prezzo })
}
