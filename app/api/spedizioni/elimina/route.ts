import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  // Carico la spedizione (mi servono costo, cliente, numero, destinatario, stato)
  const { data: sped } = await supabase.from('spedizioni')
    .select('id,master_id,cliente_id,numero,dest_nome,costo_totale,stato')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Controllo permessi in base al ruolo
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    const { data: cli } = await supabase.from('clienti').select('vieta_cancellazione').eq('id', sped.cliente_id).single()
    if (cli?.vieta_cancellazione === true) {
      return NextResponse.json({ error: 'Cancellazione spedizioni non consentita per questo cliente.' }, { status: 403 })
    }
  } else {
    if (sped.master_id !== utente?.master_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }

  // Se è già annullata, non rimborso di nuovo (idempotente)
  if (sped.stato === 'annullata') {
    return NextResponse.json({ success: true, already: true })
  }

  // Soft-delete: la spedizione diventa "annullata" (resta nel DB, non viene cancellata)
  const { error: updErr } = await supabase.from('spedizioni')
    .update({ stato: 'annullata' })
    .eq('id', spedizioneId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  // Rimborso credito al CLIENTE (+ costo_totale). Non deve far fallire l'annullo.
  const costoCliente = Number(sped.costo_totale || 0)
  if (costoCliente > 0 && sped.cliente_id) {
    try {
      await registraMovimento(supabase, {
        masterId: sped.master_id,
        clienteId: sped.cliente_id,
        tipo: 'rimborso',
        descrizione: `Rimborso ${sped.numero} - ${sped.dest_nome || ''}`.trim(),
        riferimento: sped.numero,
        importo: Math.abs(costoCliente),
        spedizioneId: sped.id,
        createdBy: user.id,
      })
    } catch (e) {
      console.error('Errore rimborso credito su annullo:', e)
    }
  }

  // NOTA STEP 4: qui andrà anche il rimborso al MASTER (+costo_spedizione),
  // quando il ledger dei master sarà attivo.

  return NextResponse.json({ success: true })
}
