import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { annullaSpedizioneSulCorriere, rimborsaAnnulloSpedizione, trovaOwnerContratto } from '@/lib/annullaSpedizione'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (orario): prende le spedizioni in 'annullamento_pending' da più di 48h e invia
// l'annullo al corriere. Se il corriere accetta (o la considera già inesistente) → 'annullata'
// + storno credito. Se rifiuta (già spedita/chiusa) → torna allo stato precedente con la nota
// d'errore, così resta tracciabile e non sparisce.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // Mi baso sulla RICHIESTA di annullo (annullamento_richiesto_at), non solo sullo stato:
  // così processo anche quelle il cui stato è stato riportato indietro da altri processi.
  // Il ripristino (undo) azzera annullamento_richiesto_at, quindi le ripristinate sono escluse.
  const { data: pendenti } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,corriere_id,raw_response,tracking_number,stato_precedente,annullamento_da,stato')
    .not('annullamento_richiesto_at', 'is', null)
    .lte('annullamento_richiesto_at', soglia)
    // 'consegnata' esclusa: fra la richiesta e le 48 ore il pacco puo' essere arrivato davvero, e
    // qui non si guarda lo stato ma la richiesta — quindi senza questo filtro il cron rimborsava
    // cliente e catena per merce consegnata. Sul circuito interno succede in poche ore.
    // 'storno_richiesto' esclusa: ha gia' lo storno aperto al corriere (DVA) e la chiude il cron
    // dedicato storno-dva-cron quando DVA conferma. Qui finirebbe nel ramo manuale a vuoto.
    .not('stato', 'in', '(annullata,annullamento_manuale,consegnata,storno_richiesto)')
    .order('annullamento_richiesto_at', { ascending: true })
    .limit(200)

  // Le richieste su pacchi ormai consegnati si chiudono: senza azzerare la richiesta resterebbero
  // a girare a ogni passaggio del cron, ed e' anche il modo di far vedere che sono decadute.
  const { data: consegnateInAttesa } = await admin.from('spedizioni')
    .select('id,numero').not('annullamento_richiesto_at', 'is', null)
    .lte('annullamento_richiesto_at', soglia).eq('stato', 'consegnata').limit(200)
  for (const s of (consegnateInAttesa || [])) {
    await admin.from('spedizioni').update({
      annullamento_richiesto_at: null,
      annullamento_errore: 'Consegnata prima dello scadere delle 48 ore: annullo decaduto.',
    }).eq('id', s.id)
    console.warn('[ANNULLI][CRON] richiesta decaduta, spedizione consegnata:', s.numero)
  }

  let annullate = 0, rifiutate = 0, manuali = 0, errori = 0
  for (const s of (pendenti || [])) {
    try {
      // Il corriere della spedizione: Spedisci non è annullabile via API (contratto non nostro)
      const { data: corr } = await admin.from('corrieri').select('tipo,nome_contratto,master_id').eq('id', (s as any).corriere_id).maybeSingle()
      // SPEDISCI: nessun annullo via API (contratto non nostro) → coda manuale al DETENTORE.
      if (corr?.tipo === 'spedisci') {
        const ownerId = await trovaOwnerContratto(admin, corr.master_id, corr.nome_contratto)
        await admin.from('spedizioni').update({
          stato: 'annullamento_manuale', annullamento_owner_id: ownerId, annullamento_errore: null,
        }).eq('id', s.id)
        manuali++
        continue
      }
      // DVA/easyparcel: ora c'e' la richiesta di storno (asincrona). Questo ramo copre solo le
      // richieste entrate PRIMA di questa modifica (quelle nuove partono gia' da elimina): chiedo
      // lo storno a DVA. Ammesso → 'storno_richiesto' (lo chiude il cron storno-dva-cron); gia'
      // cancellato → annullata + rimborso; non stornabile → coda al DETENTORE col motivo.
      if (corr?.tipo === 'easyparcel') {
        const { richiediStornoDva } = await import('@/lib/storno-dva')
        let r
        try { r = await richiediStornoDva(admin, s as any, (s as any).annullamento_da || null) }
        catch { r = { azione: 'manuale' as const, codice: 'errore', messaggio: '' } }
        if (r.azione === 'gia_cancellato') {
          try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, [s.id]) } catch {}
          annullate++
        } else if (r.azione === 'richiesto') {
          // storno aperto a DVA: in verifica, la chiude storno-dva-cron. Non la conto fra le chiuse.
        } else {
          const ownerId = await trovaOwnerContratto(admin, corr.master_id, corr.nome_contratto)
          await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_owner_id: ownerId }).eq('id', s.id)
          manuali++
        }
        continue
      }

      // CONTRATTO CONDIVISO: annullo sul portale di TUTTE le gambe, con storno (lib/annullo-condivise.ts).
      // Prima finiva qui sotto: il ponte rispondeva "va gestito dall'assistenza" e la spedizione tornava
      // attiva, addebitata. Se il pacco e' gia' preso in carico, resta il comportamento di prima.
      if (corr?.tipo === 'moovexpress') {
        const { annullaCondivisaDopo48h } = await import('@/lib/annullo-condivise')
        const r = await annullaCondivisaDopo48h(admin, s as any)
        if (r.esito === 'annullata') {
          try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, [s.id]) } catch {}
          annullate++
        } else {
          await admin.from('spedizioni').update({
            stato: (s as any).stato_precedente || 'in_lavorazione',
            annullamento_richiesto_at: null,
            annullamento_errore: `Annullo non eseguito: ${r.motivo}`,
          }).eq('id', s.id)
          rifiutate++
        }
        continue
      }

      const esito = await annullaSpedizioneSulCorriere(admin, s as any)
      if (esito.ok) {
        await admin.from('spedizioni').update({ stato: 'annullata', annullamento_errore: null }).eq('id', s.id)
        // Lo store non deve restare con l'ordine "Fulfilled" e un tracking morto (vedi lib/shopify).
        try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, [s.id]) } catch {}
        await rimborsaAnnulloSpedizione(admin, s as any, (s as any).annullamento_da || null)
        annullate++
      } else {
        // Il corriere rifiuta: torno allo stato precedente con la nota d'errore (non resta appesa in
        // pending). Il caso piu' comune e' il limite dei 15 giorni di Poste: lo scrivo in italiano chiaro.
        const reason = esito.reason || 'spedizione già spedita o chiusa in distinta'
        const nota = /15\s*(days|giorni)/i.test(reason)
          ? 'Non annullabile: sono passati più di 15 giorni dalla creazione — il corriere non consente più l\'annullo.'
          : `Annullo rifiutato dal corriere: ${reason}`
        await admin.from('spedizioni').update({
          stato: (s as any).stato_precedente || 'in_lavorazione',
          annullamento_richiesto_at: null,
          annullamento_errore: nota,
        }).eq('id', s.id)
        rifiutate++
      }
    } catch (e) {
      console.error('Errore cron annullamento spedizione', s.id, e)
      errori++
    }
  }

  return NextResponse.json({ ok: true, esaminate: pendenti?.length || 0, annullate, rifiutate, manuali, errori })
}
