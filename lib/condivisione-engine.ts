import { createHash } from 'node:crypto'
import { generaApiKey } from '@/lib/api-auth'
import { propagaCosto } from '@/lib/condivisione-propaga'
import { pontiCodiceDi } from '@/lib/ponti-codice'
import { contrattiRimossiConMotivo } from '@/lib/contratti-catena'
import { nomeContrattoNormalizzato } from '@/lib/contratto-per-nome'
import { cosaCeAttaccato, eliminaContrattiSenzaStorico, storicoContratti, type Attaccato } from '@/lib/elimina-contratto'
import { fetchAllStretto } from '@/lib/fetch-all'

/* Flusso della condivisione contratti (CONDIVISIONE-CONTRATTI.md): il collegamento master↔master è UNA
 * riga corrieri_condivisi (corriere_id NULL, un cliente-ledger). L'approvazione è SOLO al collegamento;
 * dopo, il venditore ASSEGNA al collegato un suo listino (Listini Clienti) e i contratti dentro gli
 * vengono condivisi: chiave, corriere moovexpress sul compratore, costo e zone propagati.
 *
 * Se un contratto si può condividere lo decide UNA funzione, valutaContrattoPerCompratore, che usano
 * l'Assegna, la scheda del collegato e il riallineamento. Prima la regola era scritta tre volte e in tre
 * modi diversi, e una porta (l'abilitazione per singolo contratto) non la controllava affatto.
 *
 * La regola: su un master, per ogni nome di contratto, UNA riga sola. Tutto ciò che viene dopo ragiona
 * per nome — la catena dei pagamenti (risolviCatenaCondivisione), i contratti sospesi da sopra
 * (lib/contratti-catena.ts), la cascata dei listini — e con due righe omonime sceglie a caso o si ferma.
 * Conseguenza: finché il compratore compra un nome da un collegato, il suo master non glielo può dare
 * (la cascata salta quel nome, lib/ponti-codice.ts). Un nome, un fornitore.
 *
 * Da qui si decide anche cosa CANCELLARE (le copie morte da sostituire): ogni lettura che porta a quella
 * decisione è "stretta" e lancia se fallisce. "Non sono riuscito a leggere" non vale mai "non c'è niente". */

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

// I motivi li legge il VENDITORE: non devono raccontare la rete del compratore (da chi compra, cosa gli
// ha deciso il suo master, se ha spedito). Il perché vero resta nel `dettaglio`, per il log del server.
const GIA_SUO = 'il collegato ha già questo contratto'
const NON_SOSTITUIBILE = 'il collegato ha già questo contratto e da qui non si può sostituire: scrivi all’assistenza'

export type CopiaMorta = { id: string; master_id: string; attivo: boolean }

export type EsitoContratto =
  | { stato: 'condiviso'; ponteId: string }
  | { stato: 'da_creare' }
  | { stato: 'da_sostituire'; copie: CopiaMorta[]; attaccato: Attaccato; ponteId?: string }
  | { stato: 'saltato'; motivo: string; dettaglio?: string }

// Quello che serve sapere del COMPRATORE, letto una volta per tutti i contratti da valutare.
export type ContestoCompratore = {
  buyer: string
  righe: any[]                  // le sue righe corrieri (con fornitore e contratto d'origine dei ponti)
  ponti: Set<string>            // i suoi ponti codice
  rimossi: Set<string>          // nomi che l'albero sopra di lui non gli offre più (per pausa o perché tolti)
  tolti: Set<string>            // ...di cui TOLTI, non soltanto in pausa
  offertiDalPadre: Set<string>  // nomi che il padre gli offre oggi (righe attive, non disabilitate per lui)
  righeSotto: any[]             // le righe dei master sotto di lui
}

// Del JSON delle credenziali servono solo fornitore e contratto d'origine dei ponti: la chiave non si legge.
const RIGA_CORRIERE = 'id,master_id,nome_contratto,tipo,proprio,attivo,settings,fornitore:credenziali->>fornitore_master_id,origine:credenziali->>corriere_origine_id'

// I master sotto `rootId`, letti in modo stretto (lib/rete-masters.ts ingoia gli errori, e qui un elenco
// vuoto per errore lascerebbe in piedi copie che spediscono sull'account di chi le ha tolte).
async function sottoAlberoStretto(admin: any, rootId: string): Promise<string[]> {
  const masters = await fetchAllStretto(() => admin.from('masters').select('id,parent_master_id').order('id', { ascending: true }))
  const figliDi = new Map<string, string[]>()
  for (const m of masters as any[]) {
    if (!m.parent_master_id) continue
    if (!figliDi.has(m.parent_master_id)) figliDi.set(m.parent_master_id, [])
    figliDi.get(m.parent_master_id)!.push(m.id)
  }
  const out: string[] = []
  const visti = new Set<string>([rootId])
  let fronte = [rootId]
  for (let i = 0; i < 25 && fronte.length; i++) {
    const nuovi: string[] = []
    for (const f of fronte) for (const c of (figliDi.get(f) || [])) if (!visti.has(c)) { visti.add(c); out.push(c); nuovi.push(c) }
    fronte = nuovi
  }
  return out
}

