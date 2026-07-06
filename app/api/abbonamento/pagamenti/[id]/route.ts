import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimentoMaster } from '@/lib/movimenti'

// Il ROOT (M1) segna "pagato" un abbonamento quando riceve il bonifico:
// rimborsa in automatico il credito al master che ha pagato + movimento in lista.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  // solo il ROOT può segnare i pagamenti come incassati
  const { data: me } = await admin.from('masters').select('parent_master_id').eq('id', utente.master_id).single()
  if (me?.parent_master_id) return NextResponse.json({ error: 'Solo il master principale può gestire gli incassi' }, { status: 403 })

  const { data: pag } = await admin.from('abbonamenti_pagamenti').select('*').eq('id', id).single()
  if (!pag) return NextResponse.json({ error: 'Pagamento non trovato' }, { status: 404 })
  if (pag.root_id !== utente.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (pag.pagato) return NextResponse.json({ error: 'Già segnato come pagato' }, { status: 400 })

  const importo = Number(pag.importo || 0)
  if (importo > 0) {
    await registraMovimentoMaster(admin, {
      masterOwnerId: pag.master_id, masterTargetId: pag.master_id,
      tipo: 'rimborso_abbonamento', descrizione: `Bonifico abbonamento ${pag.mese || ''} ricevuto`.trim(),
      importo: Math.abs(importo), createdBy: user.id,
    })
  }
  await admin.from('abbonamenti_pagamenti')
    .update({ pagato: true, pagato_il: new Date().toISOString() }).eq('id', id)

  return NextResponse.json({ success: true, rimborsato: importo })
}
