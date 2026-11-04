import { volumiDelLivello, type EsitoRipesatura } from '@/lib/ripesature-calcolo'

// CREA UNA RETTIFICA da una ripesatura gia' calcolata, per il master indicato: chi apre la rettifica
// verso il suo figlio diretto (il detentore del contratto; per SDA EXPRESS L Wave, dal 24/10/2026).
//
// E' la stessa logica del ramo ripesature dell'upload file ([app/api/rettifiche/upload/route.ts]),
// ridotta a una spedizione sola, per il flusso CONTINUO (auto da OneTracking). Due guardie di soldi:
//  - SOLO RECUPERI: liv.differenza = dovuto - pagato; se <= 0 e' un rimborso, non si crea (vedi
//    [app/api/rettifiche/route.ts]).
//  - ANTI-DOPPIO PER SPEDIZIONE (non per rif_fornitore): cosi' una rettifica creata da OneTracking
//    non si duplica quando poi si carica il file ufficiale di E&A (id fornitore diversi). Una sola
//    rettifica per spedizione A OGNI SCALINO, confermata o in attesa (vedi sotto).
export type EsitoCrea = { creata: boolean; rettificaId?: string; recupero?: number; motivo?: string }

// UNA RETTIFICA ANNULLATA NON OCCUPA IL POSTO. Il database tiene unico master_id + rif_fornitore sulle
// righe nate da un file (indice uniq_rettifica_rif_fornitore, origine_rettifica_id nulla): una riga
// annullata — addebito stornato perche' il file era falso, come i 3.706 di LOGIXIA del 12-16/10 — lo
// terrebbe occupato per sempre, e il file giusto della stessa spedizione verrebbe respinto come "gia'
// caricata". Se l'inserimento sbatte contro
// una riga annullata, quella cede il riferimento (resta nello storico, col suo id in coda) e si riprova
// una volta. Contro una riga viva il 23505 resta: e' il doppione vero.
export async function inserisciRettifica(admin: any, riga: any, select?: string): Promise<{ data: any; error: any }> {
  const prova = () => select ? admin.from('rettifiche').insert(riga).select(select).single() : admin.from('rettifiche').insert(riga)
  let res = await prova()
  if (res.error?.code === '23505' && riga.rif_fornitore) {
    const { data: annullate } = await admin.from('rettifiche').select('id')
      .eq('master_id', riga.master_id).eq('rif_fornitore', riga.rif_fornitore).eq('propagazione', 'annullata')
    if (annullate && annullate.length) {
      for (const a of annullate) {
        await admin.from('rettifiche').update({ rif_fornitore: `${riga.rif_fornitore}#annullata-${String(a.id).slice(0, 8)}` })
          .eq('id', a.id).eq('propagazione', 'annullata')
      }
      res = await prova()
    }
  }
  return { data: res.data ?? null, error: res.error ?? null }
}

// LA FATTURA DEL FORNITORE E' GIA' PAGATA? Per ogni riga del file la chiave e' RIPFORN-<riga>: fino al
// 22/10/2026 si registrava al caricamento, ora alla conferma. Un export cumulativo (E&A lo e') porta di
// nuovo righe gia' pagate da un caricamento precedente: quelle non vanno ripresentate come costo da
// confermare. Pagata = esiste una chiave (RIPFORN-x, -2, -3) senza il suo STORNO-; stornata del tutto =
// da pagare di nuovo (come chiaveLibera nella conferma). Torna l'insieme dei riferimenti gia' pagati.
export async function fattureGiaPagate(admin: any, rif: string[]): Promise<Set<string>> {
  const pagate = new Set<string>()
  const unici = Array.from(new Set(rif.filter(Boolean)))
  for (let i = 0; i < unici.length; i += 40) {
    const fetta = unici.slice(i, i + 40)
    const chiavi: string[] = []
    for (const r of fetta) for (const suf of ['', '-2', '-3']) { chiavi.push(`RIPFORN-${r}${suf}`, `STORNO-RIPFORN-${r}${suf}`) }
    const { data } = await admin.from('movimenti').select('riferimento').in('riferimento', chiavi)
    const ci = new Set(((data || []) as any[]).map(m => m.riferimento))
    for (const r of fetta) {
      if (['', '-2', '-3'].some(suf => ci.has(`RIPFORN-${r}${suf}`) && !ci.has(`STORNO-RIPFORN-${r}${suf}`))) pagate.add(r)
    }
  }
  return pagate
}

