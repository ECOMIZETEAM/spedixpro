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

  // Metodo di incasso:
  //  - 'bonifico' (default): il master ha pagato con bonifico → RIMBORSO il credito che gli era stato
  //    scalato (l'addebito era solo una prenotazione, ora paga davvero fuori dal credito).
  //  - 'pagato': saldato SENZA rimborso (il pagamento è stato scalato dal suo credito e resta così).
  const body = await req.json().catch(() => ({}))
  const metodo = body?.metodo === 'pagato' ? 'pagato' : 'bonifico'

  const { data: pag } = await admin.from('abbonamenti_pagamenti').select('*').eq('id', id).single()
  if (!pag) return NextResponse.json({ error: 'Pagamento non trovato' }, { status: 404 })
  if (pag.root_id !== utente.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (pag.pagato) return NextResponse.json({ error: 'Già segnato come pagato' }, { status: 400 })

  const importo = Number(pag.importo || 0)
  let rimborsato = 0
  if (metodo === 'bonifico' && importo > 0) {
    await registraMovimentoMaster(admin, {
      masterOwnerId: pag.master_id, masterTargetId: pag.master_id,
      tipo: 'rimborso_abbonamento', descrizione: `Bonifico abbonamento ${pag.mese || ''} ricevuto`.trim(),
      importo: Math.abs(importo), createdBy: user.id,
    })
    rimborsato = importo
  }
  await admin.from('abbonamenti_pagamenti')
    .update({ pagato: true, pagato_il: new Date().toISOString(), metodo }).eq('id', id)

  return NextResponse.json({ success: true, metodo, rimborsato })
}