export async function contestoCompratore(admin: any, buyer: string): Promise<ContestoCompratore> {
  const sotto = await sottoAlberoStretto(admin, buyer)
  const [{ data: righe, error: eR }, ponti, motivi] = await Promise.all([
    admin.from('corrieri').select(RIGA_CORRIERE).eq('master_id', buyer),
    pontiCodiceDi(admin, buyer),
    contrattiRimossiConMotivo(buyer, admin, { stretto: true }),
  ])
  if (eR) throw new Error('lettura dei contratti del collegato non riuscita: ' + eR.message)
  const offertiDalPadre = new Set<string>()
  const { data: mRow, error: eM } = await admin.from('masters').select('parent_master_id').eq('id', buyer).maybeSingle()
  if (eM) throw new Error('lettura del master del collegato non riuscita: ' + eM.message)
  if (mRow?.parent_master_id) {
    const [{ data: rp, error: eP }, { data: dis, error: eD }] = await Promise.all([
      admin.from('corrieri').select('id,nome_contratto,attivo').eq('master_id', mRow.parent_master_id),
      admin.from('masters_corrieri_abilitati').select('corriere_id').eq('master_id', buyer).eq('abilitato', false),
    ])
    if (eP || eD) throw new Error('lettura dei contratti del padre non riuscita')
    const disab = new Set((dis || []).map((d: any) => d.corriere_id))
    for (const r of (rp || []) as any[]) if (r.attivo !== false && !disab.has(r.id)) offertiDalPadre.add(nomeContrattoNormalizzato(r.nome_contratto))
  }
  const righeSotto = sotto.length
    ? await fetchAllStretto(() => admin.from('corrieri').select(RIGA_CORRIERE).in('master_id', sotto).order('id', { ascending: true }))
    : []
  const tolti = new Set<string>()
  for (const [nome, m] of motivi) if (m.has('tolto')) tolti.add(nome)
  return { buyer, righe: righe || [], ponti: ponti.ids, rimossi: new Set(motivi.keys()), tolti, offertiDalPadre, righeSotto }
}

/* SI PUÒ CONDIVIDERE `corr` (un contratto del venditore) COL COMPRATORE?
 *  - il contratto dev'essere vivo per il venditore: acceso, e non in pausa o tolto sopra di lui (la sua
 *    /api/v1 rifiuterebbe ogni spedizione);
 *  - il compratore non ha righe con quel nome → si crea il ponte;
 *  - ha già il ponte di questo venditore per questo contratto, e nient'altro con quel nome → condiviso;
 *  - lo compra già da un altro fornitore, è un contratto suo, o ha la copia di un ponte → no;
 *  - lo riceve dal suo master, che glielo offre ancora (anche solo in pausa) → no: un nome, un fornitore;
 *  - il suo master gliel'ha TOLTO → la sua copia è morta, e con lei le copie reali con lo stesso nome nel
 *    suo sottoalbero (ognuna tolta anche per il proprio master), che spediscono sull'account di chi
 *    gliel'ha tolto. Se nessuna ha storico (spedizioni, ritiri, distinte), chiavi API, condivisioni,
 *    webhook, articoli o autisti appesi, si possono togliere e al loro posto nasce il ponte — su
 *    conferma del venditore, coi numeri. Altrimenti no: lo storico non si cancella e i pacchi già partiti
 *    restano attaccati al loro contratto. Vale anche se il ponte c'è già e le copie sono rimaste lì (una
 *    sostituzione interrotta a metà): finché ci sono, la catena prende la copia per detentore e il ponte
 *    non spedisce.
 * Caso vero (13/10/2026): il GLS che MULTIEXPRESS ha tolto a spedizioni 2000 e che GTS gli vende. La copia
 * spenta di spedizioni 2000 bloccava l'Assegna ("ce l'ha già"); sotto di lui SEMPLICE SPEDIRE ne aveva una
 * copia reale ancora accesa, ferma solo perché sopra era spenta. Tutte e due vanno tolte, o il ponte non
 * spedisce e la copia di sotto tornerebbe a spedire sull'account di MULTIEXPRESS. */
