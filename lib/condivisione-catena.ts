import { calcolaPrezzoCorriereDettaglio, calcolaPrezzoListino } from '@/lib/pricing'
import { registraMovimentoMaster, descrizioneSpedizione } from '@/lib/movimenti'
import { accessoriDelLivello } from '@/lib/cascata'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'
import { pesoSuReale } from '@/lib/agevolazione-misure'

/* CATENA DEL FORNITORE DIRETTO per i contratti CONDIVISI (corrieri `tipo='moovexpress'`).
 *
 * Risale dall'originante fino all'owner reale e dice, per OGNI livello, CHI paga, A CHI, e su QUALE
 * conto — il modello di CONDIVISIONE-MODELLO.md:
 *   - compratore DISCENDENTE nell'albero del venditore (compra "scendendo l'albero") → `credito`
 *     (il suo conto sub-master ESISTENTE, nessun ledger nuovo);
 *   - compratore collegato via CODICE (non sotto-master) → `ledger` (il suo cliente-ledger sotto il venditore);
 *   - owner reale (corriere NON ponte) → `credito_proprio` (o `credito` se è un vertice, come fn_conto_di).
 *
 * VERITÀ DEI LEGAMI = `corrieri_condivisi`, NON le credenziali del ponte. Un ponte può essere una COPIA
 * colata giù per l'albero (copia-listino-submaster copiava le credenziali): in quel caso `fornitore_master_id`
 * del ponte punta al "nonno". Fidarsi del ponte = la fuga di credenziale. Qui un salto è CODICE solo se
 * esiste un `corrieri_condivisi` ATTIVO (compratore = questo master, venditore = quello del ponte);
 * altrimenti il ponte è una copia e si sale l'ALBERO (parent_master_id).
 *
 * SOLA LETTURA: calcola la mappa dei pagamenti, NON addebita. È la base sia dell'addebito (il nuovo
 * flusso condivisione) sia del Report Guadagno (che deve leggere il costo del rivenditore dal suo ledger).
 */

export type ContoCondivisione = 'credito' | 'ledger' | 'credito_proprio'

export interface LivelloCondivisione {
  master: string              // chi paga a questo livello
  fornitore: string | null    // a chi paga (null = owner → al corriere reale)
  conto: ContoCondivisione
  ledgerClienteId: string | null   // valorizzato SOLO se conto='ledger' (il cliente-ledger sotto il fornitore)
  corriereId: string          // il corriere (reale o ponte) di questo livello — serve a prezzare il suo costo
  ruolo: 'albero' | 'codice' | 'owner'
}

const normNome = (s: any) => String(s || '').trim().toLowerCase()

// Corrieri di un master per quel contratto (confronto normalizzato, come lib/contratto-per-nome.ts).
async function corrieriPerNome(admin: any, masterId: string, nome: string): Promise<any[]> {
  const { data } = await admin.from('corrieri')
    .select('id,tipo,proprio,credenziali,nome_contratto').eq('master_id', masterId)
  return (data || []).filter((c: any) => normNome(c.nome_contratto) === normNome(nome))
}

// Vertice = attaccato alla piattaforma (nonno null), identico alla condizione di fn_conto_di.
async function eVertice(admin: any, masterId: string): Promise<boolean> {
  const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', masterId).maybeSingle()
  const padre = m?.parent_master_id
  if (!padre) return true
  const { data: p } = await admin.from('masters').select('parent_master_id').eq('id', padre).maybeSingle()
  return !p?.parent_master_id
}

