import { registraMovimentoMaster, registraMovimento } from '@/lib/movimenti'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'
import { noloMaster, noloCliente, noloClienteDopoPartenza, applicaServizio, addebitaResi, pagatoDaMaster, type RigaReso } from '@/lib/reso-prezzi'
import { catenaDaCorriere, risolviGambeSpedizione, gambePerTracking, type GambaSpedizione } from '@/lib/condivisione-catena'
import { leggiPrezzi, calcolaCosti, noloClienteSpedizione } from '@/lib/giacenza-prezzi'

// Mappa il "nome" di un supplemento giacenza (sia lato cliente sia lato master) sull'operazione.
// Es. "Riconsegna al nuovo destinatario" -> riconsegna_nuovo, "Reso al mittente" -> reso.
function chiaveServizio(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (n.includes('nuovo')) return 'riconsegna_nuovo'
  if (n.includes('reso')) return 'reso'
  if (n.includes('riconsegna')) return 'riconsegna'
  return null
}

// Prezzo giacenza (apertura + servizio dell'operazione) di UN master per un suo corriere,
// letto dal SUO Listino Corrieri (listini_corrieri_supplementi). Se non configurato -> 0.
//
// `perc` e' la percentuale sul nolo: quasi tutti i listini hanno il reso a percentuale col valore
// fisso a zero, e finche' qui si leggeva il solo valore fisso l'intera rete pagava zero mentre il
// cliente pagava il reso per intero. Chi chiama la applica al nolo di QUEL master (vedi
// lib/reso-prezzi.ts): la percentuale senza base non vuol dire niente.
async function prezzoGiacenzaMaster(admin: any, corriereId: string, operazione: string): Promise<{ apertura: number; servizio: number; perc: number }> {
  // SOLO i listini DEL MASTER PROPRIETARIO del contratto: esistono righe "fantasma" che stanno nel
  // listino di un ALTRO master ma puntano a questo corriere (39 in archivio). Leggendo per solo
  // corriere_id quelle righe SCAVALCAVANO il listino configurato: nell'editor "Riconsegna 0" ma
  // in addebito 0,70. Ora vale ciò che è impostato nel listino del master, punto.
  const { data: corr } = await admin.from('corrieri').select('master_id').eq('id', corriereId).maybeSingle()
  const { data: listini } = await admin.from('listini_corrieri').select('id').eq('master_id', (corr as any)?.master_id || '')
  const listinoIds = (listini || []).map((l: any) => l.id)
  if (!listinoIds.length) return { apertura: 0, servizio: 0, perc: 0 }
  const { data: suppl } = await admin.from('listini_corrieri_supplementi')
    .select('id,tipo,nome,valore,descrizione').eq('corriere_id', corriereId).in('listino_id', listinoIds).in('tipo', ['giacenza', 'giacenza_apertura'])
    .order('id', { ascending: true })   // DETERMINISTICO: con supplementi duplicati prende sempre il primo (id più basso)
  let apertura = 0, servizio = 0, perc = 0
  let aperturaSet = false, servizioSet = false
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aperturaSet) { apertura = Number(s.valore) || 0; aperturaSet = true } continue }
    if (chiaveServizio(s.nome) === operazione && !servizioSet) {
      servizio = Number(s.valore) || 0
      try { perc = Number(JSON.parse(s.descrizione || '{}')?.perc) || 0 } catch { /* descrizione non JSON */ }
      servizioSet = true
    }
  }
  return { apertura, servizio, perc }
}

/**
 * Cascata giacenza: come per le spedizioni, ogni master della catena — dal master diretto della
 * spedizione fino al DETENTORE del contratto — viene addebitato del SUO prezzo giacenza per quel
 * corriere (apertura + servizio dell'operazione), scalando il suo credito (RPC atomica). Due voci
 * separate. Se un livello non ha prezzo giacenza configurato, non viene addebitato (0).
 * Il reso di solito non ha apertura dossier (come nel calcolo cliente): parametro conApertura.
 */