export async function valutaContrattoPerCompratore(
  admin: any, ctx: ContestoCompratore, venditore: { seller: string; rimossi: Set<string> }, corr: any,
): Promise<EsitoContratto> {
  const salta = (motivo: string, dettaglio?: string): EsitoContratto => ({ stato: 'saltato', motivo, dettaglio })
  const seller = venditore.seller
  if (corr.master_id !== seller) return salta('non è un tuo contratto')
  if (corr.tipo === 'moovexpress' && corr.fornitore === ctx.buyer) return salta('arriva proprio da questo master: non glielo puoi rivendere')
  if (corr.attivo === false) return salta('il contratto è spento da te: riaccendilo prima')
  const nome = nomeContrattoNormalizzato(corr.nome_contratto)
  if (venditore.rimossi.has(nome)) return salta('il contratto è in pausa o tolto sopra di te: adesso non lo puoi vendere')

  const sue = ctx.righe.filter((r: any) => nomeContrattoNormalizzato(r.nome_contratto) === nome)
  if (!sue.length) return { stato: 'da_creare' }

  const ponte = sue.find((r: any) => ctx.ponti.has(r.id) && r.fornitore === seller && r.origine === corr.id)
  const altre = sue.filter((r: any) => r.id !== ponte?.id)
  if (ponte && !altre.length) return { stato: 'condiviso', ponteId: ponte.id }
  // Con il ponte già lì, una qualsiasi altra riga omonima è uno stato da sistemare a mano, salvo le copie
  // morte di una sostituzione interrotta (sotto).
  const nonPiu = (dettaglio: string) => salta(ponte ? NON_SOSTITUIBILE : GIA_SUO, dettaglio)
  if (altre.some((r: any) => ctx.ponti.has(r.id))) return nonPiu('lo compra già da un altro fornitore')
  if (altre.some((r: any) => r.proprio === true)) return nonPiu('è un contratto suo')
  // Una copia di un ponte (dal padre, o rimasta da un collegamento chiuso) non si sostituisce da qui: se
  // viva, la catena dei soldi la attraversa per arrivare al fornitore; se morta, va guardata a mano.
  if (altre.some((r: any) => r.tipo === 'moovexpress')) {
    return (!ponte && ctx.offertiDalPadre.has(nome))
      ? salta(GIA_SUO, 'riceve dal suo master la copia di un ponte')
      : salta(NON_SOSTITUIBILE, 'ha una copia di un ponte che il suo master non gli offre più (o di un collegamento chiuso)')
  }
  if (!ctx.tolti.has(nome)) return nonPiu(ctx.rimossi.has(nome) ? 'il suo master l’ha solo in pausa' : 'lo riceve dal suo master')

  // Le copie reali con lo stesso nome nel sottoalbero: morte anche loro, ma lo si verifica per ognuna sul
  // suo master. Se ne spunta una che non risulta tolta, qualcosa non torna: non si tocca niente. E non si
  // tocca mai una riga del venditore stesso (può stare nella rete del compratore, come Wave sotto MULTI).
  const candidati = ctx.righeSotto.filter((r: any) =>
    nomeContrattoNormalizzato(r.nome_contratto) === nome && r.tipo !== 'moovexpress' && r.proprio !== true)
  if (candidati.some((r: any) => r.master_id === seller)) return salta(NON_SOSTITUIBILE, 'il venditore ha una copia con lo stesso nome nella rete del compratore')
  for (const masterId of Array.from(new Set(candidati.map((r: any) => r.master_id as string)))) {
    const m = await contrattiRimossiConMotivo(masterId, admin, { stretto: true })
    if (!m.get(nome)?.has('tolto')) return salta(NON_SOSTITUIBILE, `copia nella sua rete non tolta (master ${masterId})`)
  }
  const copie = [...altre, ...candidati]
  const ids = copie.map((c: any) => c.id)
  const storico = await storicoContratti(admin, ids)
  if (storico.nonVerificato) throw new Error('storico delle copie non verificato')
  if (storico.spedizioni + storico.ritiri + storico.distinte > 0) {
    return salta(NON_SOSTITUIBILE, `copie con storico: ${JSON.stringify(storico)}`)
  }
  const attaccato = await cosaCeAttaccato(admin, ids)
  const appesi = attaccato.chiaviApi + attaccato.condivisioni + attaccato.pontiAValle + attaccato.webhooks + attaccato.corrieriCliente + attaccato.articoli + attaccato.autisti
  if (appesi > 0) return salta(NON_SOSTITUIBILE, `copie con cose appese: ${JSON.stringify(attaccato)}`)
  return {
    stato: 'da_sostituire', attaccato, ponteId: ponte?.id,
    copie: copie.map((c: any) => ({ id: c.id, master_id: c.master_id, attivo: c.attivo !== false })),
  }
}

// Cosa si mostra al VENDITORE che conferma una sostituzione: solo totali, senza chi, dove e perché.
export function riepilogoSostituzione(nome: string, e: { copie: CopiaMorta[]; attaccato: Attaccato }) {
  return {
    nome,
    copie: e.copie.length,
    prezzi_vendita: e.attaccato.fasceVendita + e.attaccato.supplementiVendita,
    prezzi_costo: e.attaccato.fasceCosto + e.attaccato.supplementiCosto,
    zone: e.attaccato.zone, cap: e.attaccato.cap,
  }
}

// L'impronta di ciò che si conferma: collegamento, listino, copie da togliere coi loro numeri, contratti
// già condivisi che il listino non copre più. Se tra la domanda e la conferma cambia qualcosa, l'impronta
// non torna e si chiede di nuovo.
function impronta(linkId: string, listinoId: string, piano: { corr: any; esito: EsitoContratto }[], scoperti: { id: string }[]): string {
  const voci = piano.filter(x => x.esito.stato === 'da_sostituire').map(x => {
    const e = x.esito as Extract<EsitoContratto, { stato: 'da_sostituire' }>
    return `${x.corr.id}:${e.copie.map(c => c.id).sort().join(',')}:${JSON.stringify(e.attaccato)}`
  }).sort()
  const fuori = scoperti.map(s => s.id).sort()
  return createHash('sha256').update([linkId, listinoId, ...voci, '|', ...fuori].join('\n')).digest('hex').slice(0, 24)
}

