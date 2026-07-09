import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { spediamoproCancelShipment } from '@/lib/spediamopro'

// Il corriere considera la spedizione GIÀ eliminata/inesistente → possiamo cancellarla anche da Moove.
function giaEliminataSulCorriere(text: string, status?: number): boolean {
  if (status === 404) return true
  const t = (text || '').toLowerCase()
  return /non trovat|not found|inesistent|does not exist|gi[àa] ?(elimin|annull|cancell)|already ?(delet|cancel|removed)|no longer exists/.test(t)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  const spedizioneId = req.nextUrl.searchParams.get('id')
  if (!spedizioneId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  // Carico la spedizione (via admin: potrebbe essere di un sotto-master, non leggibile via RLS).
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,numero,dest_nome,dest_provincia,dest_cap,dest_paese,costo_totale,costo_spedizione,corriere_id,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,stato,raw_response,tracking_number')
    .eq('id', spedizioneId).single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // ── Permessi ──
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    const { data: cli } = await supabase.from('clienti').select('vieta_cancellazione').eq('id', sped.cliente_id).single()
    if (cli?.vieta_cancellazione === true) return NextResponse.json({ error: 'Cancellazione spedizioni non consentita per questo cliente.' }, { status: 403 })
  } else {
    // Master: consentito se la spedizione è sua OPPURE di un suo DISCENDENTE (catena).
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
    // Se cancello una MIA spedizione e il mio "vieta cancellazione" è ON → non posso nemmeno provarci.
    if (sped.master_id === utente?.master_id) {
      const { data: mio } = await admin.from('masters').select('vieta_cancellazione').eq('id', utente.master_id).maybeSingle()
      if (mio?.vieta_cancellazione === true) return NextResponse.json({ error: 'Cancellazione spedizioni non consentita per questo account.' }, { status: 403 })
    }
  }

  // Già annullata → idempotente
  if (sped.stato === 'annullata') return NextResponse.json({ success: true, already: true })

  // ── ANNULLA SUL CORRIERE PRIMA di eliminare da Moove. Se il corriere non la annulla
  //    (es. già affidata/spedita), NON si elimina da Moove → nessun orfano lato corriere. ──
  const { data: corr } = await admin.from('corrieri').select('tipo,credenziali,nome_contratto,master_id').eq('id', sped.corriere_id).maybeSingle()
  const ERR_BLOCCO = 'Il corriere non consente l\'annullo: la spedizione risulta già spedita o chiusa in distinta. Non è stata eliminata.'
  if (corr) {
    const cred: any = corr.credenziali || {}
    const raw: any = sped.raw_response || {}
    if (corr.tipo === 'spediamopro') {
      const spid = raw.id || raw?.shipmentId || raw?.data?.id || raw?.raw?.data?.id
      if (spid && cred.authcode) {
        const r = await spediamoproCancelShipment(cred.authcode, Number(spid))
        // Se il corriere dice "già eliminata/non trovata" procediamo lo stesso; altrimenti blocchiamo col motivo.
        if (!r.ok && !giaEliminataSulCorriere(r.error || '')) {
          return NextResponse.json({ error: `${ERR_BLOCCO}${r.error ? ' (' + r.error.slice(0, 160) + ')' : ''}` }, { status: 409 })
        }
      }
    } else if (corr.tipo === 'spedisci') {
      const shipId = raw.shipmentId || raw.id
      if ((shipId || sped.tracking_number) && cred.master_domain) {
        let status = 0, body = ''
        try {
          const del = await fetch(`https://${cred.master_domain}/api/v2/shipping/delete`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ increment_id: shipId, trackingNumber: sped.tracking_number }),
          })
          status = del.status
          body = await del.text().catch(() => '')
        } catch (e: any) { body = String(e?.message || e) }
        const ok = status >= 200 && status < 300
        if (!ok && !giaEliminataSulCorriere(body, status)) {
          let msg = ''
          try { msg = JSON.parse(body)?.error || '' } catch {}
          return NextResponse.json({ error: `${ERR_BLOCCO}${msg ? ' (' + String(msg).slice(0, 160) + ')' : ''}` }, { status: 409 })
        }
      }
    }
  }

  // Soft-delete: la spedizione diventa "annullata" (resta nel DB)
  const { error: updErr } = await admin.from('spedizioni').update({ stato: 'annullata' }).eq('id', spedizioneId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  // ── RIMBORSO CREDITO: storno gli ADDEBITI REALI di questa spedizione. ──
  // NON ricalcolo prezzo/cascata: per ogni movimento di addebito ('spedizione') legato a
  // questa spedizione creo un rimborso dello STESSO identico importo. Così torna esattamente
  // il credito speso, a OGNI livello (cliente + master della catena), a prescindere da come
  // sono cambiati listino/cascata dopo la creazione.
  try {
    // Idempotenza: se esistono già storni per questa spedizione, non li ricreo.
    const { data: giaRimborsati } = await admin.from('movimenti')
      .select('id').eq('spedizione_id', sped.id).eq('tipo', 'rimborso').limit(1)
    if (!giaRimborsati?.length) {
      const { data: addebiti } = await admin.from('movimenti')
        .select('cliente_id,master_id,master_target_id,importo')
        .eq('spedizione_id', sped.id).eq('tipo', 'spedizione')
      const desc = `Rimborso ${sped.numero} - ${sped.dest_nome || ''}`.trim()
      for (const a of (addebiti || [])) {
        const importo = Math.abs(Number(a.importo || 0))
        if (!(importo > 0)) continue
        try {
          if (a.cliente_id) {
            await registraMovimento(admin, {
              masterId: a.master_id, clienteId: a.cliente_id,
              tipo: 'rimborso', descrizione: desc, riferimento: sped.numero,
              importo, spedizioneId: sped.id, createdBy: user.id,
            })
          } else if (a.master_target_id) {
            await registraMovimentoMaster(admin, {
              masterOwnerId: a.master_id, masterTargetId: a.master_target_id,
              tipo: 'rimborso', descrizione: desc, riferimento: sped.numero,
              importo, spedizioneId: sped.id, createdBy: user.id,
            })
          }
        } catch (e) {
          console.error('Errore storno movimento su annullo:', e)
        }
      }
    }
  } catch (e) {
    console.error('Errore rimborso su annullo:', e)
  }

  return NextResponse.json({ success: true })
}
