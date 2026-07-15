import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const data = await fetchAll(() => supabase
    .from('distinte_contrassegni')
    .select('id,numero,stato,metodo_pagamento,data_pagamento,totale_iniziale,totale_rimborsato,created_at,distinte_contrassegni_righe(id)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false }))
  const result = (data || []).map((d: any) => ({
    id: d.id, numero: d.numero, dataCreazione: d.created_at, stato: d.stato,
    metodoPagamento: d.metodo_pagamento, dataPagamento: d.data_pagamento,
    totale: Number(d.totale_iniziale || 0), righe: (d.distinte_contrassegni_righe || []).length,
  }))
  return NextResponse.json(result)
}