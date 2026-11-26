import { costruisciCatena } from '@/lib/cascata'
import { colliDichiarati } from '@/lib/ripesature-calcolo'
import { inizioGiornoRomaISO, fineGiornoRomaISO, giorniFaRoma } from '@/lib/date-roma'

// MULTIEXPRESS SOTTO COSTO, PACCO PER PACCO, OGNI MATTINA SUL GIORNO PRIMA.
//
// Dal 10 al 26/11/2026 MULTIEXPRESS (detentore dei contratti di rete) e' andata sotto su ~230 pacchi, e nessun
// errore l'ha detto: lo si e' visto solo misurando a mano. Le guardie messe il 26/11 fermano le destinazioni
// speciali e il supplemento remoto UPS, ma non un RINCARO del corriere sulle zone normali: il 19/11 pomeriggio
// il supplemento isole di BRT Express e' passato da 1,10 a 1,30 € e MULTI ha pagato 5,89 pacchi che rivendeva a
// 5,86 (Ecomize) e 5,88 (GTS) per una settimana. Pochi centesimi a pacco: proprio per questo nessuno se ne accorge.
// Qui si rifa' ogni mattina la stessa misura e la si mette nella mail della Sentinella. Si avvisa, non si blocca:
// fermare le spedizioni per un centesimo bloccherebbe vendite buone (scelta di Lorenzo del 26/11).
//
// LA MISURA (la stessa verificata a mano il 26/11 su 230 pacchi):
//  - pacchi = le LDV su cui MULTI ha un costo nel giorno: riga a suo carico (master_target = MULTI) oppure riga
//    del suo conto all'ingrosso presso un altro detentore (corrieri_condivisi.cliente_ledger_id). Le gambe della
//    condivisione si legano col riferimento (= LDV) e, per ricontrollare, con il numero della spedizione.
//  - MULTI incassa: dai suoi clienti, dai master a cui vende fuori albero, e dai figli diretti (la loro riga di
//    costo su conto 'rete'). MULTI paga: le righe a suo carico + quelle del conto all'ingrosso.
//  - Solo spedizione e rimborso. Le rettifiche hanno il loro giro e i loro controlli; le annullate si saltano (contate).
//  - IL REGISTRO NON E' IL COSTO VERO: il detentore paga max(suo listino, costo del corriere). Dove il suo listino
//    e' piu' alto del corriere la perdita e' solo sul registro (Fonni 050104153020246: registro 160,33, corriere
//    92,25, incassati 111,72): non e' un allarme, si conta a parte. Il costo vero e' il preventivo del corriere
//    salvato sulla spedizione, preso solo sui contratti a preventivo esterno (PREVENTIVO_ESTERNO) e solo quando e'
//    PIU' BASSO del registro (se e' piu' alto non e' stato lui a fare il prezzo, e non ci si fida).
//  - Una spedizione che MULTI fa per se' (nessuno sotto che paga) non e' una perdita: paga il suo pacco.
//
// IL MOTIVO si chiede alla stessa funzione che fa gli addebiti (costruisciCatena), con il pacco com'era dichiarato:
//  - oggi la stessa spedizione renderebbe a MULTI almeno il costo → GIA' CORRETTO (zone o prezzi sistemati dopo);
//  - il corriere costa piu' del listino di costo di MULTI → RINCARO o supplemento che le zone non prevedono:
//    va corretto il listino di MULTI o la zona (e' il caso del 19/11);
//  - altrimenti MULTI rivende a chi sta sotto meno di quanto le costa → prezzo di vendita di MULTI sotto costo.
// Sola lettura: nessun movimento, nessun prezzo toccato.