export async function addebitaGiacenzaCatena(
  params: {
    masterDirettoId: string
    corriereOwnerId: string
    corriereNome: string
    operazione: string          // riconsegna | riconsegna_nuovo | reso
    numero: string
    spedizioneId: string | null
    createdBy: string | null
    conApertura: boolean        // addebita l'apertura dossier (all'ENTRATA in giacenza)
    conServizio?: boolean       // addebita il servizio dell'operazione (allo SVINCOLO). Default true.
  }
): Promise<void> {
  const conServizio = params.conServizio !== false
  const admin = createAdminSupabase()

  // Detentore REALE del contratto: il master più in alto che possiede lo stesso nome_contratto, ma la salita
  // si FERMA alla prima riga dichiarata propria (come catenaContratto e la cascata delle spedizioni). Senza
  // questo stop la gamba di LOGIXIA su SDA EXPRESS L (contratto suo, proprio=true) saliva fino al ponte
  // omonimo di MULTIEXPRESS, suo padre d'albero, e lo addebitava da falso detentore. Sui contratti normali
  // non cambia niente: l'unica riga propria con un omonimo nel padre è quella di LOGIXIA (14/10).
  let ownerReale = params.corriereOwnerId
  {
    let cur: string | null = params.corriereOwnerId
    for (let i = 0; i < 20 && cur; i++) {
      const curCid = await corriereDiMasterPerNome(admin, cur, params.corriereNome)
      if (curCid) {
        const { data: cc }: any = await admin.from('corrieri').select('proprio').eq('id', curCid).maybeSingle()
        if (cc?.proprio) { ownerReale = cur; break }
      }
      const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      const parent: string | null = mm?.parent_master_id || null
      if (!parent) break
      // Confronto NORMALIZZATO, come nella cascata delle spedizioni (lib/contratto-per-nome.ts).
      const pcId = await corriereDiMasterPerNome(admin, parent, params.corriereNome)
      if (pcId) { ownerReale = parent; cur = parent } else break
    }
  }

  const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }

  // La spedizione serve solo se un livello ha il servizio a PERCENTUALE: la percentuale si applica
  // al nolo di quel master, e il nolo si ricalcola dal suo listino. Si legge una volta sola.
  let sped: any = null
  if (params.spedizioneId) {
    const { data } = await admin.from('spedizioni')
      .select('id,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
      .eq('id', params.spedizioneId).maybeSingle()
    sped = data || null
  }

  let currentId: string | null = params.masterDirettoId
  for (let i = 0; i < 20 && currentId; i++) {
    const { data: m }: any = await admin.from('masters').select('id,parent_master_id').eq('id', currentId).maybeSingle()
    if (!m) break

    // Corriere (copia) di questo master per lo stesso contratto -> per leggerne il prezzo giacenza.
    const mCorrId = await corriereDiMasterPerNome(admin, m.id, params.corriereNome)
    if (mCorrId) {
      const mCorr = { id: mCorrId }
      const pr = await prezzoGiacenzaMaster(admin, mCorr.id, params.operazione)
      const apertura = params.conApertura ? pr.apertura : 0
      // Due voci separate (come per il cliente): apertura giacenza + servizio.
      if (apertura > 0) {
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: m.id, masterTargetId: m.id, tipo: 'giacenza',
            descrizione: `Apertura giacenza ${params.numero}`, riferimento: params.numero,
            importo: -Math.abs(apertura), spedizioneId: params.spedizioneId, createdBy: params.createdBy,
          })
        } catch (e) { console.error(`Errore apertura giacenza cascata master ${m.id}:`, e) }
      }
      // TRACCIABILITA': la voce si scrive ANCHE a importo 0. Se il livello non ha un prezzo per
      // quell'operazione non paga nulla, ma l'operazione DEVE restare visibile nei suoi movimenti:
      // prima spariva del tutto e sembrava che la riconsegna non fosse mai passata da lui.
      if (conServizio) {
        // Fisso + percentuale sul NOLO di questo master. Senza la percentuale il servizio valeva
        // zero praticamente per tutti, e la rete si prendeva resi e riconsegne gratis.
        let servizio = pr.servizio
        if (pr.perc > 0) {
          const nolo = sped ? await noloMaster(admin, m.id, mCorr.id, sped) : null
          if (nolo != null) servizio = applicaServizio({ valore: pr.servizio, perc: pr.perc }, nolo)
        }
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: m.id, masterTargetId: m.id, tipo: 'giacenza',
            descrizione: `${opLabel[params.operazione] || params.operazione} ${params.numero}`, riferimento: params.numero,
            importo: -Math.abs(servizio), spedizioneId: params.spedizioneId, createdBy: params.createdBy,
          })
        } catch (e) { console.error(`Errore servizio giacenza cascata master ${m.id}:`, e) }
      }
    }

    if (m.id === ownerReale) break
    currentId = m.parent_master_id
  }
}

/**
 * RESO CHE ARRIVA DAL CORRIERE, non da uno svincolo.
 *
 * Quando e' il corriere a rimandare indietro il pacco, lo stato arriva dal tracking e nessuno dei
 * tre punti che addebitavano il reso (svincolo giacenza, distinta, rimessa di rete) viene toccato:
 * su 62 resi, 60 non li aveva pagati nessuno. Ora il database mette quei resi in coda da solo, con
 * un trigger, e questa funzione li lavora riusando lo STESSO calcolo dello svincolo — non una copia.
 *
 * L'unica differenza e' `da_giacenza: false`: qui la guardia del database DEVE applicarsi. Se il
 * reso e' gia' stato addebitato da un'altra strada, fn_addebita_resi risponde "gia_addebitato" e
 * non si paga due volte. Vince il primo dei due momenti che arriva.
 */
