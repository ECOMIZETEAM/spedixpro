import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento } from '@/lib/movimenti'
import { rimborsaCatena } from '@/lib/cascata'

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  // Carico la spedizione (costo, cliente, numero, destinatario, stato, corriere, provincia, colli)
  const { data: sped } = await supabase.from('spedizioni')
    .select('id,master_id,cliente_id,numero,dest_nome,dest_provincia,dest_cap,dest_paese,costo_totale,costo_spedizione,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,stato')
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

  // Soft-delete: la spedizione diventa "annullata" (resta nel DB)
  const { error: updErr } = await supabase.from('spedizioni')
    .update({ stato: 'annullata' })
    .eq('id', spedizioneId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  // Rimborso credito al CLIENTE (+ costo_totale). Best-effort.
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

  // Rimborso a cascata ai MASTER della catena (speculare all'addebito in creazione).
  try {
    const { data: corriere } = await supabase.from('corrieri')
      .select('master_id,nome_contratto').eq('id', sped.corriere_id).single()
    if (corriere?.master_id) {
      // Ricostruisco i packages dalla spedizione per il calcolo prezzi intermedi
      let packages: any[] = []
      if (Array.isArray(sped.colli_dettaglio) && sped.colli_dettaglio.length) {
        packages = sped.colli_dettaglio.map((c: any) => ({
          weight: sped.peso_reale || 1, length: c.lunghezza, width: c.larghezza, height: c.altezza,
        }))
      } else {
        packages = [{ weight: sped.peso_reale || 1, length: sped.lunghezza, width: sped.larghezza, height: sped.altezza }]
      }
      await rimborsaCatena(supabase, {
        masterDirettoId: sped.master_id,
        corriereOwnerId: corriere.master_id,
        costoSpedizione: Number(sped.costo_spedizione || 0),
        provincia: sped.dest_provincia || '',
        cap: sped.dest_cap || '',
        paese: sped.dest_paese || 'IT',
        packages,
        corriereNome: corriere.nome_contratto,
        numero: sped.numero,
        destNome: sped.dest_nome || '',
        spedizioneId: sped.id,
        createdBy: user.id,
      })
    }
  } catch (e) {
    console.error('Errore rimborso cascata master su annullo:', e)
  }

  return NextResponse.json({ success: true })
}