export const MULTIEXPRESS_ID = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
// Si salta solo l'annullata. Un annullo in corso (pending/manuale) non e' detto che vada a buon fine: il pacco si
// misura e la riga lo dice.
const IN_ANNULLO = new Set(['annullamento_pending', 'annullamento_manuale'])
// Solo dove il costo salvato sulla spedizione e' davvero il preventivo del corriere. Sui contratti diretti (GLS, BRT,
// Poste, UPS LOGIXIA, InPost…) e sull'interno `costo_spedizione` e' il prezzo del master che spedisce, non un costo
// (crea/route.ts, "costoCorrente qui e' il prezzo del master DIRETTO"): preso come costo vero, una perdita vera di
// MULTI su un pacco di GTS (paga 3,75, MULTI 7,60) diventerebbe "solo sul registro", senza allarme.
const PREVENTIVO_ESTERNO = new Set(['spediamopro', 'spedisci', 'easyparcel'])
// La trattenuta del credito alla creazione (PRENOTAZIONE:<id>) e la sua restituzione quando la spedizione non nasce
// (STORNO-PRENOTAZIONE:<id>) hanno riferimenti diversi: prese da sole sembrano perdite senza spedizione (fino a 55 al
// giorno sul conto all'ingrosso, 25/11). Si contano insieme, sotto la stessa chiave.
const chiaveRif = (r: unknown) => { const t = String(r ?? ''); return t.startsWith('STORNO-PRENOTAZIONE:') ? t.slice('STORNO-'.length) : t }

// Il numero delle gambe della condivisione e' quello di partenza + "-" + 8 cifre esadecimali del conto (282343J116032-1d6ac50d).
// Un numero provvisorio (TMP-27194832) NON va spezzato: diventerebbe "TMP" e fonderebbe tutti i provvisori del giorno.
function ldvDi(numero: unknown): string {
  const n = String(numero || '')
  const base = n.replace(/-[0-9a-f]{8}$/i, '')
  return /^TMP$/i.test(base) ? n : base
}
const SOGLIA = 0.005            // sotto mezzo centesimo e' arrotondamento, non perdita
const r2 = (n: number) => Math.round(n * 100) / 100

export type MotivoPerdita = 'gia_corretto' | 'rincaro' | 'sotto_costo' | 'non_vendibile' | 'ingrosso' | 'senza_incasso' | 'non_ricalcolabile'
export type PerditaMulti = {
  ldv: string; contratto: string; chi: string; dest: string
  incassa: number; paga: number; costoVero: number; margine: number; ingrosso: boolean
  motivo: MotivoPerdita; spiegazione: string
}
export type MisuraPerditeMulti = {
  giorno: string; pacchi: number; perdite: PerditaMulti[]; totale: number
  soloRegistro: number; soloRegistroEur: number; proprie: number; annullate: number; nonAnalizzate: number
  senzaSpedizione: number   // sospetti le cui righe non portano a nessuna spedizione: non verificabili
  // quanto e' costata la misura (per la Sentinella, che ha due minuti in tutto)
  durataLetturaMs: number; ricalcoli: number; durataMs: number
}

type Mov = { riferimento: string | null; spedizione_id: string | null; master_id: string | null; master_target_id: string | null; cliente_id: string | null; importo: number; tipo: string; conto: string | null }
const COLONNE_MOV = 'riferimento,spedizione_id,master_id,master_target_id,cliente_id,importo,tipo,conto'

