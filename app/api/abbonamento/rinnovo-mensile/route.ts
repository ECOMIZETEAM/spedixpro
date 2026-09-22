import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { meseCorrente } from '@/lib/piani'
import { cambioDaApplicare } from '@/lib/abbonamento-cambi'

// GIRO DEL PRIMO DEL MESE.
//
// Prima questo giro ADDEBITAVA il canone sul credito interno del master e accreditava l'incasso al
// master principale, lasciando due righe nei movimenti e un pagamento "da incassare" da rincorrere
// a mano col bonifico. Non lo fa piu': il canone si paga con carta, la fattura la emette il
// circuito, e nei movimenti — che sono il conto delle SPEDIZIONI — l'abbonamento non entra piu'.
//
// Restano tre compiti:
//  1. applicare i downgrade e le disdette chiesti il mese scorso (e' oggi che valgono);
//  2. segnare il mese agli esenti, che tengono il piano senza pagare.
//
// Chi ha un piano ma nessuna carta lo intercetta il controllo GIORNALIERO
// (/api/abbonamento/controllo-carta): una volta al mese non basterebbe — chi toglie la carta il 5
// resterebbe scoperto fino al primo del mese dopo.
//
// Chi paga regolarmente non viene toccato: al suo posto parla il circuito, che addebita la carta e
// ci manda la conferma (vedi /api/stripe/webhook).
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const mese = meseCorrente()

  const { data: attivi } = await admin.from('masters')
    .select('id,nome,abbonamento_piano,abbonamento_prezzo,abbonamento_mese,parent_master_id,abbonamento_esente,abbonamento_esente_fino_a,stripe_subscription_id,stripe_stato,abbonamento_piano_programmato,abbonamento_programmato_dal,pagamento_scaduto_dal')
    .not('abbonamento_piano', 'is', null)

  let cambiApplicati = 0, esentiSaltati = 0, senzaCarta = 0, conCarta = 0, esenzioniScadute = 0

  for (const m of (attivi || [])) {
    // 1) Downgrade e disdette programmati: e' adesso che entrano in vigore.
    const cambio = cambioDaApplicare(m)
    if (cambio) {
      await admin.from('masters').update(cambio).eq('id', m.id)
      Object.assign(m as any, cambio)
      cambiApplicati++
      if (!(m as any).abbonamento_piano) continue      // disdetto: non c'e' piu' niente da fare
    }

    if (!m.parent_master_id) continue                  // il master principale e' la piattaforma

    // 2-bis) ESENTE A TERMINE (piano gratuito fino a una data, es. prova fino al 1° del mese): quando
    // la data è passata smette di essere esente e da qui in poi entra nel ciclo come tutti — se ha la
    // carta paga (circuito), altrimenti lo prende il controllo giornaliero → tolleranza → congelamento.
    // I permanenti (Ecomize, MULTIEXPRESS, Giga) hanno esente_fino_a = NULL → non entrano mai qui.
    if (m.abbonamento_esente && (m as any).abbonamento_esente_fino_a
        && new Date((m as any).abbonamento_esente_fino_a) <= new Date()) {
      await admin.from('masters').update({ abbonamento_esente: false, abbonamento_esente_fino_a: null }).eq('id', m.id)
      ;(m as any).abbonamento_esente = false
      esenzioniScadute++
      // NON fa `continue`: prosegue sotto come un master normale (carta / senza-carta).
    }

    // 3) Esenti: tengono il piano, non pagano, non si congelano.
    if (m.abbonamento_esente) {
      await admin.from('masters').update({ abbonamento_mese: mese, pagamento_scaduto_dal: null }).eq('id', m.id)
      esentiSaltati++
      continue
    }

    // Ha una carta attiva: se ne occupa il circuito. Se l'addebito fallisce ce lo dira' lui, ed e'
    // li' che parte il conto alla rovescia — non qui.
    if ((m as any).stripe_subscription_id && (m as any).stripe_stato !== 'canceled') { conCarta++; continue }

    // Piano attivo ma nessuna carta: se ne occupa il controllo GIORNALIERO
    // (/api/abbonamento/controllo-carta), che se ne accorge anche a meta' mese.
    senzaCarta++
  }

  return NextResponse.json({ success: true, mese, cambiApplicati, esentiSaltati, esenzioniScadute, conCarta, senzaCarta })
}
