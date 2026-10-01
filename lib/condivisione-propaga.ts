import { fetchAll } from '@/lib/fetch-all'

/* PROPAGAZIONE DEL COSTO DI UNA CONDIVISIONE (CONDIVISIONE-CONTRATTI.md, Fase 4).
 *
 * Quando un master ACCETTA il contratto di un altro (corriere tipo='moovexpress'), il COSTO che paga
 * (il listino d'ingrosso del venditore, = W) e le ZONE del contratto devono comparire sul SUO portale,
 * sul corriere appena materializzato — altrimenti "Listino Corrieri" e "Gestione Zone" sono vuoti e il
 * compratore non sa quanto paga né può costruirci sopra il listino clienti. È lo stesso effetto della
 * cascata padre→figlio (copiaListinoAlSottoMaster), ma qui la sorgente è OLTRE il ponte API: il listino
 * d'ingrosso è un `listini_clienti` sotto il VENDITORE, agganciato al cliente-ledger e al CORRIERE DEL
 * VENDITORE; il corriere di destinazione esiste già (NON si accoppia per nome, non si cammina l'albero).
 *
 * Copia (idempotente, come la cascata): zone(+CAP) del corriere venditore → zone del compratore sul suo
 * corriere; fasce del listino d'ingrosso (W) → listini_corrieri_fasce del compratore; + listino_corriere,
 * link con fattore volume, supplementi. Le zone si copiano TUTTE (anche senza prezzo): una zona senza
 * prezzo rende il corriere NON vendibile lì — esattamente ciò che deve essere finché il compratore non
 * decide il suo prezzo (vedi la nota lunga in copia-listino-submaster.ts).
 *
 * Il costo VERO addebitato alla spedizione resta `ris.prezzo` dall'/api/v1 del venditore (autorevole, nessun
 * disallineamento): questa copia serve a VISIBILITÀ, base del margine nell'editor e risoluzione zona a CAP.
 */
// Wrapper storico (vecchio modello per-contratto): legge i campi dalla riga corrieri_condivisi.
export async function propagaCostoCondivisione(admin: any, condivisioneId: string): Promise<{ ok: boolean; reason?: string; zone?: number; fasce?: number }> {
  const { data: cc } = await admin.from('corrieri_condivisi')
    .select('id,stato,corriere_id,master_id,listino_ingrosso_id,corriere_acquirente_id,cliente_ledger_id')
    .eq('id', condivisioneId).maybeSingle()
  if (!cc) return { ok: false, reason: 'condivisione non trovata' }
  if (!cc.corriere_acquirente_id) return { ok: false, reason: 'corriere acquirente non ancora materializzato (serve l’Accetta)' }
  if (!cc.listino_ingrosso_id) return { ok: false, reason: 'manca il listino d’ingrosso' }
  return propagaCosto(admin, {
    corriereVenditore: cc.corriere_id as string,
    corriereAcquirente: cc.corriere_acquirente_id as string,
    masterAcquirente: cc.master_id as string,
    listinoIngrosso: cc.listino_ingrosso_id as string,
  })
}

/* Cuore della propagazione, con parametri ESPLICITI (lo usa l'abilitazione per-contratto del flusso nuovo:
 * il listino d'ingrosso è quello del cliente-ledger, che copre più corrieri; qui si propaga UN contratto).
 *   corriereVenditore  = corriere REALE del venditore (sorgente zone + quali fasce dell'ingrosso)
 *   corriereAcquirente = riga moovexpress del compratore (destinazione)
 *   masterAcquirente   = il compratore
 *   listinoIngrosso    = listini_clienti (sotto il venditore) col prezzo W per quel corriere
 */
