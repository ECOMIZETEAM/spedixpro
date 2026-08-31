import { wooPost, wooPut } from '@/lib/woo'
import { marchioCorriere } from '@/lib/corriere-logo'

// Rimanda il tracking a WooCommerce alla chiusura distinta.
// Woo non ha un campo tracking nativo: aggiungiamo una NOTA ordine (visibile al cliente)
// col corriere+tracking e portiamo l'ordine a stato "completed". Best-effort, mai bloccante.
export async function fulfillSpedizioniWoo(db: any, spedizioneIds: string[]) {
  const esiti: any[] = []
  if (!spedizioneIds?.length) return esiti
  const { data: ordini } = await db
    .from('ordini_ecommerce').select('*')
    .in('spedizione_id', spedizioneIds)
    .eq('piattaforma', 'woocommerce')
  for (const ordine of ordini || []) {
    if (ordine.fulfillment_stato === 'ok') continue
    const segna = async (stato: string, errore: string | null) => {
      await db.from('ordini_ecommerce').update({ fulfillment_stato: stato, fulfillment_errore: errore }).eq('id', ordine.id)
      esiti.push({ ordine: ordine.numero_ordine, stato, errore })
    }
    try {
      const { data: sped } = await db
        .from('spedizioni').select('tracking_number, tracking_token, corrieri(nome_contratto)')
        .eq('id', ordine.spedizione_id).maybeSingle()
      const tracking = sped?.tracking_number
      if (!tracking) { await segna('errore', 'tracking number mancante'); continue }
      // BRAND PUBBLICO, mai il nome del contratto (roba interna). E link di tracciamento WHITE-LABEL
      // (/traccia/<token>, lo stesso di SMS/email al destinatario): il compratore ha un link cliccabile
      // sul nostro dominio, non un numero nudo, e non vede alcun provider.
      const company = marchioCorriere((sped as any)?.corrieri?.nome_contratto || '') || 'Corriere'
      const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
      const link = (sped as any)?.tracking_token ? `${base}/traccia/${(sped as any).tracking_token}` : null

      const { data: integr } = await db.from('integrazioni').select('*').eq('id', ordine.integrazione_id).maybeSingle()
      const cred = integr?.credenziali as any
      if (!cred?.url || !cred?.ck || !cred?.cs) { await segna('errore', 'integrazione non trovata'); continue }

      // 1) nota ordine col tracking (visibile al cliente)
      await wooPost(cred.url, cred.ck, cred.cs, `/orders/${ordine.ordine_esterno_id}/notes`, {
        note: link
          ? `Spedizione affidata a ${company}. Tracking: ${tracking}. Traccia qui: ${link}`
          : `Spedizione affidata a ${company}. Tracking: ${tracking}`,
        customer_note: true,
      })
      // 2) ordine a stato completato
      await wooPut(cred.url, cred.ck, cred.cs, `/orders/${ordine.ordine_esterno_id}`, { status: 'completed' })

      await segna('ok', null)
    } catch (e: any) {
      await segna('errore', String(e?.message || e).slice(0, 150))
    }
  }
  return esiti
}