// RESO del CONDIVISO: cascata sulla catena-FORNITORE (non l'albero), ogni livello col SUO nolo e sul
// SUO conto — albero→masters.credito (self/self, come il tree-reso), codice→ledger "(ingrosso)",
// owner→credito_proprio — a specchio della creazione: il livello-codice è prezzato col listino del
// cliente-ledger contro il corriere del VENDITORE (lo stesso che fa /api/v1). ANTI-DOPPIO: la cascata
// parte SEMPRE dalla gamba ORIGINANTE (risolviGambeSpedizione), così tutte le righe puntano al suo
// spedizione_id e fn_addebita_resi dedup, qualunque gamba abbia innescato il reso. SOLO moovexpress.
export async function addebitaResoCondivisione(admin: any, spedizioneId: string, nomeContratto: string, daGiacenza = true): Promise<EsitoAddebito> {
  // Risolvo la gamba ORIGINANTE dal tracking: è da lì che la catena ha senso e lì puntano tutte le righe.
  const { data: spTrk } = await admin.from('spedizioni').select('tracking_number').eq('id', spedizioneId).maybeSingle()
  const tracking = (spTrk as any)?.tracking_number
  const gambe = tracking ? await risolviGambeSpedizione(admin, tracking) : []
  const originanteId = gambe.length ? gambe[0].spedizioneId : spedizioneId
  const { data: full } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,corriere_id,costo_totale,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
    .eq('id', originanteId).maybeSingle()
  if (!full) return { addebitato: false, importoCliente: 0 }
  // La fila del contratto dai puntatori, dalla riga della gamba originante: lineare fino al detentore vero.
  const catena = await catenaDaCorriere(admin, full.corriere_id, { master: full.master_id, nomeContratto })
  if (!catena.length) return { addebitato: false, importoCliente: 0 }
  const righe: RigaReso[] = []
  // CLIENTE finale (originante): nolo dal SUO listino cliente (0 se contratto tolto → vedi noloClienteDopoPartenza).
  if (full.cliente_id) {
    const { data: cli } = await admin.from('clienti').select('listino_cliente_id').eq('id', full.cliente_id).maybeSingle()
    righe.push({ spedizione_id: full.id, cliente_id: full.cliente_id, master_owner_id: full.master_id, corriere_id: full.corriere_id,
      nolo: await noloClienteDopoPartenza(admin, full, (cli as any)?.listino_cliente_id), da_giacenza: daGiacenza })
  }
  for (const liv of catena) {
    if (liv.ruolo === 'codice' && liv.ledgerClienteId && liv.fornitore) {
      // Livello-CODICE: prezzato come in creazione — listino del cliente-ledger, corriere del VENDITORE.
      // L'addebito scala il LEDGER (clienti.credito del "(ingrosso)"), non masters.credito.
      const { data: lc } = await admin.from('clienti').select('listino_cliente_id').eq('id', liv.ledgerClienteId).maybeSingle()
      const corrVend = liv.corriereFornitoreId || await corriereDiMasterPerNome(admin, liv.fornitore, nomeContratto)
      const nolo = ((lc as any)?.listino_cliente_id && corrVend)
        ? await noloCliente(admin, { ...full, corriere_id: corrVend }, (lc as any).listino_cliente_id) : null
      righe.push({ spedizione_id: full.id, cliente_id: liv.ledgerClienteId, master_owner_id: liv.fornitore, corriere_id: corrVend,
        nolo: nolo ?? 0, da_giacenza: daGiacenza })
    } else {
      // ALBERO / OWNER: self/self, nolo dal listino del livello (owner = corriere reale → credito_proprio).
      righe.push({ spedizione_id: full.id, master_target_id: liv.master, master_owner_id: liv.master, corriere_id: liv.corriereId,
        nolo: (await noloMaster(admin, liv.master, liv.corriereId, full)) || 0,
        pagato: await pagatoDaMaster(admin, full.id, liv.master), da_giacenza: daGiacenza })
    }
  }
  try {
    const esiti = await addebitaResi(admin, righe, null)
    const cli = esiti.find(e => e.cliente_id === full.cliente_id && e.esito === 'addebitato')
    return { addebitato: esiti.some(e => e.esito === 'addebitato' || e.esito === 'gia_addebitato'), importoCliente: Number(cli?.importo || 0) }
  } catch (e) { console.error('Errore addebito reso condivisione:', e); return { addebitato: false, importoCliente: 0 } }
}

export async function addebitaResoDaTracking(admin: any, spedizioneId: string): Promise<EsitoAddebito> {
  const { data: sp } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,corriere_id,giacenza_apertura_addebitata,corrieri(nome_contratto,master_id,tipo)')
    .eq('id', spedizioneId).maybeSingle()
  if (!sp) return { addebitato: false, importoCliente: 0 }
  const corr: any = (sp as any).corrieri
  // CONDIVISIONE: una gamba-ponte (tipo='moovexpress') segue la catena-FORNITORE, non l'albero (che
  // risalirebbe al master-hub e, con più gambe stesso tracking, addebiterebbe doppio). La cascata parte
  // dalla gamba originante ed è idempotente (vedi addebitaResoCondivisione). Gli altri corrieri: invariato.
  if (corr?.tipo === 'moovexpress') return addebitaResoCondivisione(admin, spedizioneId, corr?.nome_contratto || '', false)
  return addebitaResoGiacenza(
    admin,
    sp as any,
    corr?.nome_contratto || null,
    corr?.master_id || null,
    false,
  )
}

/**
 * RESO allo svincolo giacenza: cliente + tutta la catena fino al detentore del contratto, in una
 * chiamata sola al database. Qui si calcolano solo i NOLI (il motore tariffe vive nell'app); la
 * percentuale, il ripiego e l'anti-doppio-addebito li applica fn_addebita_resi.
 */
async function addebitaResoGiacenza(admin: any, sped: SpedGiac, corriereNome: string | null, corriereOwnerId: string | null, daGiacenza = true): Promise<EsitoAddebito> {
  const { data: full } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,cliente_id,master_id,corriere_id,costo_totale,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
    .eq('id', sped.id).maybeSingle()
  if (!full) return { addebitato: false, importoCliente: 0 }
  // UN RESO È UN EVENTO DEL PACCO, NON DELLA RIGA. Un pacco condiviso ha più gambe con lo stesso tracking:
  // quella del venditore che detiene il contratto (es. LOGIXIA su SDA EXPRESS L, tipo 'poste', cliente =
  // il ledger di chi gliel'ha comprato) non è un ponte e passava di qui, risalendo l'albero, mentre la
  // gamba originante addebitava la stessa catena: due addebiti per pacco. Dall'8 al 14/10, 27 resi su 28,
  // +118,68 € a Wave (ingrosso) e +105,44 € a LOGIXIA. L'anti-doppio del database è per spedizione_id e
  // non poteva vederlo. Ora una gamba che non è l'originante passa dalla catena della gamba originante:
  // tutte le righe puntano alla sua spedizione_id e fn_addebita_resi addebita una volta sola, qualunque
  // gamba arrivi prima (tracking, svincolo della giacenza).
  // L'importo che si riporta è quello pagato dal cliente di QUESTA gamba (per LOGIXIA il ledger di Wave),
  // letto dal movimento: non quello del cliente finale della gamba originante, che è il prezzo di un'altra
  // rete e al venditore a monte non va mostrato. Se dalla gamba originante non si addebita niente (nessuna
  // catena) si resta sull'albero di questa gamba, come prima.
  if (full.tracking_number) {
    const gambe = await risolviGambeSpedizione(admin, full.tracking_number)
    if (gambe.length > 1 && gambe[0].spedizioneId !== full.id && gambe[0].tipo === 'moovexpress') {
      const e = await addebitaResoCondivisione(admin, gambe[0].spedizioneId, corriereNome || '', daGiacenza)
      if (e.addebitato) {
        return { addebitato: true, importoCliente: full.cliente_id ? await totaleResoAddebitato(admin, [full.id], { clienteId: full.cliente_id }) : 0 }
      }
    }
  }
  const righe: RigaReso[] = []

  if (full.cliente_id) {
    const { data: cli } = await admin.from('clienti').select('listino_cliente_id').eq('id', full.cliente_id).maybeSingle()
    righe.push({
      spedizione_id: full.id, cliente_id: full.cliente_id, master_owner_id: full.master_id,
      corriere_id: full.corriere_id,
      // Contratto tolto dal listino del cliente = nolo 0: vedi noloClienteDopoPartenza.
      nolo: await noloClienteDopoPartenza(admin, full, cli?.listino_cliente_id),
      da_giacenza: daGiacenza,
    })
  }

  // La catena: dal master della spedizione fino a chi possiede davvero il contratto. Ogni livello
  // paga il SUO nolo, letto dalla SUA copia del contratto.
  if (corriereNome && corriereOwnerId) {
    for (const liv of await catenaContratto(admin, full.master_id, corriereOwnerId, corriereNome)) {
      righe.push({
        spedizione_id: full.id, master_target_id: liv.masterId, master_owner_id: liv.masterId,
        corriere_id: liv.corriereId,
        nolo: (await noloMaster(admin, liv.masterId, liv.corriereId, full)) || 0,
        pagato: await pagatoDaMaster(admin, full.id, liv.masterId),
        da_giacenza: daGiacenza,
      })
    }
  }

  try {
    const esiti = await addebitaResi(admin, righe, null)
    const cli = esiti.find(e => e.cliente_id && e.esito === 'addebitato')
    return {
      // "addebitato" vuol dire che qualcuno ha davvero pagato: se torna tutto zero il reso non e'
      // stato incassato da nessuno, e chi chiama non deve marcarlo come gia' addebitato.
      addebitato: esiti.some(e => e.esito === 'addebitato' || e.esito === 'gia_addebitato'),
      importoCliente: Number(cli?.importo || 0),
    }
  } catch (e) {
    console.error('Errore addebito reso giacenza:', e)
    return { addebitato: false, importoCliente: 0 }
  }
}

