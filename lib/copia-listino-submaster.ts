import { fetchAll } from '@/lib/fetch-all'

// Chiavi di IMPOSTAZIONI DI CONTRATTO che si propagano al sotto-master (NON il mittente,
// che è specifico di ogni master). agevolazione peso, misure/volume massimo, scaglioni misure,
// peso reale fino a X kg.
const CONTRACT_SETTINGS_KEYS = ['agevolazione_peso_reale', 'misure_max', 'misure_scaglioni', 'peso_reale_soglia', 'limite_combinato', 'peso_max_collo', 'colli_max']
function settingsContratto(src: any): any {
  const out: any = {}
  if (src && typeof src === 'object') {
    for (const k of CONTRACT_SETTINGS_KEYS) {
      if (src[k] !== undefined && src[k] !== null) out[k] = src[k]
    }
  }
  return out
}

// Propaga a CASCATA le modifiche di un listino a tutta la rete sottostante:
// - i sotto-master a cui è assegnato questo listino (parent_listino_id = listinoId)
//   vengono ri-materializzati (copiaListinoAlSottoMaster force);
// - poi, ricorsivamente, ogni loro discendente (così le modifiche scendono lungo la catena).
// Idempotente. Ritorna quanti master sono stati aggiornati.
export async function propagaListinoACascata(admin: any, listinoId: string): Promise<number> {
  const { data: diretti } = await admin.from('masters').select('id').eq('parent_listino_id', listinoId)
  const queue: string[] = (diretti || []).map((s: any) => s.id)
  const visti = new Set<string>()
  while (queue.length) {
    const subId = queue.shift() as string
    if (!subId || visti.has(subId)) continue
    visti.add(subId)
    try { await copiaListinoAlSottoMaster(admin, subId, { force: true }) } catch (e) { console.error('propaga sub', subId, e) }
    const { data: figli } = await admin.from('masters').select('id').eq('parent_master_id', subId)
    for (const f of (figli || [])) if (!visti.has(f.id)) queue.push(f.id)
  }
  return visti.size
}

