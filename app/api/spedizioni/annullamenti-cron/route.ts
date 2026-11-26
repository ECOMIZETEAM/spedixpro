import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { annullaSpedizioneSulCorriere, rimborsaAnnulloSpedizione, masterDetentore } from '@/lib/annullaSpedizione'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// CRON (orario): prende le spedizioni in 'annullamento_pending' da più di 48h e invia
// l'annullo al corriere. Se il corriere accetta (o la considera già inesistente) → 'annullata'
// + storno credito. Se rifiuta (già spedita/chiusa) → torna allo stato precedente con la nota
// d'errore, così resta tracciabile e non sparisce.
// Una richiesta in attesa su un pacco Poste diretto: annullata subito, oppure rimessa com'era se il pacco
// e' gia' nelle mani del corriere (resta addebitata). null = non e' un pacco Poste.
async function chiudiRichiestaPoste(admin: any, s: any): Promise<'annullata' | 'rifiutata' | null> {
  const { annullaSubitoPoste } = await import('@/lib/annullo-poste')
  const r = await annullaSubitoPoste(admin, s.tracking_number, { da: s.annullamento_da || null, richiestoAt: s.annullamento_richiesto_at })
  if (r.esito === 'annullata') return 'annullata'
  if (r.esito === 'partito') {
    await admin.from('spedizioni').update({
      stato: s.stato_precedente || 'in_lavorazione',
      annullamento_richiesto_at: null,
      annullamento_errore: r.messaggio,
    }).eq('id', s.id)
    return 'rifiutata'
  }
  return null
}

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // Mi baso sulla RICHIESTA di annullo (annullamento_richiesto_at), non solo sullo stato:
  // così processo anche quelle il cui stato è stato riportato indietro da altri processi.
  // Il ripristino (undo) azzera annullamento_richiesto_at, quindi le ripristinate sono escluse.
  const { data: pendenti } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,corriere_id,raw_response,tracking_number,stato_precedente,annullamento_da,annullamento_richiesto_at,stato')
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

  // POSTE DIRETTO (SDA EXPRESS L, L2, CONSEGNA DIRETTA): NIENTE 48 ORE (Lorenzo, 25/11/2026). Le richieste
  // nuove le chiudono gia' il cestino e l'API; qui quelle rimaste in attesa da prima di qualunque eta'
  // (quelle oltre le 48 ore le prende il giro di sotto, con la stessa funzione).
  const { data: attesaRecente } = await admin.from('spedizioni')
    .select('id,numero,corriere_id,tracking_number,stato_precedente,annullamento_da,annullamento_richiesto_at')
    .eq('stato', 'annullamento_pending').not('annullamento_richiesto_at', 'is', null).gt('annullamento_richiesto_at', soglia)
    .order('annullamento_richiesto_at', { ascending: true }).limit(300)
  const tipoCorriere = new Map<string, string | null>()
  for (const s of (attesaRecente || [])) {
    try {
      if (!tipoCorriere.has(s.corriere_id)) {
        const { data: c } = await admin.from('corrieri').select('tipo').eq('id', s.corriere_id).maybeSingle()
        tipoCorriere.set(s.corriere_id, c?.tipo || null)
      }
      const t = tipoCorriere.get(s.corriere_id)
      if (t !== 'moovexpress' && t !== 'poste') continue
      const r = await chiudiRichiestaPoste(admin, s)
      if (r === 'annullata') annullate++
      else if (r === 'rifiutata') rifiutate++
    } catch (e) {
      console.error('Errore cron annullamento spedizione (Poste)', s.id, e)
      errori++
    }
  }

  for (const s of (pendenti || [])) {
    try {
      // Il corriere della spedizione: Spedisci non è annullabile via API (contratto non nostro)
      const { data: corr } = await admin.from('corrieri').select('id,tipo,nome_contratto,master_id,contratto_id').eq('id', (s as any).corriere_id).maybeSingle()
      // POSTE DIRETTO (SDA EXPRESS L, anche quando il cliente la compra da un ponte di condivisione):
      // POSTE non ha l'annullo via API, quindi si annulla sul portale tutto il pacco e lo si sorveglia
      // 30 giorni (vedi lib/annullo-poste). Prima qui il ponte rispondeva "va gestito dall'assistenza" e
      // la richiesta tornava indietro col cliente addebitato: non se ne chiudeva nessuna.
      if (corr?.tipo === 'moovexpress' || corr?.tipo === 'poste') {
        const r = await chiudiRichiestaPoste(admin, s)
        if (r === 'annullata') { annullate++; continue }
        if (r === 'rifiutata') { rifiutate++; continue }
      }
      // PACCO GLS CONDIVISO FRA RETI: le richieste nuove si chiudono subito (spedizioni/elimina, v1 DELETE);
      // qui arrivano solo quelle rimaste in attesa da prima, o da una porta che non lo sa ancora. Stessa
      // regola: DeleteSped e tutte le gambe stornate, oppure no se GLS l'ha gia' in distinta (lib/annullo-gls).
      if (corr?.tipo === 'moovexpress' || corr?.tipo === 'gls') {
        const { gambePaccoGls, annullaPaccoGls } = await import('@/lib/annullo-gls')
        const gambe = await gambePaccoGls(admin, (s as any).tracking_number)
        if (gambe) {
          const r = await annullaPaccoGls(admin, gambe, { da: (s as any).annullamento_da || null })
          if (r.ok) { annullate++; continue }
          await admin.from('spedizioni').update({
            stato: (s as any).stato_precedente || 'in_lavorazione',
            annullamento_richiesto_at: null,
            annullamento_errore: `Annullo rifiutato dal corriere: ${r.motivo}`,
          }).eq('id', s.id)
          rifiutate++
          continue
        }
      }
      // PACCO VENDUTO FRA RETI (riga-ponte), LDV VERA FUORI DA POSTE E GLS: la richiesta si gira alla riga del
      // detentore e si annulla col SUO corriere (lib/annullo-pacco). Prima qui annullaSpedizioneSulCorriere sul
      // ponte rispondeva sempre "va gestito dall'assistenza" e la richiesta tornava indietro, cliente addebitato.
      if (corr?.tipo === 'moovexpress') {
        const { paccoAlDetentore, annullaPaccoAlDetentore } = await import('@/lib/annullo-pacco')
        const pacco = await paccoAlDetentore(admin, s as any)
        if (pacco) {
          const r = await annullaPaccoAlDetentore(admin, pacco, { da: (s as any).annullamento_da || null, subito: true })
          if (r.esito === 'annullata') { annullate++; continue }
          if (r.esito === 'coda') { manuali++; continue }
          const motivo = r.esito === 'rifiutata' ? r.motivo : 'il corriere non ha risposto'
          await admin.from('spedizioni').update({
            stato: (s as any).stato_precedente || 'in_lavorazione',
            annullamento_richiesto_at: null,
            annullamento_errore: /^Non annullabile/.test(motivo) ? motivo : `Annullo rifiutato dal corriere: ${motivo}`,
          }).eq('id', s.id)
          rifiutate++
          continue
        }
      }
      // SPEDISCI: nessun annullo via API (contratto non nostro) → coda manuale al DETENTORE.
      // DIELLE uguale: l'annullo lo fa il fornitore su richiesta del detentore (lib/annullaSpedizione).
      if (corr?.tipo === 'spedisci' || corr?.tipo === 'dielle') {
        const ownerId = await masterDetentore(admin, corr)
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
          const ownerId = await masterDetentore(admin, corr)
          await admin.from('spedizioni').update({ stato: 'annullamento_manuale', annullamento_owner_id: ownerId }).eq('id', s.id)
          manuali++
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