export async function risolviCatenaCondivisione(
  admin: any, masterOriginante: string, nomeContratto: string,
): Promise<LivelloCondivisione[]> {
  const out: LivelloCondivisione[] = []
  const visti = new Set<string>()
  let cur: string | null = masterOriginante

  for (let i = 0; i < 20 && cur && !visti.has(cur); i++) {
    visti.add(cur)
    const corrieri = await corrieriPerNome(admin, cur, nomeContratto)
    if (!corrieri.length) break

    // OWNER REALE: ha un corriere NON ponte per questo contratto → paga il corriere vero.
    const reale = corrieri.find((c: any) => c.tipo !== 'moovexpress')
    if (reale) {
      out.push({ master: cur, fornitore: null, conto: (await eVertice(admin, cur)) ? 'credito' : 'credito_proprio', ledgerClienteId: null, corriereId: reale.id, ruolo: 'owner' })
      break
    }

    const ponte = corrieri.find((c: any) => c.tipo === 'moovexpress')
    if (!ponte) break
    const fornPonte = (ponte.credenziali || {}).fornitore_master_id || null

    // CODICE genuino? Legame corrieri_condivisi ATTIVO: questo master compra da quel fornitore.
    let link: any = null
    if (fornPonte) {
      const { data } = await admin.from('corrieri_condivisi')
        .select('fornitore_master_id,cliente_ledger_id,stato')
        .eq('master_id', cur).eq('fornitore_master_id', fornPonte).eq('stato', 'attiva')
        .limit(1).maybeSingle()
      link = data || null
    }
    if (link) {
      out.push({ master: cur, fornitore: link.fornitore_master_id, conto: 'ledger', ledgerClienteId: link.cliente_ledger_id || null, corriereId: ponte.id, ruolo: 'codice' })
      cur = link.fornitore_master_id
      continue
    }

    // Nessun legame codice → il ponte è una COPIA colata dall'albero: lo IGNORO e salgo l'albero.
    const { data: m }: any = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    const padre: string | null = m?.parent_master_id || null
    if (padre && (await corrieriPerNome(admin, padre, nomeContratto)).length) {
      out.push({ master: cur, fornitore: padre, conto: 'credito', ledgerClienteId: null, corriereId: ponte.id, ruolo: 'albero' })
      cur = padre
      continue
    }

    // Ponte orfano (né codice né padre col contratto): lo trattiamo come owner di fatto, per non perdere il costo.
    out.push({ master: cur, fornitore: null, conto: (await eVertice(admin, cur)) ? 'credito' : 'credito_proprio', ledgerClienteId: null, corriereId: ponte.id, ruolo: 'owner' })
    break
  }
  return out
}

/* LE GAMBE di una spedizione condivisa, in ordine ORIGINANTE → … → OWNER. Le 3 (o più) righe spedizioni della
 * catena condividono lo STESSO tracking_number (è lo stesso pacco fisico), ma sono master diversi legati da
 * `raw_response.venditore_spedizione_id` (ogni gamba punta alla gamba del suo VENDITORE, quella sotto). Serve a
 * TUTTI i flussi post-creazione (ripesatura/reso/giacenza/COD/annullo), che oggi cercano la spedizione PER
 * tracking con `.maybeSingle()` e su più righe FALLISCONO. Qui si disambigua in modo robusto: l'originante è la
 * gamba che nessun'altra indica come venditore; da lì si scende seguendo venditore_spedizione_id fino all'owner
 * (venditore nullo). SOLA LETTURA. Per una spedizione NORMALE (una riga per tracking) ritorna quella sola gamba. */
export interface GambaSpedizione {
  spedizioneId: string
  masterId: string
  numero: string
  tipo: string                       // tipo del corriere della gamba (moovexpress per le gambe-ponte, reale per l'owner)
  venditoreSpedizioneId: string | null
}

