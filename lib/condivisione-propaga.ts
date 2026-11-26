import { fetchAll, fetchAllStretto } from '@/lib/fetch-all'
import { abbinaZone } from '@/lib/zone-catena'

/* PROPAGAZIONE DEL COSTO DI UNA CONDIVISIONE (CONDIVISIONE-CONTRATTI.md, Fase 4).
 *
 * Quando un master riceve il contratto di un altro (corriere tipo='moovexpress', condiviso dal venditore
 * con l'Assegna del listino, lib/condivisione-engine.ts), il COSTO che paga (il listino d'ingrosso del
 * venditore, = W) e le ZONE del contratto devono comparire sul SUO portale, sul corriere appena
 * materializzato — altrimenti "Listino Corrieri" e "Gestione Zone" sono vuoti e il
 * compratore non sa quanto paga né può costruirci sopra il listino clienti. È lo stesso effetto della
 * cascata padre→figlio (copiaListinoAlSottoMaster), ma qui la sorgente è OLTRE il ponte API: il listino
 * d'ingrosso è un `listini_clienti` sotto il VENDITORE, agganciato al cliente-ledger e al CORRIERE DEL
 * VENDITORE; il corriere di destinazione esiste già (NON si accoppia per nome, non si cammina l'albero).
 *
 * Copia (idempotente, come la cascata): fasce del listino d'ingrosso (W) → listini_corrieri_fasce del compratore;
 * + listino_corriere, link con fattore volume, supplementi. Le ZONE non le copia più il codice: le tiene uguali il
 * database (scripts/zone-catena-trigger.sql, 26/11/2026), TUTTE anche senza prezzo — una zona senza prezzo rende il
 * corriere NON vendibile lì, esattamente ciò che deve essere finché il compratore non decide il suo prezzo.
 *
 * Il costo VERO addebitato alla spedizione resta `ris.prezzo` dall'/api/v1 del venditore (autorevole, nessun
 * disallineamento): questa copia serve a VISIBILITÀ, base del margine nell'editor e risoluzione zona a CAP.
 */
/* Cuore della propagazione, con parametri ESPLICITI (lo usa la condivisione per listino assegnato:
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

  const { data: listinoSrc } = await admin.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale,agevolazione_isole').eq('id', listinoIngrosso).single()
  // Fattore volume per-corriere del venditore (se impostato): va copiato o il costo stimato diverge.
  const { data: pcSrc } = await admin.from('listini_clienti_corrieri').select('fattore_volume').eq('listino_id', listinoIngrosso).eq('corriere_id', corriereVenditore).maybeSingle()
  const fattore = Number((pcSrc as any)?.fattore_volume) || Number(listinoSrc?.fattore_volume) || 5000
  const soloPesoR = !!listinoSrc?.solo_peso_reale
  const agevIsole = !!listinoSrc?.agevolazione_isole   // come nella copia al sotto-master

  // ── ZONE: le tiene il DATABASE (scripts/zone-catena-trigger.sql, 26/11/2026). Il ponte del compratore compra dal
  // corriere del venditore (fornitore_corriere_id = corriereVenditore, 24 su 24 il 26/11): nasce con le sue zone e
  // le riceve a ogni modifica. Qui si leggono e si abbinano per chiave intera (nome, multicollo, partenza), per
  // copiare le fasce. Prima qui si creavano e riscrivevano, abbinando per solo NOME. ─────────────────────────────
  let zoneSrc: any[], zoneMiei: any[]
  try {
    zoneSrc = await fetchAllStretto(() => admin.from('zone').select('id,nome,multicollo,su_mittente,corriere_id').eq('corriere_id', corriereVenditore).order('id', { ascending: true }))
    zoneMiei = await fetchAllStretto(() => admin.from('zone').select('id,nome,multicollo,su_mittente,corriere_id').eq('corriere_id', corriereAcquirente).order('id', { ascending: true }))
  } catch (e: any) {
    return { ok: false, reason: 'zone non leggibili: ' + (e?.message || e) }
  }
  const { mappa: mapZona, mancanti } = abbinaZone(zoneSrc, zoneMiei, () => corriereAcquirente)
  // Una zona del venditore che il ponte non ha: il ponte non compra (più) da questo corriere, o il trigger non ha
  // fatto il suo lavoro. Le fasce di quella zona andrebbero perse: non si tocca niente e lo si dice.
  if (mancanti.length) {
    console.error('[condivisione-propaga]', `${corriereVenditore}->${corriereAcquirente}`, ': zone del venditore assenti sul ponte:', mancanti.join(', '))
    return { ok: false, reason: `zone del venditore assenti sul contratto del compratore (${mancanti.join(', ')})` }
  }

  // ── LISTINO CORRIERE del compratore per QUESTO corriere (uno suo, altrimenti si crea) + link. ──────
  let { data: listino } = await admin.from('listini_corrieri').select('id').eq('master_id', masterAcquirente).eq('corriere_id', corriereAcquirente).maybeSingle()
  if (!listino?.id) {
    const { data: co } = await admin.from('corrieri').select('nome_contratto').eq('id', corriereAcquirente).maybeSingle()
    const { data: nl, error: eNl } = await admin.from('listini_corrieri').insert({
      master_id: masterAcquirente, corriere_id: corriereAcquirente,
      nome: (co as any)?.nome_contratto || listinoSrc?.nome || 'Listino Corrieri',
      fattore_volume: fattore, solo_peso_reale: soloPesoR, agevolazione_isole: agevIsole, attivo: true,
    }).select('id').single()
    if (eNl) return { ok: false, reason: 'creazione listino: ' + eNl.message }
    listino = nl
  } else {
    await admin.from('listini_corrieri').update({ fattore_volume: fattore, solo_peso_reale: soloPesoR, agevolazione_isole: agevIsole }).eq('id', listino.id)
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
