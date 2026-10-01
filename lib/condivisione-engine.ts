import { normalizzaMarkup, creaApplicaMarkup } from '@/lib/markup-fasce'
import { generaApiKey } from '@/lib/api-auth'
import { propagaCosto } from '@/lib/condivisione-propaga'

/* Flusso nuovo della condivisione contratti (CONDIVISIONE-CONTRATTI.md): il collegamento master↔master è
 * UNA riga corrieri_condivisi (corriere_id NULL, un cliente-ledger). L'approvazione è SOLO al collegamento;
 * dopo, il venditore abilita i singoli contratti dalla scheda del master collegato, senza riapprovazione.
 *
 * abilitaContrattoCondiviso = abilita UN contratto del venditore per il collegato: mette il prezzo W
 * (costo venditore + ricarico) nel listino del ledger, crea la chiave e il corriere moovexpress sul
 * compratore, e propaga costo+zone sul suo portale. Idempotente: ri-abilitare risincronizza.
 * disabilitaContrattoCondiviso = toglie quel contratto (spegne il corriere del compratore, revoca la
 * chiave, ripulisce il listino). Lo STORICO non si cancella: se il corriere ha spedizioni, si DISATTIVA. */

export async function abilitaContrattoCondiviso(
  admin: any,
  opts: { linkId: string; corriereId: string; markup?: any },
): Promise<{ ok: boolean; reason?: string; propagazione?: any; buyerCorriereId?: string }> {
  const { linkId, corriereId, markup } = opts

  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,stato,fornitore_master_id,master_id,cliente_ledger_id,credito_modo')
    .eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  if (link.stato !== 'attiva') return { ok: false, reason: 'Il master non ha ancora approvato il collegamento.' }
  if (!link.cliente_ledger_id) return { ok: false, reason: 'Collegamento senza conto: riprova l’approvazione.' }
  const seller = link.fornitore_master_id as string
  const buyer = link.master_id as string
  const ledgerId = link.cliente_ledger_id as string

  const { data: corr } = await admin.from('corrieri')
    .select('id,master_id,tipo,nome_contratto,attivo').eq('id', corriereId).maybeSingle()
  if (!corr || corr.master_id !== seller) return { ok: false, reason: 'Contratto non trovato tra i tuoi.' }
  if (corr.tipo === 'moovexpress') return { ok: false, reason: 'Un contratto ricevuto da un altro master non è ri-condivisibile.' }

  // Listino d'ingrosso del ledger (ne copre più d'uno): si crea alla prima abilitazione.
  const { data: ledger } = await admin.from('clienti').select('id,listino_cliente_id,ragione_sociale').eq('id', ledgerId).maybeSingle()
  if (!ledger) return { ok: false, reason: 'Conto del master collegato non trovato.' }
  let listinoIngrosso = ledger.listino_cliente_id as string | null
  if (!listinoIngrosso) {
    const { data: nl, error: eNl } = await admin.from('listini_clienti')
      .insert({ master_id: seller, nome: `Ingrosso ${ledger.ragione_sociale || ''}`.trim(), attivo: true }).select('id').single()
    if (eNl || !nl) return { ok: false, reason: 'Creazione listino d’ingrosso non riuscita.' }
    listinoIngrosso = nl.id
    await admin.from('clienti').update({ listino_cliente_id: listinoIngrosso }).eq('id', ledgerId)
  }

  // COSTO del venditore per quel contratto → W (col ricarico) nel listino del ledger. Idempotente per corriere.
  const applica = creaApplicaMarkup(normalizzaMarkup(markup))
  const { data: listiniCosto } = await admin.from('listini_corrieri')
    .select('id,corriere_id,fattore_volume,solo_peso_reale').eq('master_id', seller)
  const costoIds = (listiniCosto || []).map((l: any) => l.id)
  if (!costoIds.length) return { ok: false, reason: 'Non hai un listino di costo da cui partire.' }
  const { data: fasceCosto } = await admin.from('listini_corrieri_fasce')
    .select('zona_id,peso_min,peso_max,prezzo,tipo,fuel').in('listino_id', costoIds).eq('corriere_id', corriereId)
  if (!fasceCosto?.length) return { ok: false, reason: `Nessun prezzo di costo per "${corr.nome_contratto}" da cui partire.` }
  const { data: suppCosto } = await admin.from('listini_corrieri_supplementi')
    .select('tipo,descrizione,valore,tipo_calcolo,nome').in('listino_id', costoIds).eq('corriere_id', corriereId)
  const rigaCosto = ((listiniCosto || []).find((l: any) => l.corriere_id === corriereId) || (listiniCosto || [])[0]) as any
  const fattore = rigaCosto?.fattore_volume ?? null

  const { data: linkC } = await admin.from('listini_clienti_corrieri')
    .select('corriere_id').eq('listino_id', listinoIngrosso).eq('corriere_id', corriereId).maybeSingle()
  if (!linkC) await admin.from('listini_clienti_corrieri').insert({ listino_id: listinoIngrosso, corriere_id: corriereId, fattore_volume: fattore, abilitato: true })
  else await admin.from('listini_clienti_corrieri').update({ fattore_volume: fattore, abilitato: true }).eq('listino_id', listinoIngrosso).eq('corriere_id', corriereId)

  await admin.from('listini_clienti_fasce').delete().eq('listino_id', listinoIngrosso).eq('corriere_id', corriereId)
  const fasceW = (fasceCosto || []).map((f: any) => ({
    listino_id: listinoIngrosso, corriere_id: corriereId, zona_id: f.zona_id,
    peso_min: f.peso_min, peso_max: f.peso_max, tipo: f.tipo, fuel: f.fuel,
    prezzo: applica(f.prezzo, f.tipo, f.peso_max),
  }))
  for (let i = 0; i < fasceW.length; i += 1000) {
    const { error } = await admin.from('listini_clienti_fasce').insert(fasceW.slice(i, i + 1000))
    if (error) return { ok: false, reason: 'Scrittura listino d’ingrosso: ' + (error.message || error) }
  }
  await admin.from('listini_clienti_supplementi').delete().eq('listino_id', listinoIngrosso).eq('corriere_id', corriereId)
  if (suppCosto?.length) await admin.from('listini_clienti_supplementi').insert((suppCosto || []).map((s: any) => ({
    listino_id: listinoIngrosso, corriere_id: corriereId, tipo: s.tipo, descrizione: s.descrizione, valore: s.valore, tipo_calcolo: s.tipo_calcolo, nome: s.nome,
  })))

  // Il ledger "vede" il contratto (clienti_corrieri_abilitati) — come un cliente qualsiasi.
  const { data: ab } = await admin.from('clienti_corrieri_abilitati').select('cliente_id').eq('cliente_id', ledgerId).eq('corriere_id', corriereId).maybeSingle()
  if (!ab) await admin.from('clienti_corrieri_abilitati').insert({ cliente_id: ledgerId, corriere_id: corriereId, abilitato: true })
  else await admin.from('clienti_corrieri_abilitati').update({ abilitato: true }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)

  // API KEY per (ledger, contratto): è la credenziale del compratore. Si riusa se c'è.
  const { data: keyEsist } = await admin.from('api_keys').select('chiave,attivo').eq('cliente_id', ledgerId).eq('corriere_id', corriereId).maybeSingle()
  let chiave = keyEsist?.chiave as string | undefined
  if (!chiave) {
    chiave = generaApiKey()
    const { error: eK } = await admin.from('api_keys').insert({ master_id: seller, cliente_id: ledgerId, corriere_id: corriereId, chiave, nome: `moovexpress ${ledger.ragione_sociale || ''}`.slice(0, 80), attivo: true })
    if (eK) return { ok: false, reason: 'Emissione chiave non riuscita.' }
  } else if (keyEsist?.attivo === false) {
    await admin.from('api_keys').update({ attivo: true }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
  }

  // CORRIERE moovexpress sul COMPRATORE: si riusa quello che punta a questo contratto (corriere_origine_id).
  const { data: corrBuyers } = await admin.from('corrieri').select('id,credenziali').eq('master_id', buyer).eq('tipo', 'moovexpress')
  let buyerCorrId = (corrBuyers || []).find((c: any) => (c.credenziali || {}).corriere_origine_id === corriereId)?.id as string | undefined
  if (!buyerCorrId) {
    const { data: nc, error: eC } = await admin.from('corrieri').insert({
      master_id: buyer, tipo: 'moovexpress', nome_contratto: corr.nome_contratto,
      credenziali: { api_key: chiave, fornitore_master_id: seller, corriere_origine_id: corriereId },
      settings: {}, multicollo: true, inserimento_ritiri: true, attivo: false, livello: 1, proprio: false,
    }).select('id').single()
    if (eC || !nc) return { ok: false, reason: 'Creazione corriere sul compratore non riuscita.' }
    buyerCorrId = nc.id
  } else {
    await admin.from('corrieri').update({ credenziali: { api_key: chiave, fornitore_master_id: seller, corriere_origine_id: corriereId } }).eq('id', buyerCorrId)
  }

  // PROPAGA costo + zone sul corriere del compratore, e lo ACCENDE solo se è andata (niente contratto monco).
  const propagazione = await propagaCosto(admin, { corriereVenditore: corriereId, corriereAcquirente: buyerCorrId!, masterAcquirente: buyer, listinoIngrosso: listinoIngrosso! })
  if (propagazione.ok) await admin.from('corrieri').update({ attivo: true }).eq('id', buyerCorrId)

  return { ok: true, propagazione, buyerCorriereId: buyerCorrId }
}

/* Ri-propaga il listino d'ingrosso ATTUALE del ledger a TUTTI i corrieri del compratore (senza rigenerare
 * le fasce dal costo: usa i prezzi come stanno ora, anche se ritoccati a mano nell'editor). Chiude il
 * caveat "costo mostrato stale" quando il venditore cambia i prezzi d'ingrosso. L'addebito era già live. */
export async function risincronizzaCondivisione(admin: any, linkId: string): Promise<{ ok: boolean; reason?: string; contratti?: number }> {
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,master_id,cliente_ledger_id,stato').eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  if (!link.cliente_ledger_id) return { ok: false, reason: 'Collegamento senza conto.' }
  const { data: ledger } = await admin.from('clienti').select('listino_cliente_id').eq('id', link.cliente_ledger_id).maybeSingle()
  const listinoIngrosso = ledger?.listino_cliente_id
  if (!listinoIngrosso) return { ok: true, contratti: 0 }

  const { data: corrBuyers } = await admin.from('corrieri').select('id,credenziali').eq('master_id', link.master_id).eq('tipo', 'moovexpress')
  let n = 0
  for (const cb of (corrBuyers || [])) {
    const cred = (cb.credenziali || {}) as any
    if (cred.fornitore_master_id !== link.fornitore_master_id || !cred.corriere_origine_id) continue
    try {
      const r = await propagaCosto(admin, { corriereVenditore: cred.corriere_origine_id, corriereAcquirente: cb.id, masterAcquirente: link.master_id, listinoIngrosso })
      if (r.ok) n++
    } catch (e: any) { console.error('[risincronizza]', cb.id, e?.message) }
  }
  return { ok: true, contratti: n }
}

export async function disabilitaContrattoCondiviso(
  admin: any,
  opts: { linkId: string; corriereId: string },
): Promise<{ ok: boolean; reason?: string }> {
  const { linkId, corriereId } = opts
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,master_id,cliente_ledger_id').eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  const seller = link.fornitore_master_id as string
  const buyer = link.master_id as string
  const ledgerId = link.cliente_ledger_id as string | null

  // Corriere del compratore che punta a questo contratto.
  const { data: corrBuyers } = await admin.from('corrieri').select('id,credenziali').eq('master_id', buyer).eq('tipo', 'moovexpress')
  const buyerCorr = (corrBuyers || []).find((c: any) => (c.credenziali || {}).corriere_origine_id === corriereId)
  if (buyerCorr) {
    // STORICO: se ha spedizioni, si DISATTIVA (non si cancella); altrimenti si rimuove pulito.
    const { count } = await admin.from('spedizioni').select('id', { count: 'exact', head: true }).eq('corriere_id', buyerCorr.id)
    if (count && count > 0) {
      await admin.from('corrieri').update({ attivo: false }).eq('id', buyerCorr.id)
    } else {
      await admin.from('listini_corrieri_fasce').delete().eq('corriere_id', buyerCorr.id)
      await admin.from('listini_corrieri_supplementi').delete().eq('corriere_id', buyerCorr.id)
      await admin.from('listini_corrieri_corrieri').delete().eq('corriere_id', buyerCorr.id)
      await admin.from('zone').delete().eq('corriere_id', buyerCorr.id)   // zone_cap cade per FK on delete
      await admin.from('listini_corrieri').delete().eq('corriere_id', buyerCorr.id)
      await admin.from('corrieri').delete().eq('id', buyerCorr.id)
    }
  }
  // Revoca la chiave e togli il contratto dal listino del ledger.
  await admin.from('api_keys').update({ attivo: false }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
  if (ledgerId) {
    const { data: led } = await admin.from('clienti').select('listino_cliente_id').eq('id', ledgerId).maybeSingle()
    if (led?.listino_cliente_id) {
      await admin.from('listini_clienti_fasce').delete().eq('listino_id', led.listino_cliente_id).eq('corriere_id', corriereId)
      await admin.from('listini_clienti_supplementi').delete().eq('listino_id', led.listino_cliente_id).eq('corriere_id', corriereId)
      await admin.from('listini_clienti_corrieri').delete().eq('listino_id', led.listino_cliente_id).eq('corriere_id', corriereId)
    }
    await admin.from('clienti_corrieri_abilitati').update({ abilitato: false }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
  }
  void seller
  return { ok: true }
}