export type EsitoAddebito = { addebitato: boolean; importoCliente: number }

/**
 * QUANTO HA PAGATO UN SOGGETTO PER IL RESO di queste spedizioni, letto dai movimenti già scritti. Serve alle
 * distinte di reso, che mostrano un totale e non addebitano niente. Per un pacco condiviso l'addebito sta
 * sulla gamba ORIGINANTE (vedi addebitaResoGiacenza), quindi una riga che è la gamba del venditore si
 * cerca lì: prima la distinta di LOGIXIA verso "Wave ship (ingrosso)" sarebbe uscita a 0 € (come già le
 * distinte di Wave verso "MULTIEXPRESS (ingrosso)") pur avendo il ledger pagato.
 */
export async function totaleResoAddebitato(
  admin: any, spedizioneIds: string[], pagatore: { clienteId?: string | null; masterTargetId?: string | null },
): Promise<number> {
  const { origineDi, importoDi } = await resoAddebitatoPerOrigine(admin, spedizioneIds, pagatore)
  // Due gambe dello stesso pacco nella stessa distinta sono UN reso: si conta una volta.
  const totale = [...new Set(origineDi.values())].reduce((s, o) => s + (importoDi.get(o) || 0), 0)
  return Math.round(totale * 100) / 100
}

/**
 * Lo stesso conto, riga per riga: quanto ha pagato quel soggetto per il reso di OGNI spedizione della
 * distinta. Serve al dettaglio e al PDF, che finora leggevano il costo dalle voci salvate: il cron delle 23
 * nelle voci scrive solo l'id (righe vuote a 0,00), e la scansione ci scrive il costo dell'ANDATA
 * (costo_totale), che col reso non c'entra.
 */
export async function resoAddebitatoPerSpedizione(
  admin: any, spedizioneIds: string[], pagatore: { clienteId?: string | null; masterTargetId?: string | null },
): Promise<Map<string, number>> {
  const { origineDi, importoDi } = await resoAddebitatoPerOrigine(admin, spedizioneIds, pagatore)
  const out = new Map<string, number>()
  for (const [id, o] of origineDi) out.set(id, Math.round((importoDi.get(o) || 0) * 100) / 100)
  return out
}

async function resoAddebitatoPerOrigine(
  admin: any, spedizioneIds: string[], pagatore: { clienteId?: string | null; masterTargetId?: string | null },
): Promise<{ origineDi: Map<string, string>; importoDi: Map<string, number> }> {
  const origineDi = new Map<string, string>()
  const importoDi = new Map<string, number>()
  if (!spedizioneIds.length || (!pagatore.clienteId && !pagatore.masterTargetId)) return { origineDi, importoDi }
  const righe: any[] = []
  for (let i = 0; i < spedizioneIds.length; i += 300) {
    const { data } = await admin.from('spedizioni').select('id,tracking_number').in('id', spedizioneIds.slice(i, i + 300))
    righe.push(...(data || []))
  }
  const gambe = await gambePerTracking(admin, righe.map(r => r.tracking_number))
  for (const r of righe) {
    const g = r.tracking_number ? gambe.get(r.tracking_number) : null
    origineDi.set(r.id, g && g.length > 1 && g[0].tipo === 'moovexpress' ? g[0].spedizioneId : r.id)
  }
  const ids = [...new Set(origineDi.values())]
  for (let i = 0; i < ids.length; i += 300) {
    let q = admin.from('movimenti').select('spedizione_id,importo').eq('tipo', 'reso').in('spedizione_id', ids.slice(i, i + 300))
    // Verso un master contano solo le SUE righe (cliente_id vuoto), mai quelle di un cliente.
    q = pagatore.clienteId ? q.eq('cliente_id', pagatore.clienteId) : q.eq('master_target_id', pagatore.masterTargetId).is('cliente_id', null)
    const { data } = await q
    for (const m of (data || [])) importoDi.set(m.spedizione_id, (importoDi.get(m.spedizione_id) || 0) + Math.abs(Number(m.importo || 0)))
  }
  return { origineDi, importoDi }
}