/* Materializza sul COMPRATORE un contratto il cui prezzo W è GIÀ nel listino d'ingrosso del ledger:
 * abilita il corriere al ledger, crea la chiave, crea il ponte del compratore e propaga costo+zone
 * (accendendolo se riesce). NON tocca le fasce del listino: le mette il venditore in Listini Clienti.
 *  - Ponte già presente: si riallinea solo il costo. Chiave, abilitazione e acceso/spento restano come
 *    sono, così una pausa decisa dal compratore non si annulla. Si riaccende tutto solo se a spegnerlo era
 *    stato il venditore (Disabilita: chiave revocata o abilitazione del ledger tolta), o se il ponte è
 *    "in attesa di costo" (nato, o riacceso, mentre la propagazione falliva).
 *  - soloCosto: mai creare, mai riaccendere; se il ponte non c'è più (il compratore l'ha tolto) non si
 *    ricrea.
 *  - sostituisci: le copie morte da togliere, col registro di chi l'ha deciso. Si tolgono DOPO aver creato
 *    il ponte (spento): con il ponte già lì, una cascata dei listini che passasse in quell'istante salta il
 *    nome e non ricrea la copia. Il registro si scrive PRIMA della cancellazione: se non si scrive, non si
 *    cancella; se la cancellazione non riesce, chiave, abilitazione e ponte tornano come erano e il
 *    registro lo dice. */