export async function risolviGambeSpedizione(admin: any, tracking: string): Promise<GambaSpedizione[]> {
  if (!tracking) return []
  const { data } = await admin.from('spedizioni')
    .select('id,master_id,numero,raw_response,corrieri(tipo)')
    .eq('tracking_number', tracking)
  const legs: GambaSpedizione[] = (data || []).map((s: any) => ({
    spedizioneId: s.id,
    masterId: s.master_id,
    numero: s.numero,
    tipo: (Array.isArray(s.corrieri) ? s.corrieri[0]?.tipo : s.corrieri?.tipo) || '',
    venditoreSpedizioneId: (s.raw_response || {}).venditore_spedizione_id || null,
  }))
  if (legs.length <= 1) return legs
  const byId = new Map(legs.map(l => [l.spedizioneId, l]))
  const indicati = new Set(legs.map(l => l.venditoreSpedizioneId).filter(Boolean) as string[])
  // ORIGINANTE = la gamba che nessun'altra compra (non è il venditore di nessuno).
  let cur: GambaSpedizione | null = legs.find(l => !indicati.has(l.spedizioneId)) || null
  const ordine: GambaSpedizione[] = []
  const visti = new Set<string>()
  while (cur && !visti.has(cur.spedizioneId)) {
    visti.add(cur.spedizioneId)
    ordine.push(cur)
    cur = cur.venditoreSpedizioneId ? (byId.get(cur.venditoreSpedizioneId) || null) : null
  }
  // Se la catena-gambe non si chiude (dati sporchi), torna almeno ciò che ho raccolto o tutte le righe.
  return ordine.length ? ordine : legs
}

/* CHIAVE DI DISPATCH per una spedizione condivisa. NON la chiave del ponte dell'ORIGINANTE (che può essere
 * una COPIA colata giù per l'albero = la fuga di credenziale), ma quella del PRIMO detentore-CODICE risalendo
 * la catena: è il punto dove parte davvero il dispatch esterno (modello B di CONDIVISIONE-MODELLO.md: i
 * sub-albero spediscono "in casa", il dispatch esterno parte dal primo nodo-CODICE col SUO ponte+ledger, su
 * fino all'owner, ricorsivo). Trovata via `corrieri_condivisi` (la verità dei legami), MAI per nome. Per un
 * originante già detentore-codice (es. MULTI→Wave) torna la sua stessa chiave. Null se la catena NON ha un
 * salto codice (misconfig): il chiamante allora NON dispaccia. SOLA LETTURA. */
export interface ChiaveDispatch { api_key: string; base_url?: string; fornitore_master_id?: string; corriere_origine_id?: string }

export async function risolviChiaveDispatch(
  admin: any, masterOriginante: string, nomeContratto: string,
): Promise<ChiaveDispatch | null> {
  const catena = await risolviCatenaCondivisione(admin, masterOriginante, nomeContratto)
  const primoCodice = catena.find(l => l.ruolo === 'codice')
  if (!primoCodice) return null
  const { data: c }: any = await admin.from('corrieri').select('credenziali').eq('id', primoCodice.corriereId).maybeSingle()
  const cr = (c?.credenziali || {}) as any
  if (!cr.api_key) return null
  return { api_key: cr.api_key, base_url: cr.base_url, fornitore_master_id: cr.fornitore_master_id, corriere_origine_id: cr.corriere_origine_id }
}

/* PIANO DEGLI ADDEBITI: la catena risolta + l'IMPORTO di ogni livello, preso dal SUO listino (lo stesso
 * calcolo del motore prezzi). Per ogni livello: quanto paga, su quale conto. SOLA LETTURA (non addebita):
 * è ciò che il nuovo flusso scriverà, e ciò che la prova "shadow" confronta coi movimenti veri. */
export interface MovimentoPianificato {
  master: string
  conto: ContoCondivisione
  ledgerClienteId: string | null
  fornitore: string | null
  ruolo: 'albero' | 'codice' | 'owner'
  importo: number | null     // negativo (addebito); null se il listino non prezza questo livello
}

// Contesto di prezzo della spedizione, uguale per tutti i livelli (come i params di costruisciCatena).
interface ContestoPrezzoCondivisione {
  dest: { cap: string; provincia: string; citta: string; paese: string }
  packages: any[]
  contrassegno?: number
  assicurazione?: number
  serviziAccessori?: { nome?: string }[]
  // MITTENTE (partenza): per il supplemento "zona mittente disagiato", che ogni livello paga.
  mittCap?: string
  mittProvincia?: string
  mittPaese?: string
}