/**
 * I livelli che pagano, dal master diretto fino al DETENTORE REALE del contratto (il master piu'
 * in alto che possiede lo stesso nome_contratto), con la copia di contratto di ciascuno.
 * Il confronto sui nomi e' normalizzato: in archivio c'e' un contratto salvato con lo spazio
 * finale su un livello e senza sull'altro, ed e' gia' costato un detentore non riconosciuto.
 */
export async function catenaContratto(
  admin: any, masterDirettoId: string, corriereOwnerId: string, corriereNome: string,
): Promise<{ masterId: string; corriereId: string }[]> {
  let ownerReale = corriereOwnerId
  let cur: string | null = corriereOwnerId
  for (let i = 0; i < 20 && cur; i++) {
    // IL DETENTORE SI DICHIARA, NON SI INDOVINA.
    // Prima si risaliva finche' si trovava un contratto che si CHIAMAVA uguale, e ci si fermava
    // li'. Funziona finche' i nomi non si scontrano: il giorno in cui un master porta un contratto
    // SUO e lo chiama come uno che esiste piu' in alto, la catena risalirebbe fino a quello e gli
    // addebiterebbe roba che non e' sua — senza un errore e senza che nessuno se ne accorga.
    // Il segno `proprio` chiude la questione: se questo contratto e' dichiarato suo, la catena
    // finisce qui e chi sta sopra non viene nemmeno guardato.
    const curCid = await corriereDiMasterPerNome(admin, cur, corriereNome)
    if (curCid) {
      const { data: cc }: any = await admin.from('corrieri').select('proprio').eq('id', curCid).maybeSingle()
      if (cc?.proprio) { ownerReale = cur; break }
    }
    const { data: mm }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    const parent: string | null = mm?.parent_master_id || null
    if (!parent) break
    const pcId = await corriereDiMasterPerNome(admin, parent, corriereNome)
    if (pcId) { ownerReale = parent; cur = parent } else break
  }

  const out: { masterId: string; corriereId: string }[] = []
  let id: string | null = masterDirettoId
  for (let i = 0; i < 20 && id; i++) {
    const { data: m }: any = await admin.from('masters').select('id,parent_master_id').eq('id', id).maybeSingle()
    if (!m) break
    const cId = await corriereDiMasterPerNome(admin, m.id, corriereNome)
    if (cId) out.push({ masterId: m.id, corriereId: cId })
    if (m.id === ownerReale) break
    id = m.parent_master_id
  }
  return out
}

const OP_LABEL: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }

// Prezzo giacenza dal listino del CLIENTE (apertura + servizio dell'operazione) per un corriere.
async function prezzoGiacenzaClienteListino(admin: any, clienteId: string, corriereId: string, operazione: string): Promise<{ apertura: number; servizio: number }> {
  const { data: cli } = await admin.from('clienti').select('listino_cliente_id').eq('id', clienteId).maybeSingle()
  if (!cli?.listino_cliente_id) return { apertura: 0, servizio: 0 }
  let q = admin.from('listini_clienti_supplementi').select('id,tipo,nome,valore')
    .eq('listino_id', cli.listino_cliente_id).in('tipo', ['giacenza', 'giacenza_apertura']).order('id', { ascending: true })
  if (corriereId) q = q.eq('corriere_id', corriereId)
  const { data: suppl } = await q
  let apertura = 0, servizio = 0, aSet = false, sSet = false
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { if (!aSet) { apertura = Number(s.valore) || 0; aSet = true } continue }
    if (chiaveServizio(s.nome) === operazione && !sSet) { servizio = Number(s.valore) || 0; sSet = true }
  }
  return { apertura, servizio }
}

type SpedGiac = { id: string; numero: string; cliente_id: string | null; master_id: string; corriere_id: string; giacenza_apertura_addebitata?: boolean; tracking_number?: string | null }

/**
 * APERTURA GIACENZA DI UN PACCO CONDIVISO: un evento del PACCO, addebitato una volta sola dalla gamba
 * originante lungo la fila del contratto (corrieri.fornitore_corriere_id), come la spedizione.
 *
 * Prima la addebitava la sola gamba del venditore che detiene il contratto (LOGIXIA su SDA EXPRESS L,
 * tipo 'poste'), salendo l'ALBERO per nome senza fermarsi al detentore: trovava il ponte omonimo di
 * MULTIEXPRESS (suo padre d'albero, che però compra da Wave) e lo addebitava come falso detentore —
 * 92 aperture dall'8 al 14/10, −46,00 € — mentre il cliente finale e il master originante non pagavano
 * mai (130,50 € e 124,50 € sugli stessi pacchi, coi prezzi dei loro listini). Le gambe-ponte venivano
 * saltate di proposito ("feature deferita"): eccola.
 *
 * Chi paga, e su che conto, è lo specchio della creazione:
 *  - il cliente finale: l'apertura del SUO listino, sul contratto con cui ha spedito;
 *  - salto a collegamento: il compratore paga il venditore sul suo ledger, al prezzo che il venditore
 *    fa a quel ledger (listino del ledger × contratto del venditore);
 *  - salto d'albero e detentore: ognuno la SUA apertura, dal suo listino corrieri, sul suo conto
 *    (come addebitaGiacenzaCatena per i contratti normali).
 * Tutte le voci stanno sulla gamba originante: è lì che il pacco si guarda e si ricostruisce.
 *
 * L'ordine conta, perché sui movimenti di giacenza il database non ha un anti-doppio:
 *  1. il PIANO (fila e prezzi) si calcola tutto in lettura. Fila interrotta o non leggibile, o un salto a
 *     collegamento senza ledger o senza la riga del venditore → errore prima di scrivere: la riga resta in
 *     coda. Niente ripiego sulla catena per nome: lì i salti a collegamento non hanno il ledger e finirebbero
 *     sul conto del master (MULTIEXPRESS di nuovo falso detentore);
 *  2. poi si PRENDE il segno su tutte le gambe del pacco (solo quelle ancora libere, con l'errore
 *     controllato): se non si riesce non si è scritto niente; se un'altra gamba l'aveva già, ci si ferma;
 *  3. solo allora si scrivono i movimenti. Un livello che non riesce non ferma gli altri (come la cascata
 *     normale) e resta nei log; non viene mai riscritto due volte.
 */