// IL COSTO DEL FORNITORE SU QUEL PACCO C'E' GIA'? fattureGiaPagate riconosce una riga di fattura solo se torna con lo
// STESSO riferimento (codice 6A..., numero di riga DVA). Un file di SOLI PESI porta gli stessi addebiti con la LDV come
// riferimento e il costo lo calcola il portale: il 04/11/2026 i file "RETTIFICHE SPEDIAMOPRO/DVA TUTTE 0411" di MULTI
// hanno creato 4.259 righe "solo a carico" su pacchi gia' pagati (4.788 € scritti due volte se confermate). Qui si guarda
// il PACCO: un costo gia' registrato a chi carica (RIPFORN-, al netto degli storni) o una sua riga viva che lo porta.
// soloRigheFattura: conta solo le righe con l'importo del fornitore (riferimento diverso dalla LDV); le righe di soli
// pesi in attesa si escluderebbero a vicenda alla conferma, e nessuna registrerebbe il costo.
export async function pacchiConCostoGia(admin: any, masterId: string, spedizioni: string[],
  opz: { escludiRiga?: string; soloRigheFattura?: boolean } = {}): Promise<Set<string>> {
  const con = new Set<string>()
  const ids = Array.from(new Set(spedizioni.filter(Boolean)))
  for (let i = 0; i < ids.length; i += 150) {
    const fetta = ids.slice(i, i + 150)
    const { data: mm, error: em } = await admin.from('movimenti').select('spedizione_id,riferimento')
      .in('spedizione_id', fetta).eq('tipo', 'rettifica').eq('master_target_id', masterId).is('cliente_id', null).like('riferimento', '%RIPFORN-%')
    if (em) throw new Error('costo gia registrato: ' + em.message)
    const netto = new Map<string, number>()
    for (const m of (mm || []) as any[]) netto.set(m.spedizione_id, (netto.get(m.spedizione_id) || 0) + (String(m.riferimento).startsWith('STORNO-') ? -1 : 1))
    for (const [s, n] of netto) if (n > 0) con.add(s)
    const { data: rr, error: er } = await admin.from('rettifiche').select('id,spedizione_id,numero_spedizione,rif_fornitore,propagazione')
      .in('spedizione_id', fetta).eq('master_id', masterId).gt('costo_fornitore', 0)
    if (er) throw new Error('costo gia portato da una riga: ' + er.message)
    for (const r of (rr || []) as any[]) {
      if (r.id === opz.escludiRiga || r.propagazione === 'annullata') continue
      if (opz.soloRigheFattura && (!r.rif_fornitore || r.rif_fornitore === r.numero_spedizione)) continue
      con.add(r.spedizione_id)
    }
  }
  return con
}

// LA STIMA DEL PORTALE CEDE ALLA FATTURA. E' l'ordine inverso di pacchiConCostoGia: prima si conferma la riga di un file
// di soli pesi (costo calcolato dal portale, chiave RIPFORN-<LDV>), poi quella col codice del fornitore sullo stesso pacco.
// Il 04/11/2026 alle 21:03 MULTI ha confermato verso sotto le righe "SPEDIAMOPRO TUTTE 0411 PARTE 3" (incassi giusti) e il
// portale ha registrato 117 stime, mentre le righe del file sovrapprezzi del 30/10 sugli stessi pacchi erano ancora in
// attesa: confermandole il costo sarebbe entrato due volte (1UW07WF391215: stima 0,95 + fattura 1,98, e il fornitore ha
// addebitato 1,98 una volta sola). Torna le stime ancora vive del pacco, da stornare quando la fattura e' registrata
// (lo sa chi chiama: l'ha appena scritta, o la sua chiave c'era gia'): decide l'importo del fornitore, non il portale.
export async function stimeDaSostituire(admin: any, masterId: string, spedizioneId: string, rifFattura: string):
  Promise<{ riferimento: string; importo: number }[]> {
  const { data: sp, error: es } = await admin.from('spedizioni').select('numero,tracking_number').eq('id', spedizioneId).maybeSingle()
  if (es) throw new Error('stime del portale: ' + es.message)
  const basi = [sp?.numero, sp?.tracking_number].filter(Boolean).map((x: string) => `RIPFORN-${x}`)
  // un riferimento uguale alla LDV non e' una fattura: e' la stima stessa
  if (!basi.length || basi.includes(`RIPFORN-${rifFattura}`)) return []
  const { data: mm, error: em } = await admin.from('movimenti').select('riferimento,importo')
    .eq('spedizione_id', spedizioneId).eq('tipo', 'rettifica').eq('master_target_id', masterId).is('cliente_id', null).like('riferimento', '%RIPFORN-%')
  if (em) throw new Error('stime del portale: ' + em.message)
  const vive = new Map<string, number>()
  const stornate = new Set<string>()
  for (const m of (mm || []) as any[]) {
    const k = String(m.riferimento)
    if (k.startsWith('STORNO-')) stornate.add(k.slice(7)); else vive.set(k, Number(m.importo))
  }
  for (const k of stornate) vive.delete(k)
  // stessa chiave o le sue successive -2…-9 (vedi chiaveLibera nella Conferma)
  const diBase = (k: string, b: string) => k === b || (k.startsWith(b + '-') && /^\d$/.test(k.slice(b.length + 1)))
  return [...vive].filter(([k]) => basi.some(b => diBase(k, b))).map(([riferimento, importo]) => ({ riferimento, importo }))
}

