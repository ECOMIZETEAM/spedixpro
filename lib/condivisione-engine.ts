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

/* Anagrafica del master collegato riportata sul suo cliente-ledger, così il venditore vede CHI è (sola
 * lettura: il ledger non si modifica, è lo specchio del master). Mappa masters → colonne clienti. */
export function anagraficaMasterPerLedger(m: any): Record<string, any> {
  if (!m) return {}
  return {
    piva: m.piva || null, cf: m.codice_fiscale || null, pec: m.pec || null, telefono: m.telefono || null,
    sl_indirizzo: m.indirizzo || null, sl_citta: m.citta || null, sl_provincia: m.provincia || null, sl_cap: m.cap || null, sl_paese: 'IT',
    so_indirizzo: m.indirizzo_operativo || m.indirizzo || null, so_citta: m.citta_operativo || m.citta || null,
    so_provincia: m.provincia_operativo || m.provincia || null, so_cap: m.cap_operativo || m.cap || null, so_paese: 'IT',
  }
}

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
    .select('id,master_id,tipo,nome_contratto,attivo,credenziali').eq('id', corriereId).maybeSingle()
  if (!corr || corr.master_id !== seller) return { ok: false, reason: 'Contratto non trovato tra i tuoi.' }
  // Un contratto moovexpress SI RI-CONDIVIDE (catena a 3+ livelli: la Triangolazioni presa da LOGIXIA la
  // rivendo a MULTI). Unico divieto: ri-venderlo all'ORIGINE stessa (loop: lo vendo a chi me l'ha dato).
  if (corr.tipo === 'moovexpress' && (corr.credenziali || {}).fornitore_master_id === buyer) {
    return { ok: false, reason: 'Questo contratto arriva proprio da quel master: non glielo puoi rivendere.' }
  }

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
  // Il fattore volume si prende SOLO dalla riga del venditore per QUESTO corriere. MAI un ripiego su
  // un'altra riga: il vecchio "|| listiniCosto[0]" pescava il divisore di un CONTRATTO A CASO (es. il
  // 3333 di una GLS LIGHT finito su Poste Express M, il 6666 di BRT PF su PDB-S) e la propagazione a
  // cascata lo spargeva su tutta la rete a tutti i livelli — incidente del 1-2/10/2026, 293 righe
  // corrotte. Se il venditore non ha la riga per questo corriere, fattore = null → eredita il default,
  // mai il divisore di un altro contratto.
  const rigaCosto = (listiniCosto || []).find((l: any) => l.corriere_id === corriereId) as any
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

  const m = await materializzaContratto(admin, { seller, buyer, ledgerId, ledgerNome: ledger.ragione_sociale, corr, listinoIngrosso: listinoIngrosso! })
  return m
}

/* Materializza sul COMPRATORE un contratto il cui prezzo W è GIÀ nel listino d'ingrosso del ledger:
 * abilita il corriere al ledger, crea la chiave, crea/riusa il corriere moovexpress del compratore e
 * propaga costo+zone (accendendolo se riesce). NON tocca le fasce del listino (le mette chi chiama:
 * abilita le genera da costo+ricarico, assegna-listino le prende dal listino scelto). */
async function materializzaContratto(
  admin: any,
  p: { seller: string; buyer: string; ledgerId: string; ledgerNome?: string; corr: any; listinoIngrosso: string },
): Promise<{ ok: boolean; reason?: string; propagazione?: any; buyerCorriereId?: string }> {
  const { seller, buyer, ledgerId, ledgerNome, corr, listinoIngrosso } = p
  const corriereId = corr.id as string

  // Il ledger "vede" il contratto (clienti_corrieri_abilitati) — come un cliente qualsiasi.
  const { data: ab } = await admin.from('clienti_corrieri_abilitati').select('cliente_id').eq('cliente_id', ledgerId).eq('corriere_id', corriereId).maybeSingle()
  if (!ab) await admin.from('clienti_corrieri_abilitati').insert({ cliente_id: ledgerId, corriere_id: corriereId, abilitato: true })
  else await admin.from('clienti_corrieri_abilitati').update({ abilitato: true }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)

  // API KEY per (ledger, contratto): è la credenziale del compratore. Si riusa se c'è.
  const { data: keyEsist } = await admin.from('api_keys').select('chiave,attivo').eq('cliente_id', ledgerId).eq('corriere_id', corriereId).maybeSingle()
  let chiave = keyEsist?.chiave as string | undefined
  if (!chiave) {
    chiave = generaApiKey()
    const { error: eK } = await admin.from('api_keys').insert({ master_id: seller, cliente_id: ledgerId, corriere_id: corriereId, chiave, nome: `moovexpress ${ledgerNome || ''}`.slice(0, 80), attivo: true })
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
      // proprio=TRUE: il corriere-ponte È il contratto proprio del compratore (lui tiene la chiave verso il
      // venditore e lo rivende). Così il suo COSTO cade su credito_proprio (lista separata, come QUICK) e
      // la cascata NON lo gata dal conto-albero (fn_conto_di/pagaDalSuoConto): il gate vero è il ledger al
      // venditore (che il DISPATCH addebita). Con proprio=false un compratore NON-vertice verrebbe gatato
      // sul suo credito verso il PADRE, che è il rapporto sbagliato. Vedi lib/cascata.ts + fn_conto_di.
      settings: {}, multicollo: true, inserimento_ritiri: true, attivo: false, livello: 1, proprio: true,
    }).select('id').single()
    if (eC || !nc) return { ok: false, reason: 'Creazione corriere sul compratore non riuscita.' }
    buyerCorrId = nc.id
  } else {
    await admin.from('corrieri').update({ credenziali: { api_key: chiave, fornitore_master_id: seller, corriere_origine_id: corriereId } }).eq('id', buyerCorrId)
  }

  // PROPAGA costo + zone sul corriere del compratore, e lo ACCENDE solo se è andata (niente contratto monco).
  const propagazione = await propagaCosto(admin, { corriereVenditore: corriereId, corriereAcquirente: buyerCorrId!, masterAcquirente: buyer, listinoIngrosso })
  if (propagazione.ok) await admin.from('corrieri').update({ attivo: true }).eq('id', buyerCorrId)

  return { ok: true, propagazione, buyerCorriereId: buyerCorrId }
}