// Copia il listino che il master padre ha ASSEGNATO al sotto-master
// (masters.parent_listino_id, un listini_clienti) nella struttura PROPRIA del
// sotto-master: corrieri (contratti attivati) + zone (+CAP) + listini_corrieri
// (+ link) + fasce + supplementi. Così il sotto-master lo vede nel suo editor
// "Listino Corrieri" completo, può modificarlo e usare "Aggiungi contratto".
//
// Idempotente: di default NON tocca nulla se il sotto-master ha già delle fasce
// (per non sovrascrivere le sue modifiche). Con { force:true } risincronizza.
export async function copiaListinoAlSottoMaster(admin: any, subMasterId: string, opts?: { force?: boolean }) {
  const { data: sub } = await admin.from('masters').select('id,parent_listino_id').eq('id', subMasterId).single()
  if (!sub?.parent_listino_id) return { ok: false, reason: 'nessun listino assegnato' }
  const parentListinoId = sub.parent_listino_id

  const { data: mieiListini } = await admin.from('listini_corrieri').select('id').eq('master_id', subMasterId)
  const mieiIds = (mieiListini || []).map((l: any) => l.id)
  if (!opts?.force && mieiIds.length) {
    const { data: giaFasce } = await admin.from('listini_corrieri_fasce').select('id').in('listino_id', mieiIds).limit(1)
    if (giaFasce?.length) return { ok: true, reason: 'gia configurato' }
  }

  const { data: fasceSrc } = await admin.from('listini_clienti_fasce').select('corriere_id,zona_id,peso_max,prezzo,tipo,fuel').eq('listino_id', parentListinoId)
  if (!fasceSrc?.length) return { ok: false, reason: 'listino assegnato vuoto' }
  const { data: supplSrc } = await admin.from('listini_clienti_supplementi').select('corriere_id,tipo,nome,valore,tipo_calcolo,descrizione').eq('listino_id', parentListinoId)
  const { data: listinoSrc } = await admin.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale').eq('id', parentListinoId).single()

  const corriereIds = [...new Set(fasceSrc.map((f: any) => f.corriere_id).filter(Boolean))]
  const zonaIds = [...new Set(fasceSrc.map((f: any) => f.zona_id).filter(Boolean))]

  // 1) CORRIERI (contratti): uno per il sotto-master per ciascuno del padre (riuso per nome).
  //    Le IMPOSTAZIONI DI CONTRATTO (agevolazione peso, misure/volume massimo, scaglioni,
  //    peso reale soglia) si PROPAGANO dal padre; il MITTENTE resta del sotto-master.
  const { data: corrSrc } = corriereIds.length ? await admin.from('corrieri').select('*').in('id', corriereIds) : { data: [] }
  const { data: corrMiei } = await admin.from('corrieri').select('id,nome_contratto,settings').eq('master_id', subMasterId)
  const mappaCorrMio = new Map((corrMiei || []).map((c: any) => [(c.nome_contratto || '').trim().toLowerCase(), c]))
  const mapCorr = new Map<string, string>()
  for (const c of (corrSrc || [])) {
    const key = (c.nome_contratto || '').trim().toLowerCase()
    const esist: any = mappaCorrMio.get(key)
    let subId = esist?.id
    if (!subId) {
      // Nuovo: copio le impostazioni di contratto (senza mittente: lo imposta il sotto-master).
      const { data: nuovo } = await admin.from('corrieri').insert({
        master_id: subMasterId, nome_contratto: c.nome_contratto, tipo: c.tipo,
        credenziali: c.credenziali ?? null, settings: settingsContratto(c.settings), attivo: c.attivo ?? true,
      }).select('id').single()
      subId = nuovo?.id
      if (subId) mappaCorrMio.set(key, { id: subId, settings: settingsContratto(c.settings) })
    } else {
      // Esistente: aggiorno le impostazioni di contratto, MANTENENDO il mittente del sotto-master.
      const merged = { ...(esist.settings || {}), ...settingsContratto(c.settings) }
      await admin.from('corrieri').update({ settings: merged }).eq('id', subId)
    }
    if (subId) mapCorr.set(c.id, subId)
  }

  // 2) ZONE (+CAP): una per il sotto-master per ciascuna del padre, mappando il corriere.
  //    I CAP vengono SEMPRE sincronizzati col padre — anche sulle zone GIÀ esistenti — così quando
  //    il padre aggiunge/toglie un CAP (es. una zona disagiata) la modifica PROPAGA a valle e non
  //    resta solo sul padre. (Era il bug: i CAP si copiavano solo alla PRIMA creazione della zona,
  //    quindi le aggiunte successive non scendevano -> a valle si prezzava la zona sbagliata.)
  const { data: zoneSrc } = zonaIds.length ? await admin.from('zone').select('id,nome,descrizione,con_fuel,corriere_id').in('id', zonaIds) : { data: [] }
  // CAP del padre per zona, caricati a parte (l'embed annidato si fermerebbe a 1000 righe).
  const capSrcPerZona = new Map<string, any[]>()
  for (const z of (zoneSrc || [])) {
    capSrcPerZona.set(z.id, await fetchAll(() => admin.from('zone_cap').select('paese,provincia,cap,citta').eq('zona_id', z.id)))
  }
  const { data: zoneMiei } = await admin.from('zone').select('id,nome,corriere_id').eq('master_id', subMasterId)
  const mappaZonaMio = new Map((zoneMiei || []).map((z: any) => [`${z.corriere_id}|${(z.nome || '').trim().toLowerCase()}`, z.id]))
  const mapZona = new Map<string, string>()
  for (const z of (zoneSrc || [])) {
    const subCorr = mapCorr.get(z.corriere_id) || null
    const key = `${subCorr}|${(z.nome || '').trim().toLowerCase()}`
    let subZid: string | undefined = mappaZonaMio.get(key)
    if (!subZid) {
      const { data: nuovaZ } = await admin.from('zone').insert({ master_id: subMasterId, corriere_id: subCorr, nome: z.nome, descrizione: z.descrizione, con_fuel: z.con_fuel || false }).select('id').single()
      subZid = (nuovaZ as any)?.id
      if (subZid) mappaZonaMio.set(key, subZid)
    }
    if (subZid) {
      // Sincronizza i CAP col padre (propagazione): azzero e reinserisco quelli attuali del padre.
      const caps = capSrcPerZona.get(z.id) || []
      await admin.from('zone_cap').delete().eq('zona_id', subZid)
      for (let i = 0; i < caps.length; i += 1000) {
        await admin.from('zone_cap').insert(caps.slice(i, i + 1000).map((cp: any) => ({ zona_id: subZid, paese: cp.paese, provincia: cp.provincia, cap: cp.cap, citta: cp.citta })))
      }
      mapZona.set(z.id, subZid)
    }
  }

  // 3) LISTINO CORRIERI del sotto-master (riuso il primo, altrimenti creo)
  // listini_corrieri.corriere_id è NOT NULL: uso il primo corriere mappato.
  const primoCorr = [...mapCorr.values()][0]
  if (!primoCorr) return { ok: false, reason: 'nessun corriere da copiare' }
  let subListinoId = mieiIds[0]
  if (!subListinoId) {
    const { data: nl } = await admin.from('listini_corrieri').insert({ master_id: subMasterId, corriere_id: primoCorr, nome: listinoSrc?.nome || 'Listino Corrieri', fattore_volume: listinoSrc?.fattore_volume || 5000, solo_peso_reale: !!listinoSrc?.solo_peso_reale, attivo: true }).select('id').single()
    subListinoId = nl?.id
  } else {
    await admin.from('listini_corrieri').update({ fattore_volume: listinoSrc?.fattore_volume || 5000, solo_peso_reale: !!listinoSrc?.solo_peso_reale }).eq('id', subListinoId)
  }
  if (!subListinoId) return { ok: false, reason: 'errore creazione listino' }

  const subCorrIds = [...new Set(mapCorr.values())]

  // Risincronizzazione: rimuovo SOLO le fasce/supplementi dei corrieri ereditati dal master
  // (così i contratti aggiunti dal sotto-master restano intatti), poi li reinserisco aggiornati.
  if (opts?.force && subCorrIds.length && mieiIds.length) {
    await admin.from('listini_corrieri_fasce').delete().in('listino_id', mieiIds).in('corriere_id', subCorrIds)
    await admin.from('listini_corrieri_supplementi').delete().in('listino_id', mieiIds).in('corriere_id', subCorrIds)
  }

  // Fattore volume PER-CORRIERE ereditato dal padre (listini_clienti_corrieri.fattore_volume):
  // va scritto su listini_corrieri_corrieri.fattore_volume del sotto-master, altrimenti l'editor
  // cade sul default 5000 invece del valore assegnato (es. 4000).
  const { data: pcSrc } = await admin.from('listini_clienti_corrieri').select('corriere_id,fattore_volume').eq('listino_id', parentListinoId)
  const fattorePadrePerCorr = new Map<string, number>()
  for (const r of (pcSrc || [])) if ((r as any).fattore_volume != null) fattorePadrePerCorr.set((r as any).corriere_id, Number((r as any).fattore_volume))
  const fattoreListino = Number(listinoSrc?.fattore_volume) || 5000
  const padrePerSub = new Map<string, string>()  // sub corriere id -> padre corriere id
  for (const [padreCid, sCid] of mapCorr.entries()) padrePerSub.set(sCid, padreCid)
  const fattoreSub = (subCid: string): number => {
    const padreCid = padrePerSub.get(subCid)
    const f = padreCid ? fattorePadrePerCorr.get(padreCid) : undefined
    return (f != null) ? f : fattoreListino
  }

  // 4) LINK contratti attivati (con fattore_volume per-corriere ereditato dal padre)
  const { data: linkEsist } = await admin.from('listini_corrieri_corrieri').select('corriere_id').eq('listino_id', subListinoId)
  const linkSet = new Set((linkEsist || []).map((l: any) => l.corriere_id))
  const nuoviLink = subCorrIds.filter((cid) => !linkSet.has(cid)).map((cid) => ({ listino_id: subListinoId, corriere_id: cid, fattore_volume: fattoreSub(cid) }))
  if (nuoviLink.length) await admin.from('listini_corrieri_corrieri').insert(nuoviLink)
  // Allineo il fattore anche sui link GIÀ esistenti (fix dei dati in essere sui sotto-master)
  for (const cid of subCorrIds) {
    if (linkSet.has(cid)) await admin.from('listini_corrieri_corrieri').update({ fattore_volume: fattoreSub(cid) }).eq('listino_id', subListinoId).eq('corriere_id', cid)
  }
  // Allineo anche le righe listini_corrieri PER-CORRIERE = la FONTE del calcolo prezzo (billing):
  // ogni corriere del sotto-master eredita il fattore volume assegnato dal padre (no default 5000).
  const soloPesoR = !!listinoSrc?.solo_peso_reale
  for (const cid of subCorrIds) {
    await admin.from('listini_corrieri').update({ fattore_volume: fattoreSub(cid), solo_peso_reale: soloPesoR }).eq('master_id', subMasterId).eq('corriere_id', cid)
  }

  // 5) FASCE
  const fasceIns = fasceSrc.map((f: any) => ({ listino_id: subListinoId, corriere_id: mapCorr.get(f.corriere_id) || null, zona_id: mapZona.get(f.zona_id) || null, peso_min: 0, peso_max: f.peso_max, prezzo: f.prezzo, tipo: f.tipo, fuel: Number(f.fuel) || 0 })).filter((f: any) => f.corriere_id && f.zona_id)
  if (fasceIns.length) await admin.from('listini_corrieri_fasce').insert(fasceIns)

  // 6) SUPPLEMENTI (assicurazione, contrassegno, giacenze, ritiro, accessori)
  const supplIns = (supplSrc || []).map((s: any) => ({ listino_id: subListinoId, corriere_id: mapCorr.get(s.corriere_id) || null, tipo: s.tipo, nome: s.nome, valore: s.valore, tipo_calcolo: s.tipo_calcolo, descrizione: s.descrizione })).filter((s: any) => s.corriere_id)
  if (supplIns.length) await admin.from('listini_corrieri_supplementi').insert(supplIns)

  return { ok: true, corrieri: subCorrIds.length, fasce: fasceIns.length }
}