// Tutte le pagine di una lettura (1000 righe per volta, ordine fisso o le pagine si accavallano).
async function tutte<T = any>(q: () => any): Promise<T[]> {
  const out: T[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await q().order('id', { ascending: true }).range(da, da + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}
// A pezzi, sei alla volta: le liste di id/riferimenti vanno nell'URL.
async function aPezzi<T>(valori: string[], dim: number, f: (pezzo: string[]) => Promise<T[]>): Promise<T[]> {
  const pezzi: string[][] = []
  for (let i = 0; i < valori.length; i += dim) pezzi.push(valori.slice(i, i + dim))
  const out: T[] = []
  for (let i = 0; i < pezzi.length; i += 6) for (const r of await Promise.all(pezzi.slice(i, i + 6).map(f))) out.push(...r)
  return out
}

// Ricavo e costo di MULTI su un insieme di righe (le regole della misura del 26/11).
function contaRighe(righe: Mov[], figli: Set<string>, ledger: Set<string>) {
  let incassa = 0, paga = 0, ingrosso = false
  const chi = new Set<string>()
  for (const m of righe) {
    const imp = -Number(m.importo || 0)
    if (m.master_id === MULTIEXPRESS_ID && m.cliente_id) { incassa += imp; chi.add('c:' + m.cliente_id) }
    else if (m.master_id === MULTIEXPRESS_ID && m.master_target_id && m.master_target_id !== MULTIEXPRESS_ID) { incassa += imp; chi.add('m:' + m.master_target_id) }
    else if (!m.cliente_id && m.master_target_id && m.master_target_id === m.master_id && figli.has(m.master_id) && m.conto === 'rete') { incassa += imp; chi.add('m:' + m.master_id) }
    if (m.master_target_id === MULTIEXPRESS_ID && !m.cliente_id) paga += imp
    else if (m.cliente_id && ledger.has(m.cliente_id)) { paga += imp; ingrosso = true }
  }
  return { incassa: r2(incassa), paga: r2(paga), ingrosso, chi: [...chi] }
}

export async function misuraPerditeMulti(admin: any, giorno: string, opt: { maxRicalcoli?: number; tempoMaxMs?: number } = {}): Promise<MisuraPerditeMulti> {
  const t0 = Date.now()
  const dal = inizioGiornoRomaISO(giorno), al = fineGiornoRomaISO(giorno)

  const { data: ms, error: em } = await admin.from('masters').select('id,nome,parent_master_id')
  if (em) throw new Error('master non leggibili: ' + em.message)
  const nomeMaster = new Map<string, string>((ms || []).map((m: any) => [m.id, m.nome || '—']))
  const figli = new Set<string>((ms || []).filter((m: any) => m.parent_master_id === MULTIEXPRESS_ID).map((m: any) => m.id))
  const { data: cc, error: ec } = await admin.from('corrieri_condivisi').select('cliente_ledger_id').eq('master_id', MULTIEXPRESS_ID).not('cliente_ledger_id', 'is', null)
  if (ec) throw new Error('condivisioni non leggibili: ' + ec.message)
  const ledger = new Set<string>((cc || []).map((c: any) => c.cliente_ledger_id))

  // 1) le righe del giorno che contano per MULTI, quattro letture sugli indici per data, in parallelo: quello che
  //    paga (a suo carico e sul conto all'ingrosso), quello che incassa (da suoi clienti e da chi compra da lei)
  //    e il costo dei figli diretti, che e' il suo incasso. Leggere per riferimento tutte le righe di ogni LDV
  //    erano ~80 richieste e fino a 49 s col database carico (26/11 pomeriggio): troppo per la Sentinella.
  const TIPI = ['spedizione', 'rimborso']
  const nelGiorno = (q: any) => q.select('id,' + COLONNE_MOV).in('tipo', TIPI).gte('created_at', dal).lte('created_at', al)
  const [costi, ingrosso, vendite, figliPagano] = await Promise.all([
    tutte<Mov>(() => nelGiorno(admin.from('movimenti')).eq('master_target_id', MULTIEXPRESS_ID)),
    ledger.size ? tutte<Mov>(() => nelGiorno(admin.from('movimenti')).in('cliente_id', [...ledger])) : Promise.resolve([] as Mov[]),
    tutte<Mov>(() => nelGiorno(admin.from('movimenti')).eq('master_id', MULTIEXPRESS_ID)),
    figli.size ? tutte<Mov>(() => nelGiorno(admin.from('movimenti')).in('master_target_id', [...figli]).is('cliente_id', null).eq('conto', 'rete')) : Promise.resolve([] as Mov[]),
  ])
  // pacchi = le LDV su cui MULTI ha un costo nel giorno
  const riferimenti = new Set([...costi, ...ingrosso].filter(m => m.tipo === 'spedizione' && m.riferimento).map(m => chiaveRif(m.riferimento)))

  // 2) un primo conto per riferimento (stesso pacco = stesso riferimento, gambe della condivisione comprese)
  const perRif = new Map<string, Mov[]>()
  const visti = new Set<any>()
  for (const m of [...costi, ...ingrosso, ...vendite, ...figliPagano] as any[]) {
    if (visti.has(m.id)) continue
    visti.add(m.id)
    const k = chiaveRif(m.riferimento)
    if (!riferimenti.has(k)) continue
    const a = perRif.get(k); if (a) a.push(m); else perRif.set(k, [m])
  }
  const sospetti: string[] = []
  for (const [rif, rr] of perRif) { const c = contaRighe(rr, figli, ledger); if (c.incassa - c.paga < -SOGLIA) sospetti.push(rif) }

  // 3) i sospetti si ricontano legando le righe per SPEDIZIONE (un riferimento provvisorio TMP- rimasto su una
  //    sola riga spezzerebbe il pacco in due) e raggruppando per numero, come nella misura a mano.
  const idSospetti = [...new Set(sospetti.flatMap(r => (perRif.get(r) || []).map(m => m.spedizione_id).filter(Boolean)))] as string[]
  // Sospetti senza spedizione: si rileggono le righe di quella chiave in qualunque giorno (la restituzione di una
  // trattenuta puo' cadere dopo mezzanotte). Restano solo quelli ancora sotto: credito trattenuto e mai reso, o righe
  // che non portano a nessun pacco. Non verificabili, quindi da guardare.
  let senzaSpedizione = 0
  for (const r of sospetti.filter(r => !(perRif.get(r) || []).some(m => m.spedizione_id))) {
    const chiavi = r.startsWith('PRENOTAZIONE:') ? [r, 'STORNO-' + r] : [r]
    const tutteLeRighe = await tutte<Mov>(() => admin.from('movimenti').select('id,' + COLONNE_MOV).in('riferimento', chiavi).in('tipo', ['spedizione', 'rimborso']))
    const c = contaRighe(tutteLeRighe, figli, ledger)
    if (c.incassa - c.paga < -SOGLIA) senzaSpedizione++
  }
  const COLONNE_SPED = 'id,numero,stato,master_id,cliente_id,corriere_id,created_at,dest_cap,dest_citta,dest_provincia,dest_paese,mitt_cap,mitt_provincia,colli,peso_reale,lunghezza,larghezza,altezza,contrassegno,assicurazione,costo_spedizione,servizi_accessori'
  // Senza colli_dettaglio: su alcune SDA EXPRESS L a 10 colli pesa 27,8 MB a spedizione (282343J127568, 26/11) e
  // una lettura di 40 spedizioni durava fino a 26 s. Il dettaglio si legge dopo, solo per chi va ricalcolato.
  const sped = await aPezzi<any>(idSospetti, 40, async pezzo => { const { data, error } = await admin.from('spedizioni').select(COLONNE_SPED).in('id', pezzo); if (error) throw new Error(error.message); return data || [] })
  const spedDi = new Map<string, any>(sped.map(s => [s.id, s]))
  const righeSosp = await aPezzi<Mov>(idSospetti, 40, pezzo => tutte<Mov>(() => admin.from('movimenti').select('id,' + COLONNE_MOV).in('spedizione_id', pezzo).in('tipo', ['spedizione', 'rimborso'])))
  const perLdv = new Map<string, Mov[]>()
  for (const m of righeSosp) {
    const s = spedDi.get(String(m.spedizione_id)); if (!s) continue
    const ldv = ldvDi(s.numero)
    const a = perLdv.get(ldv); if (a) a.push(m); else perLdv.set(ldv, [m])
  }

  const nomiClienti = new Map<string, string>()
  const idClienti = [...new Set(righeSosp.filter(m => m.master_id === MULTIEXPRESS_ID && m.cliente_id).map(m => String(m.cliente_id)))]
  for (const c of await aPezzi<any>(idClienti, 100, async pezzo => { const { data, error } = await admin.from('clienti').select('id,ragione_sociale').in('id', pezzo); if (error) throw new Error('clienti non leggibili: ' + error.message); return data || [] })) {
    nomiClienti.set(c.id, c.ragione_sociale || 'cliente')
  }
  const nomeChi = (k: string) => k.startsWith('c:') ? `cliente ${nomiClienti.get(k.slice(2)) || ''}`.trim() : (nomeMaster.get(k.slice(2)) || '—')

  const contratti = new Map<string, any>()
  const contratto = async (id: string | null) => {
    if (!id) return null
    if (!contratti.has(id)) {
      const { data, error } = await admin.from('corrieri').select('master_id,nome_contratto,tipo').eq('id', id).maybeSingle()
      if (error) throw new Error('contratti non leggibili: ' + error.message)
      contratti.set(id, data || null)
    }
    return contratti.get(id)
  }

  const durataLetturaMs = Date.now() - t0
  let soloRegistro = 0, soloRegistroEur = 0, proprie = 0, annullate = 0, nonAnalizzate = 0
  const perdite: PerditaMulti[] = []
  // Il motivo si chiede alla catena dopo, per tutti insieme: qui si segna solo chi ne ha bisogno.
  const daRicalcolare = new Map<string, { orig: any; corr: any; incassa: number; costoVero: number; perdite: PerditaMulti[] }>()
  let ricalcoli = 0
  const maxRicalcoli = opt.maxRicalcoli ?? 60, tempoMax = opt.tempoMaxMs ?? 45000

  // La gamba che porta il costo di MULTI: li' c'e' il preventivo del corriere.
  const gambaDelCosto = (rr: Mov[]) => rr.find(m => m.master_target_id === MULTIEXPRESS_ID && !m.cliente_id && m.tipo === 'spedizione')?.spedizione_id || null
  // Il preventivo sta dentro la risposta salvata del corriere, un campo grosso (c'e' anche l'etichetta): leggerlo
  // per tutti i sospetti costava fino a 35 s (26/11). Si legge solo per i pacchi davvero sotto sul registro.
  const idCosto = [...perLdv.values()].filter(rr => { const c = contaRighe(rr, figli, ledger); return c.incassa - c.paga < -SOGLIA }).map(gambaDelCosto).filter(Boolean) as string[]
  const totDi = new Map<string, number>()
  for (const r of await aPezzi<any>([...new Set(idCosto)], 50, async pezzo => { const { data, error } = await admin.from('spedizioni').select('id,tot:raw_response->raw->data->>totalPrice').in('id', pezzo); if (error) throw new Error(error.message); return data || [] })) {
    if (r.tot != null && Number(r.tot) > 0) totDi.set(r.id, Number(r.tot) / 100)
  }

  for (const [ldv, rr] of perLdv) {
    const gambe = [...new Set(rr.map(m => String(m.spedizione_id)))].map(id => spedDi.get(id)).filter(Boolean)
    if (gambe.some(s => s.stato === 'annullata')) { annullate++; continue }
    const inAnnullo = gambe.some(s => IN_ANNULLO.has(s.stato))
    const c = contaRighe(rr, figli, ledger)
    if (c.incassa - c.paga >= -SOGLIA) continue
    const orig = gambe.find(s => s.numero === ldv) || gambe[0]
    // Il pacco che MULTI spedisce per se': nessuno sotto paga, non e' una perdita. Sui contratti comprati
    // all'ingrosso la gamba di partenza di MULTI non ha movimenti (paga solo la gamba del fornitore: 282343J124704,
    // 25/11), quindi non e' fra le gambe lette sopra e va cercata per numero.
    if (c.incassa === 0) {
      let partenza = gambe.find(s => s.numero === ldv)
      if (!partenza) {
        const { data, error } = await admin.from('spedizioni').select('master_id,cliente_id').eq('numero', ldv).maybeSingle()
        if (error) throw new Error('spedizione di partenza non leggibile: ' + error.message)
        partenza = data
      }
      if (partenza?.master_id === MULTIEXPRESS_ID && !partenza?.cliente_id) { proprie++; continue }
    }
    // Costo vero: il preventivo del corriere sulla gamba che porta il costo di MULTI, solo se piu' basso del registro.
    const gambaCosto = spedDi.get(String(gambaDelCosto(rr))) || null
    const esterno = gambaCosto ? PREVENTIVO_ESTERNO.has(String((await contratto(gambaCosto.corriere_id))?.tipo || '')) : false
    const preventivo = gambaCosto && esterno ? (totDi.get(gambaCosto.id) ?? (gambaCosto.costo_spedizione != null ? Number(gambaCosto.costo_spedizione) : null)) : null
    const costoVero = c.ingrosso || preventivo == null || !(preventivo > 0) ? c.paga : r2(Math.min(c.paga, preventivo))
    const margine = r2(c.incassa - costoVero)
    if (margine >= -SOGLIA) { soloRegistro++; soloRegistroEur = r2(soloRegistroEur + c.incassa - c.paga); continue }

    const corr = await contratto(orig?.corriere_id || null)
    const chi = c.chi.map(nomeChi).join(' + ') || '—'
    const dest = `${orig?.dest_citta || ''}${orig?.dest_provincia ? ' (' + orig.dest_provincia + ')' : ''}${orig?.dest_paese && orig.dest_paese !== 'IT' && orig.dest_paese !== orig.dest_provincia ? ' ' + orig.dest_paese : ''}`.trim() || String(orig?.dest_cap || '')
    const p: PerditaMulti = { ldv, contratto: corr?.nome_contratto || (c.ingrosso ? 'all\'ingrosso' : '—'), chi, dest: dest + (inAnnullo ? ' (annullo in corso)' : ''), incassa: c.incassa, paga: c.paga, costoVero, margine, ingrosso: c.ingrosso, motivo: 'non_ricalcolabile', spiegazione: 'motivo non calcolato (contratto non trovato)' }
    perdite.push(p)
    if (c.incassa === 0) {
      p.motivo = 'senza_incasso'; p.spiegazione = 'nessun addebito a chi ha spedito: manca la riga di chi sta sotto'
    } else if (c.ingrosso) {
      p.motivo = 'ingrosso'; p.spiegazione = `comprato all'ingrosso a ${eur(c.paga)} e rivenduto a ${eur(c.incassa)}`
    } else if (corr && orig) {
      // Stessi numeri, stesso contratto, stesso compratore = stessa causa: si ricalcola una volta sola.
      // Con il CAP: due destinazioni con le stesse cifre possono stare oggi in zone diverse.
      const chiave = `${corr.nome_contratto}|${c.chi.join('+')}|${c.incassa}|${costoVero}|${orig.dest_paese || 'IT'}|${orig.dest_cap || ''}`
      const g = daRicalcolare.get(chiave)
      if (g) g.perdite.push(p); else daRicalcolare.set(chiave, { orig, corr, incassa: c.incassa, costoVero, perdite: [p] })
    }
  }

  // I motivi: ogni ricalcolo della catena costa qualche secondo, quindi sei alla volta, i gruppi piu' pesanti
  // per primi, e ci si ferma al tempo massimo (la Sentinella ha due minuti per tutto). Chi resta fuori lo dice.
  const gruppi = [...daRicalcolare.values()].sort((a, b) => b.perdite.reduce((t, p) => t - p.margine, 0) - a.perdite.reduce((t, p) => t - p.margine, 0))
  for (let i = 0; i < gruppi.length; i += 6) {
    if (ricalcoli >= maxRicalcoli || Date.now() - t0 > tempoMax) {
      for (const g of gruppi.slice(i)) for (const p of g.perdite) p.spiegazione = 'motivo non calcolato (troppi casi per un giro solo)'
      break
    }
    const blocco = gruppi.slice(i, i + 6)
    ricalcoli += blocco.length
    const esiti = await Promise.all(blocco.map(g => motivoDaCatena(admin, g.orig, g.corr, g.incassa, g.costoVero)))
    blocco.forEach((g, k) => { for (const p of g.perdite) { p.motivo = esiti[k].motivo; p.spiegazione = esiti[k].spiegazione } })
  }
  perdite.sort((a, b) => a.margine - b.margine)
  nonAnalizzate = perdite.filter(p => p.motivo === 'non_ricalcolabile').length
  return { giorno, pacchi: perRif.size, perdite, totale: r2(perdite.reduce((t, p) => t + p.margine, 0)), soloRegistro, soloRegistroEur, proprie, annullate, nonAnalizzate, senzaSpedizione, durataLetturaMs, ricalcoli, durataMs: Date.now() - t0 }
}

async function motivoDaCatena(admin: any, s: any, corr: any, incassa: number, costoVero: number): Promise<{ motivo: MotivoPerdita; spiegazione: string }> {
  try {
    // Il dettaglio dei colli solo qui e solo per le multicollo (vedi la lettura in blocco sopra).
    let conDettaglio = s
    if ((Number(s.colli) || 1) > 1) {
      const { data, error } = await admin.from('spedizioni').select('colli_dettaglio').eq('id', s.id).maybeSingle()
      if (error) return { motivo: 'non_ricalcolabile', spiegazione: `colli non leggibili: ${error.message}` }
      conDettaglio = { ...s, colli_dettaglio: (data as any)?.colli_dettaglio ?? null }
    }
    const packages = colliDichiarati(conDettaglio, null)
    if (!packages.length) return { motivo: 'non_ricalcolabile', spiegazione: 'colli del pacco non ricostruibili' }
    const { catena, errore } = await costruisciCatena(admin, {
      masterDirettoId: s.master_id, corriereOwnerId: corr.master_id, costoSpedizione: 0,
      provincia: s.dest_provincia || '', packages, cap: s.dest_cap || '', citta: s.dest_citta || '', paese: s.dest_paese || 'IT',
      corriereNome: corr.nome_contratto, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0),
      mittCap: s.mitt_cap || '', mittProvincia: s.mitt_provincia || '', mittPaese: 'IT',
      partenza: s.created_at || null, corrierePacco: s.corriere_id || null,
      // Gli accessori scelti (es. Exchange) stanno nel prezzo di ogni livello: senza, il listino di MULTI uscirebbe
      // piu' basso e la mail direbbe "rincaro" su un listino giusto.
      serviziAccessori: Array.isArray(s.servizi_accessori) ? s.servizi_accessori.map((x: any) => ({ nome: x?.nome })) : undefined,
    } as any)
    // "Nessuna tariffa" oggi puo' voler dire che quella spedizione non si crea piu' (zona aggiunta dopo e chi vende
    // non la prezza: 1ZGE70566831359007 Polonia, 24/11) ma anche che una lettura del listino e' fallita (le funzioni di
    // prezzo rispondono null anche sull'errore). Non e' un "gia' corretto": resta da guardare.
    if (errore && /nessuna tariffa/i.test(errore)) return { motivo: 'non_vendibile', spiegazione: `oggi la catena non dà un prezzo (${errore}): se quella destinazione è stata esclusa apposta è già corretto, altrimenti va guardato` }
    if (errore) return { motivo: 'non_ricalcolabile', spiegazione: `oggi la catena non si calcola: ${errore}` }
    const i = catena.findIndex(l => l.isProprietario)
    if (i < 0 || catena[i].masterId !== MULTIEXPRESS_ID) return { motivo: 'non_ricalcolabile', spiegazione: 'MULTIEXPRESS non risulta detentore del contratto' }
    const listino = r2(Number(catena[i].prezzo))
    const zona = catena[i].zona ? ` (zona ${catena[i].zona})` : ''
    const oggi = i > 0 ? r2(Number(catena[i - 1].prezzo)) : null
    if (oggi != null && oggi >= costoVero - SOGLIA) {
      return { motivo: 'gia_corretto', spiegazione: `oggi la stessa spedizione renderebbe a MULTI ${eur(oggi)}${zona}` }
    }
    if (costoVero > listino + 0.05) {
      return { motivo: 'rincaro', spiegazione: `il corriere fa pagare ${eur(costoVero)}, il listino di costo di MULTI dice ${eur(listino)}${zona}: rincaro o supplemento che le zone non prevedono` }
    }
    return { motivo: 'sotto_costo', spiegazione: `MULTI rivende a ${eur(incassa)} ma le costa ${eur(costoVero)}${zona}${oggi != null ? `, e oggi renderebbe ${eur(oggi)}` : ''}: prezzo di vendita sotto costo` }
  } catch (e: any) {
    return { motivo: 'non_ricalcolabile', spiegazione: `ricalcolo non riuscito: ${String(e?.message || e).slice(0, 80)}` }
  }
}

function eur(n: number): string {
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/^-/, '−') + ' €'
}
const esc = (t: string) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