export async function creaRettificaDaEsito(
  admin: any, masterId: string, esito: EsitoRipesatura
): Promise<EsitoCrea> {
  if (!esito.trovata || !esito.spedizioneId) return { creata: false, motivo: 'spedizione non trovata' }

  const cat = esito.catenaDalBasso || []
  const mio = cat.indexOf(masterId)
  // "non sono nella catena" (idx -1) o catena interrotta: non si scrive, altrimenti cadrebbe sul
  // cliente finale di un ramo che non e' mio (vedi la guardia gemella nell'upload).
  if (mio < 0 || esito.catenaCompleta === false) return { creata: false, motivo: 'fuori catena' }
  const figlio = mio > 0 ? cat[mio - 1] : null
  const liv = figlio
    ? esito.livelli.find(l => l.masterId === figlio)
    : esito.livelli.find(l => l.clienteId)
  if (!liv || liv.differenza == null) return { creata: false, motivo: 'livello non calcolabile' }
  // SOLO RECUPERI: liv.differenza = dovuto - pagato. <= 0 (rimborso o zero) non diventa una riga.
  if (liv.differenza < 0.01) return { creata: false, motivo: 'nessun recupero' }

  // Anti-doppio per SPEDIZIONE, ALLO STESSO SCALINO: gia' rettificata (confermata o in attesa) da questo
  // master o verso di lui. Le rettifiche dei livelli SOTTO non fermano: sono un altro addebito (decisione
  // di Lorenzo del 24/10/2026, quando il giro OneTracking di SDA EXPRESS L e' passato a Wave — sui pacchi
  // del file LOGIXIA 12/10 MULTI aveva gia' girato a spedizioni 2000, e Wave deve poter rettificare MULTI).
  // Il doppio vero a valle lo ferma il database (trg_rettifica_no_doppia_ripesatura, stesso pagante).
  // Non contano le ANNULLATE (addebito stornato: la spedizione torna da rettificare) ne' il costo che
  // un detentore ha registrato su se' stesso senza addebitare nessuno sotto (master_id = target).
  const { data: giaTutte } = await admin.from('rettifiche')
    .select('id,master_id,target_master_id,propagazione').eq('spedizione_id', esito.spedizioneId)
    .or('confermata.eq.true,stato.eq.da_rettificare')
  const gia = (giaTutte || []).filter((g: any) => g.propagazione !== 'annullata'
    && !(g.target_master_id && g.target_master_id === g.master_id)
    && (g.master_id === masterId || g.target_master_id === masterId))
  if (gia.length) return { creata: false, motivo: 'gia rettificata' }

  const { data: ins, error } = await inserisciRettifica(admin, {
    master_id: masterId, file_id: null,
    spedizione_id: esito.spedizioneId, numero_spedizione: esito.ldv,
    cliente_id: figlio ? null : liv.clienteId,
    target_master_id: figlio,
    // il volume col divisore del figlio, che e' chi paga (vedi volumiDelLivello)
    peso_iniziale: esito.pesoRealePrima, peso_reale: esito.pesoDopo, ...volumiDelLivello(esito, liv),
    costo_iniziale: liv.pagato, costo_finale: liv.dovuto,
    differenza: -liv.differenza,          // colonna "quanto restituisco": un addebito e' negativo
    stato: 'da_rettificare',
    rif_fornitore: esito.idOrdine,        // = la LDV (anti-doppione secondario, indice unico DB)
    colli_ripesati: esito.colli_ripesati || null,
  }, 'id')

  // 23505 = l'indice unico rif_fornitore ha respinto: gia' fatta, non e' un errore.
  if (error) return { creata: false, motivo: error.code === '23505' ? 'gia rettificata' : ('errore: ' + error.message) }
  return { creata: true, rettificaId: ins?.id, recupero: Math.round(liv.differenza * 100) / 100 }
}
