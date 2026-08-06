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

  // ANCHE DALLA CODA DELL'ASSISTENZA, non solo dalle 48 ore.
  // Su certi contratti l'annullo non parte da solo: la spedizione resta in coda finche' qualcuno lo
  // chiede a mano al fornitore. Ma nel frattempo il pacco puo' essere partito davvero — e quando il
  // fornitore lo RIPESA, quella e' la prova che ha viaggiato: l'ha misurato lui. Da li' l'annullo
  // non ha piu' senso, e chi tiene il contratto deve poterla rimettere in piedi. Prima non si
  // poteva: restava in coda per sempre, e con lei la rettifica della ripesatura, che nessuno poteva
  // ne' confermare ne' togliere.
  if (sped.stato !== 'annullamento_pending' && sped.stato !== 'annullamento_manuale') {
    return NextResponse.json({ error: 'La spedizione non è in attesa di annullo: non è ripristinabile.' }, { status: 400 })
  }

  const { error } = await admin.from('spedizioni').update({
    stato: sped.stato_precedente || 'in_lavorazione',
    stato_precedente: null,
    annullamento_richiesto_at: null,
    annullamento_da: null,
    annullamento_errore: null,
    // Sparisce anche dalla coda di chi doveva chiederlo all'assistenza: se non si azzerasse,
    // resterebbe li' un promemoria per un annullo che non si fa piu'.
    annullamento_owner_id: null,
  }).eq('id', spedizioneId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, stato: sped.stato_precedente || 'in_lavorazione' })
}