export type VoceGiacenza = { cliente?: { masterId: string; clienteId: string }; master?: string; importo: number }

// IL PIANO dell'apertura di un pacco condiviso, solo letture: chi paga e quanto. Separato dalla scrittura
// perche' serve anche a rimettere in regola le aperture addebitate col calcolo di prima (8-14/10): si
// confronta il piano con quello che e' stato davvero addebitato, senza una seconda copia della regola.
export async function pianoAperturaGiacenzaCondivisione(admin: any, originanteId: string): Promise<{ o: any; piano: VoceGiacenza[] }> {
  const { data: o, error: eO } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,corriere_id').eq('id', originanteId).maybeSingle()
  if (eO || !o) throw new Error('gamba originante non leggibile')
  const catena = await catenaDaCorriere(admin, o.corriere_id)
  if (!catena.length) throw new Error('fila del contratto interrotta: apertura giacenza rimandata')
  const piano: VoceGiacenza[] = []
  if (o.cliente_id) {
    const pr = await prezzoGiacenzaClienteListino(admin, o.cliente_id, o.corriere_id, 'riconsegna')
    if (pr.apertura > 0) piano.push({ cliente: { masterId: o.master_id, clienteId: o.cliente_id }, importo: pr.apertura })
  }
  for (const liv of catena) {
    if (liv.ruolo === 'codice') {
      if (!liv.ledgerClienteId || !liv.fornitore || !liv.corriereFornitoreId) throw new Error(`salto a collegamento senza ledger (${liv.master}): apertura giacenza rimandata`)
      const pr = await prezzoGiacenzaClienteListino(admin, liv.ledgerClienteId, liv.corriereFornitoreId, 'riconsegna')
      if (pr.apertura > 0) piano.push({ cliente: { masterId: liv.fornitore, clienteId: liv.ledgerClienteId }, importo: pr.apertura })
    } else {
      const pr = await prezzoGiacenzaMaster(admin, liv.corriereId, 'riconsegna')
      if (pr.apertura > 0) piano.push({ master: liv.master, importo: pr.apertura })
    }
  }
  return { o, piano }
}

async function addebitaAperturaGiacenzaCondivisione(admin: any, idsGambe: string[], originanteId: string): Promise<void> {
  const { o, piano } = await pianoAperturaGiacenzaCondivisione(admin, originanteId)
  const descr = `Apertura giacenza ${o.numero}`

  const { data: presi, error: eSegno } = await admin.from('spedizioni').update({ giacenza_apertura_addebitata: true })
    .in('id', idsGambe).eq('giacenza_apertura_addebitata', false).select('id')
  if (eSegno) throw new Error('segno di apertura non scritto: ' + eSegno.message)
  if ((presi || []).length !== idsGambe.length) {
    // Una gamba era già segnata fra la lettura e adesso: l'apertura del pacco l'ha già presa qualcun altro.
    return
  }

  for (const v of piano) {
    try {
      if (v.cliente) {
        await registraMovimento(admin, { masterId: v.cliente.masterId, clienteId: v.cliente.clienteId, tipo: 'giacenza',
          descrizione: descr, importo: -Math.abs(v.importo), riferimento: o.numero, spedizioneId: o.id })
      } else if (v.master) {
        await registraMovimentoMaster(admin, { masterOwnerId: v.master, masterTargetId: v.master, tipo: 'giacenza',
          descrizione: descr, riferimento: o.numero, importo: -Math.abs(v.importo), spedizioneId: o.id, createdBy: null })
      }
    } catch (e) { console.error(`Errore apertura giacenza (condiviso) ${o.numero}:`, e) }
  }
}

/**
 * APERTURA giacenza — addebitata all'ENTRATA in giacenza (dal cron): il cliente paga subito
 * l'apertura dossier, e la spesa risale la rete (ogni master paga la SUA apertura). Una sola volta
 * (guard giacenza_apertura_addebitata). Il servizio (riconsegna/reso) NON si tocca qui.
 */