// COSTO di UN livello-ALBERO, calcolato ESATTAMENTE come un livello di costruisciCatena (lib/cascata.ts):
//  - nolo+zona dal listino del livello via calcolaPrezzoCorriereDettaglio, che include GIÀ contrassegno,
//    assicurazione e supplemento-mittente (origine disagiata);
//  - accessori (Exchange, Sabato…) via la STESSA accessoriDelLivello, sul nolo+fuel+sponda del livello;
//  - agevolazione (reale vs volumetrico) che segue il flag del FORNITORE (il livello sopra che vende), non
//    il suo — identico alla cascata. Senza questi, i livelli-albero erano sotto-prezzati su COD/isole/accessori.
// Ritorna l'importo NEGATIVO (addebito) o null se il listino non prezza il livello.
async function costoLivelloAlbero(
  admin: any,
  liv: LivelloCondivisione,
  nomeContratto: string,
  pesoReale: number,
  ctx: ContestoPrezzoCondivisione,
): Promise<number | null> {
  // Corriere del FORNITORE per questo contratto: serve sia all'agevolazione (sotto) sia al ripiego.
  let supCorrId: string | null = null
  let pesoSuRealeCost: boolean | undefined = undefined
  if (liv.fornitore) {
    supCorrId = await corriereDiMasterPerNome(admin, liv.fornitore, nomeContratto)
    if (supCorrId) {
      const [supCorrRes, supListRes]: any = await Promise.all([
        admin.from('corrieri').select('settings').eq('id', supCorrId).maybeSingle(),
        admin.from('listini_corrieri').select('solo_peso_reale').eq('master_id', liv.fornitore).eq('corriere_id', supCorrId),
      ])
      const supSolo = (supListRes?.data || []).some((l: any) => l.solo_peso_reale)
      pesoSuRealeCost = pesoSuReale(supCorrRes?.data?.settings || {}, ctx.packages, pesoReale, supSolo)
    }
  }

  const pz = await calcolaPrezzoCorriereDettaglio(admin, {
    corriereId: liv.corriereId, masterId: liv.master,
    provincia: ctx.dest.provincia, cap: ctx.dest.cap, citta: ctx.dest.citta, paese: ctx.dest.paese,
    pesoReale, packages: ctx.packages,
    contrassegno: ctx.contrassegno || 0, assicurazione: ctx.assicurazione || 0,
    pesoSuRealeCost,
    mittCap: ctx.mittCap, mittProvincia: ctx.mittProvincia, mittPaese: ctx.mittPaese,
  })

  // RIPIEGO, come costruisciCatena (lib/cascata.ts): se il listino del livello non prezza la destinazione
  // (estero senza zona estera, origine `su_mittente` non prezzata, zona esclusiva senza fascia), si cade sul
  // listino ASSEGNATO DAL PADRE (parent_listino_id), prezzando il corriere del PADRE (supCorrId, già
  // calcolato = corriereDiMasterPerNome del fornitore). SENZA questo il sub pagherebbe 0 e il detentore
  // assorbirebbe in silenzio (bug cascata-ripiego-listino-padre). Il corriere del padre DEVE essere passato,
  // altrimenti calcolaPrezzoListino sceglierebbe la tariffa più economica del listino (altro buco noto).
  if (!pz || pz.totale == null || !isFinite(pz.totale)) {
    const { data: mRow }: any = await admin.from('masters').select('parent_listino_id').eq('id', liv.master).maybeSingle()
    if (!mRow?.parent_listino_id || !supCorrId) {
      console.warn(`[condivisione-catena] livello ${liv.master}: nessun prezzo né ripiego (parent_listino=${mRow?.parent_listino_id || 'n/d'}, corrPadre=${supCorrId || 'n/d'})`)
      return null
    }
    const ris = await calcolaPrezzoListino(admin, {
      listinoId: mRow.parent_listino_id, provincia: ctx.dest.provincia,
      packages: ctx.packages, cap: ctx.dest.cap, paese: ctx.dest.paese, citta: ctx.dest.citta,
      corriereId: supCorrId,
      mittCap: ctx.mittCap, mittProvincia: ctx.mittProvincia, mittPaese: ctx.mittPaese,
    })
    if (!ris) {
      console.warn(`[condivisione-catena] livello ${liv.master}: ripiego su listino padre senza tariffa`)
      return null
    }
    return -Math.abs(Math.round(ris.prezzo * 100) / 100)
  }

  let prezzo = pz.totale
  if ((ctx.serviziAccessori || []).length) {
    const acc = await accessoriDelLivello(
      admin, liv.master, liv.corriereId, ctx.serviziAccessori!,
      (pz.nolo || 0) + (pz.fuel || 0) + (pz.sponda || 0),
    )
    prezzo = Math.round((prezzo + acc.totale) * 100) / 100
  }
  return -Math.abs(Math.round(prezzo * 100) / 100)
}