async function materializzaContratto(
  admin: any,
  p: { seller: string; buyer: string; ledgerId: string; ledgerNome?: string; corr: any; listinoIngrosso: string },
  opt: { soloCosto?: boolean; sostituisci?: { copie: CopiaMorta[]; registro: Record<string, any> } } = {},
): Promise<{ ok: boolean; reason?: string; propagazione?: any; buyerCorriereId?: string; copieTolte?: boolean }> {
  const { seller, buyer, ledgerId, ledgerNome, corr, listinoIngrosso } = p
  const corriereId = corr.id as string
  const propaga = async (ponteId: string): Promise<{ ok: boolean; reason?: string }> => {
    try { return await propagaCosto(admin, { corriereVenditore: corriereId, corriereAcquirente: ponteId, masterAcquirente: buyer, listinoIngrosso }) }
    catch (e: any) { return { ok: false, reason: 'propagazione del costo non riuscita: ' + (e?.message || e) } }
  }
  const senzaSegno = (s: any) => { const { in_attesa_costo: _x, ...resto } = (s || {}) as any; return resto }

  // Il ponte del compratore per QUESTO contratto venduto da QUESTO venditore.
  const { data: corrBuyers, error: eB } = await admin.from('corrieri')
    .select('id,attivo,settings,fornitore:credenziali->>fornitore_master_id,origine:credenziali->>corriere_origine_id')
    .eq('master_id', buyer).eq('tipo', 'moovexpress')
  if (eB) return { ok: false, reason: 'lettura dei contratti del collegato non riuscita' }
  const esistente = (corrBuyers || []).find((c: any) => c.origine === corriereId && c.fornitore === seller) as any
  let buyerCorrId = esistente?.id as string | undefined
  if (opt.soloCosto && !buyerCorrId) return { ok: false, reason: 'il contratto non è più sul portale del collegato' }

  const { data: ab, error: eAb } = await admin.from('clienti_corrieri_abilitati').select('cliente_id,abilitato').eq('cliente_id', ledgerId).eq('corriere_id', corriereId).maybeSingle()
  const { data: keyEsist, error: eK0 } = await admin.from('api_keys').select('chiave,attivo').eq('cliente_id', ledgerId).eq('corriere_id', corriereId).maybeSingle()
  if (eAb || eK0) return { ok: false, reason: 'lettura di chiave o abilitazione non riuscita: non è stato cambiato niente' }

  if (buyerCorrId && !opt.sostituisci) {
    const spentoDalVenditore = !keyEsist || keyEsist.attivo === false || ab?.abilitato === false
    if (opt.soloCosto || !spentoDalVenditore) {
      const propagazione = await propaga(buyerCorrId)
      // Un ponte che il venditore ha tolto (chiave revocata) non si riaccende da qui, segno o non segno.
      if (propagazione.ok && esistente?.settings?.in_attesa_costo && !spentoDalVenditore) {
        await admin.from('corrieri').update({ attivo: true, settings: senzaSegno(esistente.settings) }).eq('id', buyerCorrId)
      }
      return { ok: true, propagazione, buyerCorriereId: buyerCorrId }
    }
  }

  // Il ledger "vede" il contratto (clienti_corrieri_abilitati) — come un cliente qualsiasi.
  if (!ab) await admin.from('clienti_corrieri_abilitati').insert({ cliente_id: ledgerId, corriere_id: corriereId, abilitato: true })
  else if (ab.abilitato === false) await admin.from('clienti_corrieri_abilitati').update({ abilitato: true }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)

  // API KEY per (ledger, contratto): è la credenziale del compratore. Si riusa se c'è.
  let chiave = keyEsist?.chiave as string | undefined
  if (!chiave) {
    chiave = generaApiKey()
    const { error: eK } = await admin.from('api_keys').insert({ master_id: seller, cliente_id: ledgerId, corriere_id: corriereId, chiave, nome: `moovexpress ${ledgerNome || ''}`.slice(0, 80), attivo: true })
    if (eK) return { ok: false, reason: 'Emissione chiave non riuscita.' }
  } else if (keyEsist?.attivo === false) {
    await admin.from('api_keys').update({ attivo: true }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
  }

  // Ponte nuovo, o ponte da riaccendere: in tutti e due i casi resta segnato "in attesa di costo" finché
  // la propagazione non riesce, così un giro successivo lo accende da solo.
  let creato = false
  if (!buyerCorrId) {
    const { data: nc, error: eC } = await admin.from('corrieri').insert({
      master_id: buyer, tipo: 'moovexpress', nome_contratto: corr.nome_contratto,
      credenziali: { api_key: chiave, fornitore_master_id: seller, corriere_origine_id: corriereId },
      // proprio=false: un ponte non è mai detentore del contratto. Lo impone comunque il database
      // (trg_corrieri_proprio → fn_ricalcola_corrieri_proprio), che ricalcola il flag a ogni inserimento.
      // Il compratore lo paga sul suo ledger presso il venditore (addebito del dispatch), non sul conto
      // verso il padre-albero: lo decide la catena-fornitore (lib/condivisione-catena.ts), non il flag.
      settings: { in_attesa_costo: true }, multicollo: true, inserimento_ritiri: true, attivo: false, livello: 1, proprio: false,
    }).select('id').single()
    if (eC || !nc) return { ok: false, reason: 'Creazione corriere sul compratore non riuscita.' }
    buyerCorrId = nc.id
    creato = true
  } else {
    await admin.from('corrieri').update({
      credenziali: { api_key: chiave, fornitore_master_id: seller, corriere_origine_id: corriereId },
      settings: { ...(esistente?.settings || {}), in_attesa_costo: true },
    }).eq('id', buyerCorrId)
  }

  if (opt.sostituisci?.copie.length) {
    // Torna tutto com'era: niente ponte nuovo, chiave e abilitazione allo stato letto prima.
    const annulla = async (motivo: string) => {
      if (creato) await admin.from('corrieri').delete().eq('id', buyerCorrId)
      else await admin.from('corrieri').update({ settings: esistente?.settings || {} }).eq('id', buyerCorrId)
      if (!keyEsist || keyEsist.attivo === false) await admin.from('api_keys').update({ attivo: false }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
      if (!ab) await admin.from('clienti_corrieri_abilitati').delete().eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
      else if (ab.abilitato === false) await admin.from('clienti_corrieri_abilitati').update({ abilitato: false }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
      await admin.from('audit_log').insert({ ...opt.sostituisci!.registro, azione: 'condivisione_sostituzione_annullata', record_id: buyerCorrId,
        modifiche: { ...(opt.sostituisci!.registro.modifiche || {}), motivo } })
    }
    const { error: eReg } = await admin.from('audit_log').insert({ ...opt.sostituisci.registro, record_id: buyerCorrId })
    if (eReg) { await annulla('registro non scritto'); return { ok: false, reason: 'registro della sostituzione non scritto: non è stato cambiato niente' } }
    const el = await eliminaContrattiSenzaStorico(admin, opt.sostituisci.copie.map(c => c.id))
    if (!el.ok) { await annulla(el.reason); return { ok: false, reason: 'le copie da sostituire non si possono più togliere: non è stato cambiato niente' } }
  }

  // PROPAGA costo + zone sul ponte, e lo ACCENDE solo se è andata (niente contratto monco).
  const propagazione = await propaga(buyerCorrId!)
  if (propagazione.ok) await admin.from('corrieri').update({ attivo: true, settings: senzaSegno(esistente?.settings) }).eq('id', buyerCorrId)
  return { ok: true, propagazione, buyerCorriereId: buyerCorrId, copieTolte: !!opt.sostituisci?.copie.length }
}

// I contratti del listino d'ingrosso, con l'esito della regola per ciascuno. `link` è la riga
// corrieri_condivisi (servono fornitore_master_id e master_id).
export async function pianoCondivisione(admin: any, link: any, listinoId: string) {
  const seller = link.fornitore_master_id as string
  const buyer = link.master_id as string
  // Tutte le fasce, in modo stretto: oltre mille righe la lettura semplice si fermava in silenzio.
  const fasce = await fetchAllStretto(() => admin.from('listini_clienti_fasce').select('corriere_id').eq('listino_id', listinoId).order('id', { ascending: true }))
  const corriereIds = Array.from(new Set(fasce.map((f: any) => f.corriere_id).filter(Boolean)))
  if (!corriereIds.length) return { seller, buyer, piano: [] as { corr: any; esito: EsitoContratto }[] }
  const { data: corrDett, error: eC } = await admin.from('corrieri').select(RIGA_CORRIERE).in('id', corriereIds)
  if (eC) throw new Error('lettura dei contratti del listino non riuscita: ' + eC.message)
  const [ctx, rimossiVenditore] = await Promise.all([
    contestoCompratore(admin, buyer),
    contrattiRimossiConMotivo(seller, admin, { stretto: true }),
  ])
  const venditore = { seller, rimossi: new Set(rimossiVenditore.keys()) }
  // Due contratti del venditore con lo stesso nome nello stesso listino farebbero due ponti omonimi.
  const perNome = new Map<string, number>()
  for (const c of (corrDett || []) as any[]) { const n = nomeContrattoNormalizzato(c.nome_contratto); perNome.set(n, (perNome.get(n) || 0) + 1) }
  const piano: { corr: any; esito: EsitoContratto }[] = []
  for (const corr of (corrDett || []) as any[]) {
    if ((perNome.get(nomeContrattoNormalizzato(corr.nome_contratto)) || 0) > 1) {
      piano.push({ corr, esito: { stato: 'saltato', motivo: 'nel listino ci sono due tuoi contratti con questo nome: tienine uno' } })
      continue
    }
    piano.push({ corr, esito: await valutaContrattoPerCompratore(admin, ctx, venditore, corr) })
  }
  return { seller, buyer, piano }
}

// I ponti che questo venditore ha già acceso sul compratore e che il listino non copre: restano sul suo
// portale, ma la /api/v1 del venditore li rifiuta (nessun prezzo nel listino del ledger).
export async function pontiScoperti(admin: any, link: any, ledgerId: string, piano: { corr: any }[]): Promise<{ id: string; nome: string }[]> {
  const nelPiano = new Set(piano.map(x => x.corr.id))
  const [{ data: ponti, error: eP }, { data: chiavi, error: eK }] = await Promise.all([
    admin.from('corrieri').select('id,attivo,nome_contratto,fornitore:credenziali->>fornitore_master_id,origine:credenziali->>corriere_origine_id')
      .eq('master_id', link.master_id).eq('tipo', 'moovexpress'),
    admin.from('api_keys').select('corriere_id,attivo').eq('cliente_id', ledgerId),
  ])
  if (eP || eK) throw new Error('lettura dei contratti condivisi non riuscita')
  const chiaveAttiva = new Set((chiavi || []).filter((k: any) => k.attivo !== false).map((k: any) => k.corriere_id))
  return (ponti || [])
    .filter((p: any) => p.fornitore === link.fornitore_master_id && p.origine && p.attivo !== false && chiaveAttiva.has(p.origine) && !nelPiano.has(p.origine))
    .map((p: any) => ({ id: p.origine as string, nome: p.nome_contratto as string }))
}

const logSaltati = (linkId: string, piano: { corr: any; esito: EsitoContratto }[]) => {
  for (const { corr, esito } of piano) {
    if (esito.stato === 'saltato' && esito.dettaglio) console.info(`[condivisione] ${linkId} "${corr.nome_contratto}": ${esito.dettaglio}`)
  }
}

// Quanti clienti, master e agenti usano il listino, oltre al ledger del collegamento.
async function altriUtilizzatori(admin: any, listinoId: string, ledgerId: string): Promise<{ clienti: number; master: number; agenti: number }> {
  const testa = { count: 'exact' as const, head: true }
  const [{ count: clienti, error: e1 }, { count: master, error: e2 }, { count: agenti, error: e3 }] = await Promise.all([
    admin.from('clienti').select('id', testa).eq('listino_cliente_id', listinoId).neq('id', ledgerId),
    admin.from('masters').select('id', testa).eq('parent_listino_id', listinoId),
    admin.from('utenti').select('id', testa).eq('listino_agente_id', listinoId),
  ])
  if (e1 || e2 || e3) throw new Error('controllo di chi usa il listino non riuscito')
  return { clienti: clienti || 0, master: master || 0, agenti: agenti || 0 }
}

/* ASSEGNA un listino GIÀ FATTO dal venditore (Listini Clienti) al master collegato: diventa il prezzo
 * d'ingrosso (quello che il compratore paga), e ogni contratto dentro viene condiviso secondo la regola.
 * Il listino dev'essere SOLO di quel collegato: Disabilita e Revoca ne tolgono i prezzi, e un listino
 * usato anche da clienti o da altri master li toglierebbe anche a loro.
 * Si chiede conferma (la prima chiamata non scrive niente e restituisce numeri e impronta) quando:
 *  - qualche contratto prende il posto di copie morte del compratore: si tolgono righe di un altro master,
 *    con i prezzi che ci aveva messo sopra;
 *  - qualche contratto già condiviso non è nel listino scelto: resterebbe sul portale del collegato, ma le
 *    sue spedizioni verrebbero rifiutate.
 * La seconda chiamata, con quell'impronta, esegue; se intanto il piano è cambiato, si richiede. */
export async function assegnaListinoCondivisione(
  admin: any,
  opts: { linkId: string; listinoId: string; conferma?: string; attore?: { uid?: string | null; nome?: string | null } },
): Promise<{
  ok: boolean; reason?: string; serveConferma?: boolean; impronta?: string
  daConfermare?: ReturnType<typeof riepilogoSostituzione>[]; scoperti?: string[]
  condivisi?: string[]; sostituiti?: string[]; saltati?: { nome: string; motivo: string }[]
}> {
  const { linkId, listinoId } = opts
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,stato,fornitore_master_id,master_id,cliente_ledger_id,corriere_id').eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  if (link.stato !== 'attiva') return { ok: false, reason: 'Il master non ha ancora approvato il collegamento.' }
  if (link.corriere_id) return { ok: false, reason: 'Collegamento del vecchio tipo (un contratto solo): non si gestisce da qui.' }
  if (!link.cliente_ledger_id) return { ok: false, reason: 'Collegamento senza conto.' }
  const ledgerId = link.cliente_ledger_id as string

  const { data: listino } = await admin.from('listini_clienti').select('id,master_id,nome').eq('id', listinoId).maybeSingle()
  if (!listino || listino.master_id !== link.fornitore_master_id) return { ok: false, reason: 'Listino non trovato tra i tuoi.' }
  const altri = await altriUtilizzatori(admin, listinoId, ledgerId)
  if (altri.clienti + altri.master + altri.agenti > 0) {
    return { ok: false, reason: `Il listino “${listino.nome}” lo usano anche ${altri.clienti} clienti, ${altri.master} master e ${altri.agenti} agenti: per un master collegato serve un listino solo suo (duplicalo e assegna la copia).` }
  }

  const { seller, buyer, piano } = await pianoCondivisione(admin, link, listinoId)
  if (!piano.length) return { ok: false, reason: 'Il listino scelto non ha prezzi: aggiungi almeno un contratto con le fasce.' }
  logSaltati(linkId, piano)

  const daSostituire = piano.filter(x => x.esito.stato === 'da_sostituire')
  const scoperti = await pontiScoperti(admin, link, ledgerId, piano)
  const imp = impronta(linkId, listinoId, piano, scoperti)
  if ((daSostituire.length || scoperti.length) && opts.conferma !== imp) {
    return {
      ok: true, serveConferma: true, impronta: imp,
      daConfermare: daSostituire.map(x => riepilogoSostituzione(x.corr.nome_contratto || '—', x.esito as any)),
      scoperti: scoperti.map(s => s.nome),
    }
  }

  const { data: ledger } = await admin.from('clienti').select('id,ragione_sociale').eq('id', ledgerId).maybeSingle()
  // Il listino scelto DIVENTA il prezzo d'ingrosso del collegato (quello che lui paga).
  await admin.from('clienti').update({ listino_cliente_id: listinoId }).eq('id', ledgerId)

  const condivisi: string[] = []
  const sostituiti: string[] = []
  const saltati: { nome: string; motivo: string }[] = []
  for (const { corr, esito } of piano) {
    const nome = corr.nome_contratto || '—'
    if (esito.stato === 'saltato') { saltati.push({ nome, motivo: esito.motivo }); continue }
    const sostituisci = esito.stato === 'da_sostituire' ? {
      copie: esito.copie,
      registro: {
        attore_uid: opts.attore?.uid || null, attore: opts.attore?.nome || null,
        azione: 'condivisione_sostituisce_copie', tabella: 'corrieri',
        modifiche: { collegamento: linkId, venditore: seller, compratore: buyer, contratto: nome, contratto_venditore: corr.id, copie_tolte: esito.copie, attaccato: esito.attaccato },
      },
    } : undefined
    const m = await materializzaContratto(admin, { seller, buyer, ledgerId, ledgerNome: ledger?.ragione_sociale, corr, listinoIngrosso: listinoId }, { sostituisci })
    if (!m.ok) { saltati.push({ nome, motivo: m.reason || 'non riuscito' }); continue }
    if (m.copieTolte) sostituiti.push(nome)
    if (m.propagazione?.ok) condivisi.push(nome)
    else saltati.push({ nome, motivo: (m.copieTolte ? 'copie sostituite, ma il costo non si è propagato: correggi il listino e premi Aggiorna — ' : '') + (m.propagazione?.reason || 'propagazione non riuscita') })
  }
  return { ok: true, condivisi, sostituiti, saltati }
}

/* RIALLINEA un collegamento al suo listino d'ingrosso ATTUALE: riporta il costo sui ponti che ci sono
 * (anche dopo un ritocco a mano dei prezzi) e accende quelli rimasti in attesa di costo. Gira da solo
 * quando il venditore salva il listino. Con `creaMancanti` (solo dal bottone Aggiorna della scheda, cioè
 * da un master del venditore) crea anche i ponti dei contratti aggiunti al listino dopo l'Assegna. Il
 * salvataggio da solo non crea niente: può farlo anche un operatore, e ricreerebbe un contratto che il
 * collegato ha tolto. Non sostituisce copie di nessuno (lo fa solo l'Assegna, su conferma) e non
 * riaccende ponti in pausa. L'addebito era già giusto: il prezzo vero lo dà la /api/v1 del venditore. */
export async function risincronizzaCondivisione(admin: any, linkId: string, opts: { creaMancanti?: boolean } = {}): Promise<{
  ok: boolean; reason?: string; contratti?: number; creati?: string[]; daAttivare?: string[]; daConfermare?: string[]; saltati?: { nome: string; motivo: string }[]
}> {
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,master_id,cliente_ledger_id,stato,corriere_id').eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  if (link.stato !== 'attiva') return { ok: false, reason: 'Il collegamento non è attivo.' }
  if (!link.cliente_ledger_id) return { ok: false, reason: 'Collegamento senza conto.' }
  const { data: ledger } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').eq('id', link.cliente_ledger_id).maybeSingle()
  const listinoIngrosso = ledger?.listino_cliente_id as string | undefined
  if (!listinoIngrosso) return { ok: true, contratti: 0, creati: [], daAttivare: [], daConfermare: [], saltati: [] }

  const { seller, buyer, piano } = await pianoCondivisione(admin, link, listinoIngrosso)
  // I collegamenti del vecchio tipo (un contratto solo, LOGIXIA → Wave) si riallineano nel costo, ma
  // non ricevono contratti nuovi: il compratore ne aveva accettato uno.
  const puoCreare = !!opts.creaMancanti && !link.corriere_id
  let n = 0
  const creati: string[] = []
  const daAttivare: string[] = []
  const daConfermare: string[] = []
  const saltati: { nome: string; motivo: string }[] = []
  for (const { corr, esito } of piano) {
    const nome = corr.nome_contratto || '—'
    if (esito.stato === 'saltato') { saltati.push({ nome, motivo: esito.motivo }); continue }
    if (esito.stato === 'da_sostituire') { daConfermare.push(nome); continue }
    if (esito.stato === 'da_creare' && !puoCreare) { daAttivare.push(nome); continue }
    const m = await materializzaContratto(admin,
      { seller, buyer, ledgerId: link.cliente_ledger_id, ledgerNome: ledger?.ragione_sociale, corr, listinoIngrosso },
      { soloCosto: esito.stato === 'condiviso' })
    if (m.ok && m.propagazione?.ok) { n++; if (esito.stato === 'da_creare') creati.push(nome) }
    else saltati.push({ nome, motivo: m.reason || m.propagazione?.reason || 'propagazione non riuscita' })
  }
  return { ok: true, contratti: n, creati, daAttivare, daConfermare, saltati }
}

/* TOGLIE un contratto al collegato: il ponte si elimina (o si spegne, se ha storico), la chiave si
 * revoca, il contratto esce dal listino d'ingrosso. Se quel listino nel frattempo lo usa anche qualcun
 * altro, i prezzi restano: toglierli li toglierebbe anche a loro. */
export async function disabilitaContrattoCondiviso(
  admin: any,
  opts: { linkId: string; corriereId: string },
): Promise<{ ok: boolean; reason?: string; avviso?: string }> {
  const { linkId, corriereId } = opts
  const { data: link } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,master_id,cliente_ledger_id').eq('id', linkId).maybeSingle()
  if (!link) return { ok: false, reason: 'Collegamento non trovato.' }
  const seller = link.fornitore_master_id as string
  const buyer = link.master_id as string
  const ledgerId = link.cliente_ledger_id as string | null

  // Prima si legge tutto, poi si scrive: un controllo che fallisce a metà non lascia il lavoro a metà.
  const { data: corrBuyers, error: eB } = await admin.from('corrieri')
    .select('id,settings,fornitore:credenziali->>fornitore_master_id,origine:credenziali->>corriere_origine_id')
    .eq('master_id', buyer).eq('tipo', 'moovexpress')
  if (eB) return { ok: false, reason: 'lettura dei contratti del collegato non riuscita: non è stato cambiato niente' }
  // Il ponte del compratore per questo contratto, venduto da QUESTO venditore.
  const buyerCorr = (corrBuyers || []).find((c: any) => c.origine === corriereId && c.fornitore === seller)
  let listinoLedger: string | null = null
  let listinoCondiviso = false
  if (ledgerId) {
    const { data: led, error: eL } = await admin.from('clienti').select('listino_cliente_id').eq('id', ledgerId).maybeSingle()
    if (eL) return { ok: false, reason: 'lettura del conto del collegato non riuscita: non è stato cambiato niente' }
    listinoLedger = led?.listino_cliente_id || null
    if (listinoLedger) {
      try {
        const altri = await altriUtilizzatori(admin, listinoLedger, ledgerId)
        listinoCondiviso = altri.clienti + altri.master + altri.agenti > 0
      } catch { return { ok: false, reason: 'non sono riuscito a controllare chi usa il listino: non è stato cambiato niente' } }
    }
  }

  if (buyerCorr) {
    // Senza storico si toglie con la sua configurazione; con storico (spedizioni, ritiri o distinte) si
    // spegne, e perde il segno "in attesa di costo": non deve riaccendersi da solo al prossimo giro.
    const el = await eliminaContrattiSenzaStorico(admin, [buyerCorr.id])
    if (!el.ok) {
      const { in_attesa_costo: _x, ...resto } = (buyerCorr.settings || {}) as any
      await admin.from('corrieri').update({ attivo: false, settings: resto }).eq('id', buyerCorr.id)
    }
  }
  // Revoca la chiave e togli il contratto dal listino del ledger (se è ancora solo suo).
  await admin.from('api_keys').update({ attivo: false }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
  let avviso: string | undefined
  if (ledgerId) {
    if (listinoLedger && listinoCondiviso) {
      avviso = 'Il listino d’ingrosso lo usano anche altri: i prezzi di questo contratto restano. Toglilo a mano da Listini Clienti se serve.'
    } else if (listinoLedger) {
      await admin.from('listini_clienti_fasce').delete().eq('listino_id', listinoLedger).eq('corriere_id', corriereId)
      await admin.from('listini_clienti_supplementi').delete().eq('listino_id', listinoLedger).eq('corriere_id', corriereId)
      await admin.from('listini_clienti_corrieri').delete().eq('listino_id', listinoLedger).eq('corriere_id', corriereId)
    }
    await admin.from('clienti_corrieri_abilitati').update({ abilitato: false }).eq('cliente_id', ledgerId).eq('corriere_id', corriereId)
  }
  return { ok: true, avviso }
}
