import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id,master_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  const masterId = utente?.master_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const body = await req.json()
  const ids: string[] = body.spedizioniIds || []
  const corriereId: string = body.corriereId
  if (!ids.length) return NextResponse.json({ error: 'Nessuna spedizione selezionata' }, { status: 400 })
  if (!corriereId) return NextResponse.json({ error: 'Contratto mancante' }, { status: 400 })
  // rileggo le spedizioni per sicurezza: devono essere del cliente, senza distinta, stesso corriere
  const { data: speds } = await supabase
    .from('spedizioni')
    .select('id,colli,peso_fatturato,peso_reale,corriere_id,distinta_id')
    .eq('cliente_id', clienteId)
    .in('id', ids)
  const valide = (speds || []).filter(s => !s.distinta_id && s.corriere_id === corriereId)
  if (!valide.length) return NextResponse.json({ error: 'Nessuna spedizione valida' }, { status: 400 })
  const totaleColli = valide.reduce((a, s) => a + (Number(s.colli) || 0), 0)
  const totalePeso = valide.reduce((a, s) => a + (Number(s.peso_fatturato || s.peso_reale) || 0), 0)
  const numero = 'DIST-' + Date.now().toString().slice(-8)
  const oggi = new Date().toISOString().slice(0, 10)
  const { data: distinta, error: errIns } = await supabase
    .from('distinte')
    .insert({ master_id: masterId, cliente_id: clienteId, corriere_id: corriereId, numero, data: oggi, stato: 'chiusa', totale_colli: totaleColli, totale_peso: totalePeso })
    .select('id,numero')
    .single()
  if (errIns || !distinta) return NextResponse.json({ error: 'Errore creazione distinta' }, { status: 500 })
  const validIds = valide.map(s => s.id)
  const { error: errUpd } = await supabase.from('spedizioni').update({ distinta_id: distinta.id }).in('id', validIds)
  if (errUpd) return NextResponse.json({ error: 'Errore aggancio spedizioni' }, { status: 500 })
  return NextResponse.json({ ok: true, distintaId: distinta.id, numero: distinta.numero, totali: { colli: totaleColli, peso: totalePeso, spedizioni: validIds.length } })
}