export async function pianoAddebitiCondivisione(
  admin: any,
  p: {
    masterOriginante: string; nomeContratto: string
  } & ContestoPrezzoCondivisione,
): Promise<MovimentoPianificato[]> {
  const catena = await risolviCatenaCondivisione(admin, p.masterOriginante, p.nomeContratto)
  const pesoReale = (p.packages || []).reduce((s: number, x: any) => s + (parseFloat(x?.weight) || 0), 0) || 1
  const out: MovimentoPianificato[] = []
  for (const liv of catena) {
    // SOLO i livelli d'ALBERO sono addebitati dal NUOVO codice (crea), prezzati dal listino del loro
    // corriere con la STESSA logica della cascata (COD/assic/mittente/accessori/agevolazione). I livelli
    // CODICE e l'OWNER li addebita il DISPATCH esistente (ledger lato venditore + credito_proprio
    // dell'owner), col prezzo autorevole del ledger — NON si riprezzano qui (il listino del ponte può
    // essere sfasato: vedi Wave 4,48 vs 4,28 reale). Per quelli importo=null (dal dispatch).
    const importo = liv.ruolo === 'albero'
      ? await costoLivelloAlbero(admin, liv, p.nomeContratto, pesoReale, p)
      : null
    out.push({
      master: liv.master, conto: liv.conto, ledgerClienteId: liv.ledgerClienteId,
      fornitore: liv.fornitore, ruolo: liv.ruolo, importo,
    })
  }
  return out
}

/* GATING del credito per la CONDIVISIONE — sostituisce verificaCreditoCatena per i corrieri `tipo='moovexpress'`.
 * Controlla SOLO i livelli-ALBERO sul loro `masters.credito`, con la STESSA regola della cascata: blocca solo i
 * `credito_scalare` a secco (i `fattura_*` non si gatano mai). I livelli CODICE (ledger) e l'OWNER li gata il
 * DISPATCH esistente lato venditore (/api/v1 controlla il credito del cliente-ledger, a ogni salto). NON sale
 * l'albero fino alla piattaforma: era l'errore "MoovExpress non ha listino" con cui costruisciCatena BLOCCAVA
 * ogni spedizione condivisa (il detentore sta sul ramo CODICE, non nell'albero dell'originante). SOLA LETTURA.
 * NB: le guardie "due zone sulla stessa spedizione" e "COD/accessorio venduto ma non prezzato" di
 * verificaCreditoCatena NON sono (ancora) replicate qui — da valutare come affinamento, con i numeri. */
