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

  const { data: fasceSrc } = await admin.from('listini_clienti_fasce').select('corriere_id,zona_id,peso_max,prezzo,tipo').eq('listino_id', parentListinoId)
  if (!fasceSrc?.length) return { ok: false, reason: 'listino assegnato vuoto' }
  const { data: supplSrc } = await admin.from('listini_clienti_supplementi').select('corriere_id,tipo,nome,valore,tipo_calcolo,descrizione').eq('listino_id', parentListinoId)
  const { data: listinoSrc } = await admin.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale').eq('id', parentListinoId).single()

  const corriereIds = [...new Set(fasceSrc.map((f: any) => f.corriere_id).filter(Boolean))]
  const zonaIds = [...new Set(fasceSrc.map((f: any) => f.zona_id).filter(Boolean))]

  // Se risincronizzo, svuoto fasce/suppl/link del sotto-master (tengo corrieri e zone, li rimappo per nome)
  if (opts?.force && mieiIds.length) {
    await admin.from('listini_corrieri_fasce').delete().in('listino_id', mieiIds)
    await admin.from('listini_corrieri_supplementi').delete().in('listino_id', mieiIds)
    await admin.from('listini_corrieri_corrieri').delete().in('listino_id', mieiIds)
  }

  // 1) CORRIERI (contratti): uno per il sotto-master per ciascuno del padre (riuso per nome)
  const { data: corrSrc } = corriereIds.length ? await admin.from('corrieri').select('*').in('id', corriereIds) : { data: [] }
  const { data: corrMiei } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', subMasterId)
  const mappaCorrMio = new Map((corrMiei || []).map((c: any) => [(c.nome_contratto || '').trim().toLowerCase(), c.id]))
  const mapCorr = new Map<string, string>()
  for (const c of (corrSrc || [])) {
    const key = (c.nome_contratto || '').trim().toLowerCase()
    let subId = mappaCorrMio.get(key)
    if (!subId) {
      const { data: nuovo } = await admin.from('corrieri').insert({
        master_id: subMasterId, nome_contratto: c.nome_contratto, tipo: c.tipo,
        credenziali: c.credenziali ?? null, settings: c.settings ?? null, attivo: c.attivo ?? true,
      }).select('id').single()
      subId = nuovo?.id
      if (subId) mappaCorrMio.set(key, subId)
    }
    if (subId) mapCorr.set(c.id, subId)
  }

  // 2) ZONE (+CAP): una per il sotto-master per ciascuna del padre, mappando il corriere
  const { data: zoneSrc } = zonaIds.length ? await admin.from('zone').select('id,nome,descrizione,con_fuel,corriere_id, zone_cap(paese,provincia,cap,citta)').in('id', zonaIds) : { data: [] }
  const { data: zoneMiei } = await admin.from('zone').select('id,nome,corriere_id').eq('master_id', subMasterId)
  const mappaZonaMio = new Map((zoneMiei || []).map((z: any) => [`${z.corriere_id}|${(z.nome || '').trim().toLowerCase()}`, z.id]))
  const mapZona = new Map<string, string>()
  for (const z of (zoneSrc || [])) {
    const subCorr = mapCorr.get(z.corriere_id) || null
    const key = `${subCorr}|${(z.nome || '').trim().toLowerCase()}`
    let subZid = mappaZonaMio.get(key)
    if (!subZid) {
      const { data: nuovaZ } = await admin.from('zone').insert({ master_id: subMasterId, corriere_id: subCorr, nome: z.nome, descrizione: z.descrizione, con_fuel: z.con_fuel || false }).select('id').single()
      subZid = nuovaZ?.id
      if (subZid) {
        mappaZonaMio.set(key, subZid)
        const caps = (z as any).zone_cap || []
        if (caps.length) await admin.from('zone_cap').insert(caps.map((cp: any) => ({ zona_id: subZid, paese: cp.paese, provincia: cp.provincia, cap: cp.cap, citta: cp.citta })))
      }
    }
    if (subZid) mapZona.set(z.id, subZid)
  }

  // 3) LISTINO CORRIERI del sotto-master (riuso il primo, altrimenti creo)
  let subListinoId = mieiIds[0]
  if (!subListinoId) {
    const { data: nl } = await admin.from('listini_corrieri').insert({ master_id: subMasterId, nome: listinoSrc?.nome || 'Listino Corrieri', fattore_volume: listinoSrc?.fattore_volume || 5000, solo_peso_reale: !!listinoSrc?.solo_peso_reale, attivo: true }).select('id').single()
    subListinoId = nl?.id
  } else {
    await admin.from('listini_corrieri').update({ fattore_volume: listinoSrc?.fattore_volume || 5000, solo_peso_reale: !!listinoSrc?.solo_peso_reale }).eq('id', subListinoId)
  }
  if (!subListinoId) return { ok: false, reason: 'errore creazione listino' }

  // 4) LINK contratti attivati
  const subCorrIds = [...new Set(mapCorr.values())]
  const { data: linkEsist } = await admin.from('listini_corrieri_corrieri').select('corriere_id').eq('listino_id', subListinoId)
  const linkSet = new Set((linkEsist || []).map((l: any) => l.corriere_id))
  const nuoviLink = subCorrIds.filter((cid) => !linkSet.has(cid)).map((cid) => ({ listino_id: subListinoId, corriere_id: cid }))
  if (nuoviLink.length) await admin.from('listini_corrieri_corrieri').insert(nuoviLink)

  // 5) FASCE
  const fasceIns = fasceSrc.map((f: any) => ({ listino_id: subListinoId, corriere_id: mapCorr.get(f.corriere_id) || null, zona_id: mapZona.get(f.zona_id) || null, peso_min: 0, peso_max: f.peso_max, prezzo: f.prezzo, tipo: f.tipo })).filter((f: any) => f.corriere_id && f.zona_id)
  if (fasceIns.length) await admin.from('listini_corrieri_fasce').insert(fasceIns)

  // 6) SUPPLEMENTI (assicurazione, contrassegno, giacenze, ritiro, accessori)
  const supplIns = (supplSrc || []).map((s: any) => ({ listino_id: subListinoId, corriere_id: mapCorr.get(s.corriere_id) || null, tipo: s.tipo, nome: s.nome, valore: s.valore, tipo_calcolo: s.tipo_calcolo, descrizione: s.descrizione })).filter((s: any) => s.corriere_id)
  if (supplIns.length) await admin.from('listini_corrieri_supplementi').insert(supplIns)

  return { ok: true, corrieri: subCorrIds.length, fasce: fasceIns.length }
}