export async function addebitaAperturaGiacenza(sped: SpedGiac): Promise<void> {
  if (sped.giacenza_apertura_addebitata) return
  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('master_id,nome_contratto,tipo').eq('id', sped.corriere_id).maybeSingle()
  // UNA GIACENZA È UN EVENTO DEL PACCO, NON DELLA RIGA: per un pacco condiviso (più gambe, la prima un
  // ponte) si addebita una volta, dalla gamba originante, qualunque gamba arrivi in coda per prima, e si
  // segnano tutte le gambe, così le altre righe in coda non rifanno niente. Se una gamba risulta già
  // addebitata (col calcolo di prima) non si addebita di nuovo. Le letture qui devono riuscire: una gamba
  // del venditore letta male tornerebbe alla cascata per albero, cioè al falso detentore.
  {
    let trk: string | null | undefined = (sped as any).tracking_number
    if (trk === undefined) {
      const { data: t, error: eT } = await admin.from('spedizioni').select('tracking_number').eq('id', sped.id).maybeSingle()
      if (eT) throw new Error('spedizione non leggibile: ' + eT.message)
      trk = (t as any)?.tracking_number || null
    }
    const gambe = trk ? ((await gambePerTracking(admin, [trk])).get(trk) || []) : []
    if (gambe.length > 1 && gambe[0].tipo === 'moovexpress') {
      const ids = gambe.map(g => g.spedizioneId)
      const { data: gia, error: eGia } = await admin.from('spedizioni').select('id').in('id', ids).eq('giacenza_apertura_addebitata', true)
      if (eGia) throw new Error('gambe del pacco non leggibili: ' + eGia.message)
      if (!(gia || []).length) await addebitaAperturaGiacenzaCondivisione(admin, ids, gambe[0].spedizioneId)
      return
    }
  }
  // Ponte senza altre gambe (dati incompleti): niente catena da cui addebitare, come prima.
  if ((corr as any)?.tipo === 'moovexpress') return
  if (sped.cliente_id) {
    const pr = await prezzoGiacenzaClienteListino(admin, sped.cliente_id, sped.corriere_id, 'riconsegna')
    if (pr.apertura > 0) {
      try {
        await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
          descrizione: `Apertura giacenza ${sped.numero}`, importo: -Math.abs(pr.apertura), riferimento: sped.numero, spedizioneId: sped.id })
      } catch (e) { console.error('Errore apertura giacenza cliente:', e) }
    }
  }
  if (corr?.nome_contratto) {
    await addebitaGiacenzaCatena({ masterDirettoId: sped.master_id, corriereOwnerId: corr.master_id, corriereNome: corr.nome_contratto,
      operazione: 'riconsegna', numero: sped.numero, spedizioneId: sped.id, createdBy: null, conApertura: true, conServizio: false })
  }
  await admin.from('spedizioni').update({ giacenza_apertura_addebitata: true }).eq('id', sped.id)
}

/**
 * SERVIZIO GIACENZA DI UN PACCO CONDIVISO (riconsegna, riconsegna a nuovo destinatario) allo svincolo.
 * Come l'apertura qui sopra: un evento del PACCO, addebitato una volta sola dalla gamba originante lungo
 * la fila del contratto, qualunque gamba sia stata svincolata (il cliente in fondo o un master della fila).
 *
 * Prima si saltava ("feature deferita"): su un pacco condiviso lo svincolo non addebitava il servizio a
 * nessuno — ne' al cliente, ne' alla fila fino al detentore, che il corriere invece lo paga.
 *
 * Chi paga, specchio della creazione (e del reso condiviso, addebitaResoCondivisione):
 *  - il cliente finale: il servizio del SUO listino, quello congelato nella richiesta se la richiesta e'
 *    nata sulla sua gamba; se e' nata sulla gamba di un master, ricalcolato sulla gamba originante (il
 *    prezzo della richiesta era quello di un altro "cliente": il ledger di quella gamba);
 *  - salto a collegamento: il ledger paga il venditore, col listino del ledger sul contratto del venditore,
 *    fisso + percentuale sul nolo — lo stesso calcolo del cliente (lib/giacenza-prezzi);
 *  - salto d'albero e detentore: ognuno il SUO servizio, fisso + percentuale sul SUO nolo, come
 *    addebitaGiacenzaCatena (anche a 0, perche' l'operazione resti visibile nei suoi movimenti).
 * Il reso NON passa di qui: lo addebita addebitaResoCondivisione (database, una volta per pacco).
 *
 * Ordine come l'apertura: piano tutto in lettura (fila interrotta = errore prima di scrivere), poi il
 * segno giacenza_addebito_effettuato su TUTTE le gambe ancora libere (se un'altra gamba l'aveva gia', ci
 * si ferma: il servizio del pacco l'ha gia' pagato qualcuno), solo allora i movimenti.
 */
// IL PIANO, solo letture (chi paga e quanto). Esportato perche' lo svincolo lo calcola PRIMA di parlare
// col corriere: se la fila non si legge ci si ferma senza aver mandato niente (altrimenti il corriere
// riceveva l'istruzione e nessuno pagava il servizio).
export async function pianoServizioGiacenzaCondivisione(
  admin: any, gambe: GambaSpedizione[], operazione: string, opz: { richiestaSpedizioneId: string; importoServizioCliente: number },
): Promise<{ o: any; piano: VoceGiacenza[] }> {
  const originanteId = gambe[0].spedizioneId
  const { data: o, error: eO } = await admin.from('spedizioni')
    .select('id,numero,cliente_id,master_id,corriere_id,costo_totale,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,dest_provincia,dest_cap,dest_paese,dest_citta')
    .eq('id', originanteId).maybeSingle()
  if (eO || !o) throw new Error('gamba originante non leggibile: servizio giacenza non addebitato')
  const catena = await catenaDaCorriere(admin, o.corriere_id)
  if (!catena.length) throw new Error('fila del contratto interrotta: servizio giacenza non addebitato')
  const piano: VoceGiacenza[] = []
  if (o.cliente_id) {
    let imp = Number(opz.importoServizioCliente) || 0
    if (opz.richiestaSpedizioneId !== o.id) {
      imp = calcolaCosti(operazione, await leggiPrezzi(admin, o), o, await noloClienteSpedizione(admin, o)).costo_servizio
    }
    if (imp > 0) piano.push({ cliente: { masterId: o.master_id, clienteId: o.cliente_id }, importo: imp })
  }
  for (const liv of catena) {
    if (liv.ruolo === 'codice') {
      if (!liv.ledgerClienteId || !liv.fornitore || !liv.corriereFornitoreId) throw new Error(`salto a collegamento senza ledger (${liv.master}): servizio giacenza non addebitato`)
      const sp = { ...o, cliente_id: liv.ledgerClienteId, corriere_id: liv.corriereFornitoreId }
      const imp = calcolaCosti(operazione, await leggiPrezzi(admin, sp), sp, await noloClienteSpedizione(admin, sp)).costo_servizio
      if (imp > 0) piano.push({ cliente: { masterId: liv.fornitore, clienteId: liv.ledgerClienteId }, importo: imp })
    } else {
      const pr = await prezzoGiacenzaMaster(admin, liv.corriereId, operazione)
      let servizio = pr.servizio
      if (pr.perc > 0) {
        const nolo = await noloMaster(admin, liv.master, liv.corriereId, o)
        if (nolo != null) servizio = applicaServizio({ valore: pr.servizio, perc: pr.perc }, nolo)
      }
      piano.push({ master: liv.master, importo: servizio })
    }
  }
  return { o, piano }
}