export async function verificaCreditoCondivisione(
  admin: any,
  p: { masterOriginante: string; nomeContratto: string } & ContestoPrezzoCondivisione,
  // `servizioNonPrezzato` è nel tipo per combaciare con verificaCreditoCatena (le due sono intercambiabili nei
  // chiamanti): qui non viene mai valorizzato — la guardia COD-non-prezzato è un affinamento ancora da fare.
): Promise<{ ok: boolean; errore?: string; masterInsufficiente?: string; servizioNonPrezzato?: boolean }> {
  const piano = await pianoAddebitiCondivisione(admin, p)
  for (const liv of piano) {
    if (liv.ruolo !== 'albero' || liv.importo == null) continue
    const prezzo = Math.abs(liv.importo)
    if (!(prezzo > 0)) continue
    const { data: m }: any = await admin.from('masters').select('nome,tipo_contratto,credito').eq('id', liv.master).maybeSingle()
    if (!m) continue
    // Stessa regola di verificaCreditoCatena: solo i prepagati (credito_scalare) si bloccano a secco.
    if ((m.tipo_contratto || 'credito_scalare') === 'credito_scalare' && Number(m.credito || 0) < prezzo) {
      return {
        ok: false, masterInsufficiente: liv.master,
        errore: `Credito insufficiente: "${m.nome}" ha € ${Number(m.credito || 0).toFixed(2)} ma servono € ${prezzo.toFixed(2)}.`,
      }
    }
  }
  return { ok: true }
}

/* ESEGUE l'addebito del tratto-ALBERO: ogni sub-master dall'originante fino al primo detentore-CODICE
 * paga il suo fornitore (il PADRE) sul conto d'albero ESISTENTE (masters.credito, via fn_conto_di='rete'
 * — i ponti sono proprio=false). I livelli CODICE (ledger) e l'OWNER (credito_proprio) li addebita il
 * DISPATCH esistente (/api/v1 lato venditore): questa funzione NON li tocca. Va chiamata SOLO per i
 * corrieri tipo='moovexpress', DOPO il dispatch, AL POSTO della vecchia addebitaCatena (che faceva il
 * doppio su credito_proprio). La spedizione (spedizioneId) deve ESISTERE: fn_conto_di legge da lì il
 * nome-contratto per decidere il conto. SOLO questa funzione scrive; il resto del modulo è lettura. */
export async function addebitaTreeCondivisione(
  admin: any,
  p: {
    masterOriginante: string; nomeContratto: string
    numero: string; destNome?: string
    spedizioneId: string | null; createdBy?: string | null
  } & ContestoPrezzoCondivisione,
): Promise<{ addebitati: number }> {
  // La spedizione DEVE esistere: l'anti-doppione uniq_mov_sped_master ha WHERE spedizione_id IS NOT NULL,
  // quindi senza id due addebiti identici passerebbero entrambi. Meglio non addebitare che addebitare doppio.
  if (!p.spedizioneId) throw new Error('addebitaTreeCondivisione: spedizioneId mancante')
  const piano = await pianoAddebitiCondivisione(admin, {
    masterOriginante: p.masterOriginante, nomeContratto: p.nomeContratto,
    dest: p.dest, packages: p.packages,
    contrassegno: p.contrassegno, assicurazione: p.assicurazione, serviziAccessori: p.serviziAccessori,
    mittCap: p.mittCap, mittProvincia: p.mittProvincia, mittPaese: p.mittPaese,
  })
  let addebitati = 0
  for (const liv of piano) {
    if (liv.ruolo !== 'albero' || !liv.fornitore || liv.importo == null || !(liv.importo < 0)) continue
    try {
      await registraMovimentoMaster(admin, {
        masterOwnerId: liv.fornitore,      // il PADRE (fornitore diretto): dimensione owner del movimento
        masterTargetId: liv.master,         // chi PAGA (il sub) → scala il SUO masters.credito ('rete')
        tipo: 'spedizione',
        descrizione: descrizioneSpedizione(p.numero, p.destNome),
        riferimento: p.numero,
        importo: liv.importo,
        spedizioneId: p.spedizioneId,
        createdBy: p.createdBy ?? null,
      })
      addebitati++
    } catch (e) {
      console.error(`[condivisione-catena] addebito albero ${liv.master}→${liv.fornitore}:`, (e as any)?.message)
    }
  }
  return { addebitati }
}