/* ASSEGNA un listino GIÀ FATTO dal venditore (Listini Clienti) al master collegato: diventa il prezzo
 * d'ingrosso (quello che il compratore paga), e OGNI contratto condivisibile dentro al listino viene
 * materializzato sul compratore (chiave + corriere + propagazione). È il flusso normale "assegna un
 * listino a un cliente", applicato al ledger. Salta i contratti che il compratore ha già o che vengono
 * da lui (non si rivende all'origine). Idempotente. */
export async function assegnaListinoCondivisione(
  admin: any,
  opts: { linkId: string; listinoId: string },
): Promise<{ ok: boolean; reason?: string; condivisi?: string[]; saltati?: { nome: string; motivo: string }[] }> {
  const { linkId, listinoId } = opts
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,stato,fornitore_master_id,master_id,cliente_ledger_id').eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  if (link.stato !== 'attiva') return { ok: false, reason: 'Il master non ha ancora approvato il collegamento.' }
  if (!link.cliente_ledger_id) return { ok: false, reason: 'Collegamento senza conto.' }
  const seller = link.fornitore_master_id as string
  const buyer = link.master_id as string
  const ledgerId = link.cliente_ledger_id as string

  const { data: listino } = await admin.from('listini_clienti').select('id,master_id,nome').eq('id', listinoId).maybeSingle()
  if (!listino || listino.master_id !== seller) return { ok: false, reason: 'Listino non trovato tra i tuoi.' }

  const { data: ledger } = await admin.from('clienti').select('id,ragione_sociale').eq('id', ledgerId).maybeSingle()
  // Il listino scelto DIVENTA il prezzo d'ingrosso del collegato (quello che lui paga).
  await admin.from('clienti').update({ listino_cliente_id: listinoId }).eq('id', ledgerId)

  // Corrieri col prezzo dentro al listino.
  const { data: fasce } = await admin.from('listini_clienti_fasce').select('corriere_id').eq('listino_id', listinoId)
  const corriereIds = Array.from(new Set((fasce || []).map((f: any) => f.corriere_id).filter(Boolean)))
  if (!corriereIds.length) return { ok: false, reason: 'Il listino scelto non ha prezzi: aggiungi almeno un contratto con le fasce.' }

  const { data: corrDett } = await admin.from('corrieri').select('id,master_id,tipo,nome_contratto,credenziali').in('id', corriereIds)
  // Contratti che il compratore ha GIÀ (per nome, anche disattivati) → non glieli rivendo.
  const { data: buyerPropri } = await admin.from('corrieri').select('nome_contratto').eq('master_id', buyer).neq('tipo', 'moovexpress')
  const giaSuoi = new Set((buyerPropri || []).map((c: any) => (c.nome_contratto || '').trim().toLowerCase()))

  const condivisi: string[] = []
  const saltati: { nome: string; motivo: string }[] = []
  for (const corr of (corrDett || [])) {
    const nome = corr.nome_contratto || '—'
    if (corr.master_id !== seller) { saltati.push({ nome, motivo: 'non è un tuo contratto' }); continue }
    if (corr.tipo === 'moovexpress' && (corr.credenziali || {}).fornitore_master_id === buyer) { saltati.push({ nome, motivo: 'arriva da quel master' }); continue }
    if (giaSuoi.has((nome || '').trim().toLowerCase())) { saltati.push({ nome, motivo: 'il master ce l’ha già' }); continue }
    const m = await materializzaContratto(admin, { seller, buyer, ledgerId, ledgerNome: ledger?.ragione_sociale, corr, listinoIngrosso: listinoId })
    if (m.ok && m.propagazione?.ok) condivisi.push(nome)
    else saltati.push({ nome, motivo: m.reason || m.propagazione?.reason || 'propagazione non riuscita' })
  }
  return { ok: true, condivisi, saltati }
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
