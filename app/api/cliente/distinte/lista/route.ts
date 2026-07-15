import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const distinte = await fetchAll(() => supabase
    .from('distinte')
    .select('id,numero,data,stato,totale_colli,totale_peso,corriere_id,created_at,corrieri(nome_contratto,tipo)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false }))
  const result = []
  for (const d of distinte || []) {
    const { data: speds } = await supabase
      .from('spedizioni')
      .select('costo_totale,contrassegno,colli,peso_fatturato,peso_reale')
      .eq('distinta_id', d.id)
    const nSped = (speds || []).length
    const colli = (speds || []).reduce((a, s) => a + (Number(s.colli) || 0), 0)
    const contrassegni = (speds || []).reduce((a, s) => a + (Number(s.contrassegno) || 0), 0)
    const peso = (speds || []).reduce((a, s) => a + (Number(s.peso_fatturato || s.peso_reale) || 0), 0)
    const costo = (speds || []).reduce((a, s) => a + (Number(s.costo_totale) || 0), 0)
    result.push({
      id: d.id, numero: d.numero, data: d.data || d.created_at, stato: d.stato,
      vettore: (d.corrieri?.tipo) || (d.corrieri?.nome_contratto) || '', contratto: (d.corrieri?.nome_contratto) || '',
      spedizioni: nSped, colli: colli || d.totale_colli || 0, contrassegni, peso: peso || Number(d.totale_peso) || 0, costo,
    })
  }
  return NextResponse.json(result)
}