export async function propagaCosto(admin: any, p: { corriereVenditore: string; corriereAcquirente: string; masterAcquirente: string; listinoIngrosso: string }): Promise<{ ok: boolean; reason?: string; zone?: number; fasce?: number }> {
  const corriereVenditore = p.corriereVenditore
  const corriereAcquirente = p.corriereAcquirente
  const masterAcquirente = p.masterAcquirente
  const listinoIngrosso = p.listinoIngrosso

  // W: le fasce del listino d'ingrosso per il corriere del venditore.
  const fasceSrc = await fetchAll(() => admin.from('listini_clienti_fasce')
    .select('corriere_id,zona_id,peso_max,prezzo,tipo,fuel')
    .eq('listino_id', listinoIngrosso).eq('corriere_id', corriereVenditore).order('id', { ascending: true }))
  if (!fasceSrc.length) return { ok: false, reason: 'listino d’ingrosso vuoto per questo contratto' }

  const supplSrc = await fetchAll(() => admin.from('listini_clienti_supplementi')
    .select('corriere_id,tipo,nome,valore,tipo_calcolo,descrizione')
    .eq('listino_id', listinoIngrosso).eq('corriere_id', corriereVenditore).order('id', { ascending: true }))

  const { data: listinoSrc } = await admin.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale').eq('id', listinoIngrosso).single()
  // Fattore volume per-corriere del venditore (se impostato): va copiato o il costo stimato diverge.
  const { data: pcSrc } = await admin.from('listini_clienti_corrieri').select('fattore_volume').eq('listino_id', listinoIngrosso).eq('corriere_id', corriereVenditore).maybeSingle()
  const fattore = Number((pcSrc as any)?.fattore_volume) || Number(listinoSrc?.fattore_volume) || 5000
  const soloPesoR = !!listinoSrc?.solo_peso_reale

  // ── ZONE: TUTTE quelle del corriere del venditore → zone del compratore sul suo corriere. ──────────
  const { data: zoneSrc } = await admin.from('zone')
    .select('id,nome,descrizione,con_fuel,su_mittente').eq('corriere_id', corriereVenditore)
  const zonaIds = (zoneSrc || []).map((z: any) => z.id)

  const capSrcPerZona = new Map<string, any[]>()
  if (zonaIds.length) {
    const tutti = await fetchAll(() => admin.from('zone_cap').select('zona_id,paese,provincia,cap,citta').in('zona_id', zonaIds).order('id', { ascending: true }))
    for (const r of tutti) {
      const k = (r as any).zona_id
      if (!capSrcPerZona.has(k)) capSrcPerZona.set(k, [])
      capSrcPerZona.get(k)!.push(r)
    }
  }

  const { data: zoneMiei } = await admin.from('zone').select('id,nome').eq('master_id', masterAcquirente).eq('corriere_id', corriereAcquirente)
  const mappaZonaMio = new Map((zoneMiei || []).map((z: any) => [(z.nome || '').trim().toLowerCase(), z.id]))
  const capMieiPerZona = new Map<string, any[]>()
  {
    const idsMiei = (zoneMiei || []).map((z: any) => z.id)
    if (idsMiei.length) {
      const tutti = await fetchAll(() => admin.from('zone_cap').select('zona_id,paese,provincia,cap,citta').in('zona_id', idsMiei).order('id', { ascending: true }))
      for (const r of tutti) {
        const k = (r as any).zona_id
        if (!capMieiPerZona.has(k)) capMieiPerZona.set(k, [])
        capMieiPerZona.get(k)!.push(r)
      }
    }
  }
  const impronta = (caps: any[]) => caps.map((c: any) => `${c.paese || ''}|${c.provincia || ''}|${c.cap || ''}|${c.citta || ''}`).sort().join('\n')

  const mapZona = new Map<string, string>()   // zona venditore → zona compratore
  const lavoriCap: Array<() => Promise<void>> = []
  for (const z of (zoneSrc || [])) {
    const key = (z.nome || '').trim().toLowerCase()
    let subZid = mappaZonaMio.get(key) as string | undefined
    if (!subZid) {
      const { data: nuovaZ } = await admin.from('zone').insert({
        master_id: masterAcquirente, corriere_id: corriereAcquirente,
        nome: z.nome, descrizione: z.descrizione, con_fuel: z.con_fuel || false, su_mittente: !!(z as any).su_mittente,
      }).select('id').single()
      subZid = (nuovaZ as any)?.id
      if (subZid) mappaZonaMio.set(key, subZid)
    } else {
      await admin.from('zone').update({ su_mittente: !!(z as any).su_mittente, con_fuel: z.con_fuel || false }).eq('id', subZid)
    }
    if (subZid) {
      const zid = subZid
      const caps = capSrcPerZona.get(z.id) || []
      if (impronta(caps) !== impronta(capMieiPerZona.get(zid) || [])) {
        lavoriCap.push(async () => {
          await admin.from('zone_cap').delete().eq('zona_id', zid)
          for (let i = 0; i < caps.length; i += 1000) {
            await admin.from('zone_cap').insert(caps.slice(i, i + 1000).map((cp: any) => ({ zona_id: zid, paese: cp.paese, provincia: cp.provincia, cap: cp.cap, citta: cp.citta })))
          }
        })
      }
      mapZona.set(z.id, zid)
    }
  }
  for (let i = 0; i < lavoriCap.length; i += 6) await Promise.all(lavoriCap.slice(i, i + 6).map(fn => fn()))

  // ── LISTINO CORRIERE del compratore per QUESTO corriere (uno suo, altrimenti si crea) + link. ──────
  let { data: listino } = await admin.from('listini_corrieri').select('id').eq('master_id', masterAcquirente).eq('corriere_id', corriereAcquirente).maybeSingle()
  if (!listino?.id) {
    const { data: co } = await admin.from('corrieri').select('nome_contratto').eq('id', corriereAcquirente).maybeSingle()
    const { data: nl, error: eNl } = await admin.from('listini_corrieri').insert({
      master_id: masterAcquirente, corriere_id: corriereAcquirente,
      nome: (co as any)?.nome_contratto || listinoSrc?.nome || 'Listino Corrieri',
      fattore_volume: fattore, solo_peso_reale: soloPesoR, attivo: true,
    }).select('id').single()
    if (eNl) return { ok: false, reason: 'creazione listino: ' + eNl.message }
    listino = nl
  } else {
    await admin.from('listini_corrieri').update({ fattore_volume: fattore, solo_peso_reale: soloPesoR }).eq('id', listino.id)
  }
  const listinoId = listino!.id as string

  const { data: linkEsist } = await admin.from('listini_corrieri_corrieri').select('corriere_id').eq('listino_id', listinoId).eq('corriere_id', corriereAcquirente).maybeSingle()
  if (!linkEsist) {
    await admin.from('listini_corrieri_corrieri').insert({ listino_id: listinoId, corriere_id: corriereAcquirente, fattore_volume: fattore })
  } else {
    await admin.from('listini_corrieri_corrieri').update({ fattore_volume: fattore }).eq('listino_id', listinoId).eq('corriere_id', corriereAcquirente)
  }

  // ── FASCE (W) — idempotente: pulisco e reinserisco quelle di QUESTO corriere su QUESTO listino. ────
  const fasceIns = fasceSrc
    .map((f: any) => ({ listino_id: listinoId, corriere_id: corriereAcquirente, zona_id: mapZona.get(f.zona_id) || null, peso_min: 0, peso_max: f.peso_max, prezzo: f.prezzo, tipo: f.tipo, fuel: Number(f.fuel) || 0 }))
    .filter((f: any) => f.zona_id)
  const scartate = fasceSrc.length - fasceIns.length
  const rif = `${corriereVenditore}->${corriereAcquirente}`
  if (scartate > 0) console.error('[condivisione-propaga]', rif, ':', scartate, 'fasce scartate per ZONA non mappata (prezzi persi)')
  if (fasceIns.length) {
    await admin.from('listini_corrieri_fasce').delete().eq('listino_id', listinoId).eq('corriere_id', corriereAcquirente)
    for (let i = 0; i < fasceIns.length; i += 1000) {
      const { error } = await admin.from('listini_corrieri_fasce').insert(fasceIns.slice(i, i + 1000))
      if (error) throw new Error('insert fasce condivisione ' + rif + ': ' + (error.message || error))
    }
  } else {
    // fasceSrc è non vuoto (return anticipato sopra): 0 mappate = anomalia zone, NON azzero.
    console.error('[condivisione-propaga]', rif, ': 0 fasce mappate da', fasceSrc.length, '— anomalia zone, non azzero')
    return { ok: false, reason: 'nessuna fascia mappata (zone non risolte)' }
  }

  // ── SUPPLEMENTI (contrassegno/assicurazione/… = parte di W) — idempotente. ─────────────────────────
  await admin.from('listini_corrieri_supplementi').delete().eq('listino_id', listinoId).eq('corriere_id', corriereAcquirente)
  const supplIns = (supplSrc || []).map((s: any) => ({ listino_id: listinoId, corriere_id: corriereAcquirente, tipo: s.tipo, nome: s.nome, valore: s.valore, tipo_calcolo: s.tipo_calcolo, descrizione: s.descrizione }))
  if (supplIns.length) await admin.from('listini_corrieri_supplementi').insert(supplIns)

  return { ok: true, zone: mapZona.size, fasce: fasceIns.length }
}
