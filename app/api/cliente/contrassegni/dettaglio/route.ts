import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const { data: cliente } = await supabase.from('clienti').select('ragione_sociale').eq('id', clienteId).single()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { data: distinta } = await supabase
    .from('distinte_contrassegni').select('id,numero,created_at,data_pagamento,totale_iniziale,totale_rimborsato,cliente_id')
    .eq('id', id).eq('cliente_id', clienteId).single()
  if (!distinta) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  const { data: righe } = await supabase
    .from('distinte_contrassegni_righe')
    .select('numero_spedizione,importo_cod,importo_sistema,spedizione_id')
    .eq('distinta_id', id)
  // arricchisco con dati spedizione (destinatario, data)
  const spedIds = (righe || []).map((r: any) => r.spedizione_id).filter(Boolean)
  let mappaSped: Record<string, any> = {}
  if (spedIds.length) {
    const { data: speds } = await supabase.from('spedizioni')
      .select('id,dest_nome,dest_citta,created_at,rif_destinatario').in('id', spedIds)
    for (const s of speds || []) mappaSped[s.id] = s
  }
  const dettaglio = (righe || []).map((r: any) => {
    const s = mappaSped[r.spedizione_id] || {}
    return {
      numeroSpedizione: r.numero_spedizione, destinatario: s.dest_nome || '', citta: s.dest_citta || '',
      dataSpedizione: s.created_at || null, contrIniziale: Number(r.importo_cod || 0), contrRimborsato: Number(r.importo_sistema || 0),
    }
  })
  return NextResponse.json({ distinta, clienteNome: cliente?.ragione_sociale || '', righe: dettaglio })
}