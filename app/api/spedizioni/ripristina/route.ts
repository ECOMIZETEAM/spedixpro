import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'

// Ripristina (undo) una spedizione in 'annullamento_pending' entro le 48h: torna allo stato
// precedente e non verrà inviato nessun annullo al corriere. Stessi permessi della cancellazione.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  const spedizioneId = req.nextUrl.searchParams.get('id') || (await req.json().catch(() => ({}))).id
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,stato,stato_precedente')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // ── Permessi (identici alla cancellazione) ──
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  } else {
    let autorizzato = sped.master_id === utente?.master_id
    if (!autorizzato && utente?.master_id) {
      let cur: string | null = sped.master_id
      for (let i = 0; i < 20 && cur; i++) {
        const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        if (!m) break
        if (m.parent_master_id === utente.master_id) { autorizzato = true; break }
        cur = m.parent_master_id
      }
    }
    if (!autorizzato) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  if (sped.stato !== 'annullamento_pending') {
    return NextResponse.json({ error: 'La spedizione non è in attesa di annullo: non è ripristinabile.' }, { status: 400 })
  }

  const { error } = await admin.from('spedizioni').update({
    stato: sped.stato_precedente || 'in_lavorazione',
    stato_precedente: null,
    annullamento_richiesto_at: null,
    annullamento_da: null,
    annullamento_errore: null,
  }).eq('id', spedizioneId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, stato: sped.stato_precedente || 'in_lavorazione' })
}