// Le righe per la mail della Sentinella. Le perdite si raggruppano per contratto, compratore e motivo: il rincaro
// del 19/11 erano decine di pacchi identici, che riga per riga non si leggono e raggruppati diventano una riga sola.
export function righeSentinellaPerditeMulti(m: MisuraPerditeMulti) {
  const area = 'margine MULTIEXPRESS'
  const quando = m.giorno.split('-').reverse().slice(0, 2).join('/')
  const gruppi = new Map<string, { contratto: string; chi: string; motivo: MotivoPerdita; n: number; tot: number; es: PerditaMulti }>()
  for (const p of m.perdite) {
    const k = `${p.contratto}|${p.chi}|${p.motivo}`
    const g = gruppi.get(k)
    if (g) { g.n++; g.tot = r2(g.tot + p.margine) } else gruppi.set(k, { contratto: p.contratto, chi: p.chi, motivo: p.motivo, n: 1, tot: p.margine, es: p })
  }
  const ordinati = [...gruppi.values()].sort((a, b) => a.tot - b.tot)
  const daGuardare = m.perdite.filter(p => p.motivo !== 'gia_corretto')
  // In cima quello che va sistemato, un gruppo per blocco: chi, motivo, un esempio. I casi gia' corretti (zone o
  // prezzi sistemati dopo) stanno in fondo in una riga sola: sono successi, ma non c'e' niente da fare.
  const grigio = 'font-size:12px;color:#4b5563;line-height:1.5'
  const aperti = ordinati.filter(g => g.motivo !== 'gia_corretto')
  const corretti = ordinati.filter(g => g.motivo === 'gia_corretto')
  const blocchi = aperti.slice(0, 8).map(g =>
    `<div style="margin-top:10px;${grigio}"><b style="color:#1a1a1a">${esc(g.contratto)} · ${esc(g.chi)}</b> — ${g.n} ${g.n === 1 ? 'pacco' : 'pacchi'}, ${esc(eur(g.tot))}`
    + `<br>${esc(g.es.spiegazione)}`
    + `<br><span style="color:#9ca3af">es. ${esc(g.es.ldv)} · ${esc(g.es.dest)} · incassa ${esc(eur(g.es.incassa))}, costo ${esc(eur(g.es.costoVero))}</span></div>`,
  ).join('') + (aperti.length > 8 ? `<div style="margin-top:10px;${grigio}">… e altri ${aperti.length - 8} gruppi</div>` : '')
  const nCorr = corretti.reduce((t, g) => t + g.n, 0), totCorr = r2(corretti.reduce((t, g) => t + g.tot, 0))
  const giaCorretti = corretti.length
    ? `<div style="margin-top:10px;${grigio}"><b style="color:#1a1a1a">Già corretti</b> (oggi le stesse spedizioni rendono almeno il costo): ${nCorr} ${nCorr === 1 ? 'pacco' : 'pacchi'}, ${esc(eur(totCorr))} — `
      + corretti.map(g => `${esc(g.contratto)} · ${esc(g.chi)} (${g.n})`).join(', ') + '</div>'
    : ''

  const righe = [{
    area,
    controllo: m.perdite.length
      ? `MULTIEXPRESS sotto costo su ${m.perdite.length} ${m.perdite.length === 1 ? 'spedizione' : 'spedizioni'} del ${quando}: ${esc(eur(m.totale))}${daGuardare.length ? '' : ', tutte già corrette'}${blocchi}${giaCorretti}`
      : `MULTIEXPRESS sotto costo sulle spedizioni del ${quando}`,
    valore: m.perdite.length, atteso: '0', allarme: daGuardare.length > 0,
  }, {
    // Il silenzio e' un allarme: se un giorno non si misura niente, la misura si e' rotta.
    area, controllo: `spedizioni di MULTIEXPRESS misurate (${quando})`, valore: m.pacchi, atteso: 'più di 0', allarme: m.pacchi === 0,
  }]
  if (m.soloRegistro) righe.push({ area, controllo: `perdite solo sul registro (${quando}): il listino di costo di MULTI è sopra quanto chiede il corriere, ${esc(eur(m.soloRegistroEur))} sul registro`, valore: m.soloRegistro, atteso: 'informativa', allarme: false })
  if (m.nonAnalizzate) righe.push({ area, controllo: `pacchi in perdita senza motivo calcolato (${quando})`, valore: m.nonAnalizzate, atteso: 'informativa', allarme: false })
  // Non verificabili: le righe non portano a nessuna spedizione. Rosso, perche' non si sa se sono perdite.
  if (m.senzaSpedizione) righe.push({ area, controllo: `pacchi sotto costo sul registro senza spedizione collegata (${quando}): da guardare a mano`, valore: m.senzaSpedizione, atteso: '0', allarme: true })
  // Si contano anche gli esclusi: se un addebito a chi sta sotto non si scrive, il pacco sembra una spedizione propria
  // di MULTI. Un numero che salta da un giorno all'altro si vede qui.
  righe.push({ area, controllo: `spedizioni proprie di MULTIEXPRESS senza nessuno sotto, escluse (${quando})`, valore: m.proprie, atteso: 'informativa', allarme: false })
  righe.push({ area, controllo: `spedizioni sotto costo ma annullate, escluse (${quando})`, valore: m.annullate, atteso: 'informativa', allarme: false })
  return righe
}

// Per la Sentinella: il giorno di ieri, ora di Roma. `tempoMaxMs` lo decide la rotta, che sa quanto le resta.
export async function controlloPerditeMulti(admin: any, opt: { tempoMaxMs?: number } = {}) {
  return righeSentinellaPerditeMulti(await misuraPerditeMulti(admin, giorniFaRoma(1), opt))
}
