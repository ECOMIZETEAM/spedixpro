import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Cosa il MIO master ha ricevuto dai livelli superiori della catena.
// RLS: le righe appartengono al master PADRE -> lettura via admin, autorizzazione = target_master_id mio.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const adminDb = createAdminSupabase()

  const [rett, cod, movs] = await Promise.all([
    adminDb.from('rettifiche')
      .select('id,numero_spedizione,peso_iniziale,peso_reale,costo_iniziale,costo_finale,differenza,confermata,stato,propagazione,created_at,masters:master_id(nome)')
      .eq('target_master_id', mio)
      .order('created_at', { ascending: false }).limit(200),
    adminDb.from('distinte_contrassegni')
      .select('id,numero,totale_iniziale,totale_rimborsato,metodo_pagamento,stato,data_pagamento,accettata_target,created_at,masters:master_id(nome),distinte_contrassegni_righe(numero_spedizione,importo_cod)')
      .eq('target_master_id', mio)
      .order('created_at', { ascending: false }).limit(100),
    adminDb.from('movimenti')
      .select('id,tipo,descrizione,importo,saldo_dopo,created_at,spedizione_id')
      .eq('master_target_id', mio)
      .in('tipo', ['reso', 'rettifica'])
      .order('created_at', { ascending: false }).limit(200),
  ])

  return NextResponse.json({
    rettifiche: rett.data || [],
    contrassegni: cod.data || [],
    movimenti: movs.data || [],
  })
}
