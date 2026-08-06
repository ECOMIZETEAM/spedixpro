import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fattoreVolumeCorriere } from '@/lib/pricing'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { searchParams } = new URL(req.url)
  const listinoId = searchParams.get('listinoId')
  if (!listinoId) return NextResponse.json([])
  const { data } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', listinoId)
  return NextResponse.json((data||[]).map((r:any) => r.corrieri))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const body = await req.json()
  const { listinoId, corriereId } = body
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })
  // IL FATTORE VOLUMETRICO SI EREDITA DAL CONTRATTO, non si lascia decidere al database.
  //
  // Qui la riga veniva inserita SENZA fattore, e la colonna ha 5000 come valore predefinito: cosi'
  // un master che sul suo contratto paga su 4000 si ritrovava i clienti fatturati su 5000, cioe' su
  // un peso volumetrico piu' LEGGERO di quello che costa a lui. Non era il default che "entrava in
  // gioco" per mancanza d'altro: era un 5000 scritto nero su bianco nel listino del cliente, che
  // poi vince su tutto perche' l'override batte il default.
  //
  // Misurato in produzione il 7/08/2026: 68 clienti su cinque master in questa condizione, e in
  // OGNI caso il listino del cliente era nato DOPO che il master aveva gia' messo 4000 (GTS
  // EXPRESS: 4000 il 2 agosto, 58 listini cliente creati il 4 agosto, tutti a 5000).
  //
  // Il divisore non e' una costante nostra: e' una condizione del contratto. `fattoreVolumeCorriere`
  // la va a prendere dove sta davvero, risalendo la catena fino a chi il contratto ce l'ha — e il
  // 5000 resta solo come ultimissimo ripiego, se non l'ha mai impostato nessuno.
  const { data: lk } = await supabase.from('listini_clienti').select('master_id').eq('id', listinoId).maybeSingle()
  const fattore = lk?.master_id ? await fattoreVolumeCorriere(supabase, lk.master_id, corriereId) : null

  const { error } = await supabase.from('listini_clienti_corrieri').insert({
    listino_id: listinoId, corriere_id: corriereId,
    ...(fattore && fattore > 0 ? { fattore_volume: fattore } : {}),
  })
  if (error && !error.message.includes('duplicate')) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}