async function addebitaServizioGiacenzaCondivisione(
  admin: any, gambe: GambaSpedizione[], operazione: string, opz: { richiestaSpedizioneId: string; importoServizioCliente: number },
  pianoPronto?: { o: any; piano: VoceGiacenza[] },
): Promise<EsitoAddebito> {
  // Il piano lo passa lo svincolo, calcolato PRIMA del corriere: dopo che il corriere ha accettato non si
  // rilegge niente, perche' una lettura caduta in quel momento faceva risultare fallito uno svincolo fatto.
  const { o, piano } = pianoPronto || await pianoServizioGiacenzaCondivisione(admin, gambe, operazione, opz)
  const descr = `${OP_LABEL[operazione] || operazione} ${o.numero}`

  const ids = gambe.map(g => g.spedizioneId)
  const { data: presi, error: eSegno } = await admin.from('spedizioni').update({ giacenza_addebito_effettuato: true })
    .in('id', ids).or('giacenza_addebito_effettuato.is.null,giacenza_addebito_effettuato.eq.false').select('id')
  if (eSegno) throw new Error('segno del servizio giacenza non scritto: ' + eSegno.message)
  if ((presi || []).length !== ids.length) return { addebitato: false, importoCliente: 0 }

  let importoCliente = 0
  for (const v of piano) {
    try {
      if (v.cliente) {
        await registraMovimento(admin, { masterId: v.cliente.masterId, clienteId: v.cliente.clienteId, tipo: 'giacenza',
          descrizione: descr, importo: -Math.abs(v.importo), riferimento: o.numero, spedizioneId: o.id })
        if (v.cliente.clienteId === o.cliente_id) importoCliente = v.importo
      } else if (v.master) {
        await registraMovimentoMaster(admin, { masterOwnerId: v.master, masterTargetId: v.master, tipo: 'giacenza',
          descrizione: descr, riferimento: o.numero, importo: -Math.abs(v.importo), spedizioneId: o.id, createdBy: null })
      }
    } catch (e) { console.error(`Errore servizio giacenza (condiviso) ${o.numero}:`, e) }
  }
  return { addebitato: true, importoCliente }
}

/**
 * SERVIZIO giacenza — addebitato allo SVINCOLO in base all'operazione scelta (riconsegna/reso/…):
 * il cliente paga l'importo (congelato nella richiesta) e la spesa risale la rete (ogni master
 * paga il SUO servizio). L'apertura NON si tocca qui (già addebitata all'entrata).
 */
export async function addebitaServizioGiacenza(
  sped: SpedGiac, operazione: string, importoServizioCliente: number,
  // Dallo svincolo: le gambe e il piano gia' letti prima del corriere (vedi sopra). Senza, si leggono qui.
  opz: { gambe?: GambaSpedizione[]; piano?: { o: any; piano: VoceGiacenza[] } } = {},
): Promise<EsitoAddebito> {
  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('master_id,nome_contratto,tipo').eq('id', sped.corriere_id).maybeSingle()
  // PACCO CONDIVISO (piu' gambe, la prima un ponte): il servizio e il reso sono eventi del PACCO, e si
  // addebitano dalla gamba originante lungo la fila, qualunque gamba sia stata svincolata. Prima qui la
  // gamba-ponte usciva senza addebitare niente, e la gamba del detentore risaliva l'albero da sola.
  {
    let trk: string | null | undefined = (sped as any).tracking_number
    if (trk === undefined) {
      const { data: t, error: eT } = await admin.from('spedizioni').select('tracking_number').eq('id', sped.id).maybeSingle()
      if (eT) throw new Error('spedizione non leggibile: ' + eT.message)
      trk = (t as any)?.tracking_number || null
    }
    const gambe = opz.gambe ?? (trk ? ((await gambePerTracking(admin, [trk])).get(trk) || []) : [])
    if (gambe.length > 1 && gambe[0].tipo === 'moovexpress') {
      if (operazione === 'reso') return addebitaResoCondivisione(admin, gambe[0].spedizioneId, corr?.nome_contratto || '', true)
      return addebitaServizioGiacenzaCondivisione(admin, gambe, operazione, { richiestaSpedizioneId: sped.id, importoServizioCliente }, opz.piano)
    }
  }
  // Ponte senza altre gambe (dati incompleti): niente fila da cui addebitare, come prima.
  if ((corr as any)?.tipo === 'moovexpress') return { addebitato: false, importoCliente: 0 }

  // IL RESO NON PASSA DA QUI: lo decide il database (fn_addebita_resi), cosi' costa uguale che
  // arrivi dallo svincolo giacenza o dalla scansione in sede, e cliente e catena si addebitano in
  // una transazione sola invece che con un ciclo che puo' fermarsi a meta'.
  if (operazione === 'reso') {
    return addebitaResoGiacenza(admin, sped, corr?.nome_contratto || null, corr?.master_id || null)
  }

  if (sped.cliente_id && importoServizioCliente > 0) {
    try {
      await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
        descrizione: `${OP_LABEL[operazione] || operazione} ${sped.numero}`, importo: -Math.abs(importoServizioCliente), riferimento: sped.numero, spedizioneId: sped.id })
    } catch (e) { console.error('Errore servizio giacenza cliente:', e) }
  }
  if (corr?.nome_contratto) {
    await addebitaGiacenzaCatena({ masterDirettoId: sped.master_id, corriereOwnerId: corr.master_id, corriereNome: corr.nome_contratto,
      operazione, numero: sped.numero, spedizioneId: sped.id, createdBy: null, conApertura: false, conServizio: true })
  }
  return { addebitato: true, importoCliente: Math.abs(Number(importoServizioCliente) || 0) }
}
