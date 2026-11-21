import { createAdminSupabase } from '@/lib/supabase-admin'
import { risolviChiaveDispatch, pianoAddebitiCondivisione } from '@/lib/condivisione-catena'
import { costruisciCatena } from '@/lib/cascata'
import { valutaLivelloV1 } from '@/lib/v1-livello'
import { createHash } from 'node:crypto'

// IL PONTE UNICO DEI CONTRATTI CONDIVISI: il lavoro di tutta la fila dei venditori in un posto solo (PONTE-UNICO.md).
//
// Oggi un condiviso e' una staffetta: la creazione chiama /api/v1/shipments del venditore, che chiama quella del
// venditore sopra, e cosi' via fino a chi detiene il contratto vero. Ogni passaggio rifa' i suoi controlli in fila
// agli altri (0,6-1,2 s l'uno) e scrive all'indietro. Qui la fila si risolve una volta, e i livelli si valutano
// INSIEME con la stessa funzione che usa la staffetta (lib/v1-livello): una regola sola, mai riscritta.
//
// Per ora (fase 2) serve SOLO a calcolare in ombra e a confrontare con quello che la staffetta ha scritto davvero
// (lib/ponte-ombra). Niente qui scrive: ne' righe, ne' movimenti, ne' prenotazioni, ne' l'ultimo uso delle chiavi.

type Admin = ReturnType<typeof createAdminSupabase>

export type LivelloPonte = {
  chiaveId: string
  chiave: string             // la chiave del ponte, come la presenta la staffetta: mai nei log ne' nei registri
  clienteId: string          // il cliente d'ingrosso presso il venditore (il conto di chi compra)
  venditoreId: string        // il master che vende a questo livello
  corriereId: string         // il contratto del venditore su cui arriva la richiesta
  tipo: string               // 'moovexpress' = il venditore a sua volta compra da sopra
  nomeContratto: string
  corriereMasterId: string
}

// Quanti venditori in fila al massimo. Oggi la fila piu' lunga ne ha due (Wave, LOGIXIA): oltre, e' un giro chiuso.
const SALTI_MASSIMI = 6

// LA FILA DEI VENDITORI, come la percorre la staffetta. Dal master d'origine si prende la chiave del primo
// detentore-codice (risolviChiaveDispatch, la stessa della creazione); la chiave dice chi compra (il cliente
// d'ingrosso) e su quale contratto del venditore. Se quel contratto e' a sua volta un ponte, si risale dal
// venditore come fa la sua /api/v1/shipments. Gli stessi controlli di autenticaApiKey (chiave, cliente e
// contratto attivi), ma in sola lettura: niente ultimo uso, niente contatore di frequenza.
//
// Con `corriereOrigine` (il contratto della spedizione d'origine) si prova prima la fila letta dai puntatori, in un
// colpo solo; se non torna in ogni dettaglio, si fa salto per salto come la staffetta.
export async function filaDelPonte(
  admin: Admin, masterOrigine: string, nomeContratto: string, corriereOrigine?: string,
): Promise<{ fila: LivelloPonte[]; errore?: string; strada: 'puntatori' | 'salti' }> {
  if (corriereOrigine) {
    const veloce = await filaDaiPuntatori(admin, corriereOrigine)
    if (veloce) return { fila: veloce, strada: 'puntatori' }
  }
  return { ...(await filaSaltoPerSalto(admin, masterOrigine, nomeContratto)), strada: 'salti' }
}

// Salto per salto: a ogni venditore si rifa' la catena per nome (risolviCatenaCondivisione) e si legge la chiave.
// E' esattamente il giro della staffetta, ma ogni salto aspetta il precedente: circa mezzo secondo in produzione.
export async function filaSaltoPerSalto(
  admin: Admin, masterOrigine: string, nomeContratto: string,
): Promise<{ fila: LivelloPonte[]; errore?: string }> {
  const fila: LivelloPonte[] = []
  let master = masterOrigine, nome = nomeContratto
  for (let salto = 1; salto <= SALTI_MASSIMI; salto++) {
    const cred = await risolviChiaveDispatch(admin, master, nome)
    if (!cred?.api_key) return { fila, errore: `salto ${salto}: contratto non configurato (nessuna chiave)` }
    // Lookup per hash, non per valore: la chiave del ponte non deve finire nell'URL/log (come autenticaChiave).
    const hChiave = createHash('sha256').update(cred.api_key).digest('hex')
    const { data: k } = await admin.from('api_keys')
      .select('id,cliente_id,master_id,corriere_id,attivo').eq('chiave_hash', hChiave).maybeSingle()
    if (!k || (k as any).attivo === false) return { fila, errore: `salto ${salto}: chiave ${k ? 'revocata' : 'sconosciuta'}` }
    const [{ data: cli }, { data: cor }] = await Promise.all([
      admin.from('clienti').select('attivo,master_id').eq('id', (k as any).cliente_id).maybeSingle(),
      admin.from('corrieri').select('id,tipo,nome_contratto,master_id,attivo').eq('id', (k as any).corriere_id).maybeSingle(),
    ])
    if (!cli || (cli as any).attivo === false) return { fila, errore: `salto ${salto}: cliente d'ingrosso disattivato` }
    if (cor && (cor as any).attivo === false) return { fila, errore: `salto ${salto}: contratto del venditore spento` }
    fila.push({
      chiaveId: (k as any).id, chiave: String(cred.api_key), clienteId: (k as any).cliente_id, venditoreId: (cli as any).master_id,
      corriereId: (k as any).corriere_id, tipo: String((cor as any)?.tipo || ''),
      nomeContratto: String((cor as any)?.nome_contratto || ''), corriereMasterId: String((cor as any)?.master_id || ''),
    })
    if ((cor as any)?.tipo !== 'moovexpress') return { fila }
    master = (cli as any).master_id; nome = (cor as any).nome_contratto
  }
  return { fila, errore: `oltre ${SALTI_MASSIMI} salti: la fila non arriva a un contratto vero` }
}

// LA FILA IN UN COLPO, DAI PUNTATORI. catena_contratto (la funzione del database che segue "da chi lo compro",
// corrieri.fornitore_corriere_id) da' tutta la fila del contratto d'origine in una lettura; i suoi salti
// 'collegamento' sono i passaggi della staffetta, ognuno col suo conto d'ingrosso. Poi in una sola volta i
// contratti (con la chiave di chi compra), i clienti d'ingrosso e le loro chiavi.
//
// Vale SOLO se torna in ogni dettaglio con quello che farebbe la staffetta: la chiave del ponte di chi compra
// esiste, e' attiva ed e' proprio quella del conto d'ingrosso del collegamento sul contratto del venditore
// seguente; cliente e contratti attivi; un ponte a ogni salto tranne l'ultimo, che arriva al contratto vero.
// Qualunque cosa non torni (anche un guasto di lettura) -> null, e si fa salto per salto: gli errori e i casi
// strani restano quelli di oggi, con le loro parole.
async function filaDaiPuntatori(admin: Admin, corriereOrigine: string): Promise<LivelloPonte[] | null> {
  const { data: righe, error } = await admin.rpc('catena_contratto', { p_corriere_id: corriereOrigine })
  const r = (Array.isArray(righe) ? righe : []) as any[]
  if (error || !r.length || r[r.length - 1].salto !== 'detentore' || r.some(x => x.salto === 'interrotta')) return null
  const salti = r.map((x, i) => ({ x, su: r[i + 1] })).filter(s => s.x.salto === 'collegamento')
  if (!salti.length || salti.length > SALTI_MASSIMI || salti.some(s => !s.su || !s.x.ledger_cliente_id)) return null
  const idsLedger = salti.map(s => String(s.x.ledger_cliente_id))
  const [cors, clis, chiavi] = await Promise.all([
    admin.from('corrieri').select('id,tipo,nome_contratto,master_id,attivo,credenziali').in('id', [...new Set(r.map(x => String(x.corriere_id)))]),
    admin.from('clienti').select('id,attivo,master_id').in('id', idsLedger),
    admin.from('api_keys').select('id,chiave,cliente_id,corriere_id,attivo').in('cliente_id', idsLedger),
  ])
  if (cors.error || clis.error || chiavi.error) return null
  const corDi = new Map((cors.data || []).map((c: any) => [c.id, c]))
  const fila: LivelloPonte[] = []
  for (let n = 0; n < salti.length; n++) {
    const { x, su } = salti[n]
    const chiave = (corDi.get(x.corriere_id) as any)?.credenziali?.api_key
    const k: any = chiave ? (chiavi.data || []).find((c: any) => c.chiave === chiave) : null
    if (!k || k.attivo === false || k.cliente_id !== x.ledger_cliente_id || k.corriere_id !== su.corriere_id) return null
    const cli: any = (clis.data || []).find((c: any) => c.id === k.cliente_id)
    const cor: any = corDi.get(k.corriere_id)
    if (!cli || cli.attivo === false || cli.master_id !== su.master_id || !cor || cor.attivo === false) return null
    const ultimo = n === salti.length - 1
    if ((cor.tipo === 'moovexpress') === ultimo) return null
    fila.push({
      chiaveId: k.id, chiave: String(chiave), clienteId: k.cliente_id, venditoreId: cli.master_id, corriereId: k.corriere_id,
      tipo: String(cor.tipo || ''), nomeContratto: String(cor.nome_contratto || ''), corriereMasterId: String(cor.master_id || ''),
    })
  }
  return fila
}

// Il contesto di prezzo, uguale per tutti i livelli: e' quello che la staffetta passa di mano in mano.
export type ContestoPonte = {
  dest: { cap: string; provincia: string; citta: string; paese: string }
  packages: any[]
  contrassegno: number
  assicurazione: number
  serviziAccessori?: { nome?: string }[]
  mittCap: string
  mittProvincia: string
  mittPaese: string
}

export type LivelloValutato = LivelloPonte & (
  | { ok: true; costoCliente: number; zona: any; pesoFatturato: number | null }
  | { ok: false; stato: number; errore: string }
)

// Un movimento che il ponte unico scriverebbe. `riga` = su quale spedizione: 0 = quella d'origine, i = la gamba
// del livello i. Gli importi sono negativi (addebiti), come nella tabella dei movimenti.
export type MovimentoAtteso = {
  riga: number
  owner: string              // master_id del movimento
  target: string | null      // master_target_id (chi paga, sui movimenti fra master)
  cliente: string | null     // cliente_id (chi paga, sui movimenti del cliente d'ingrosso)
  importo: number
  perche: 'albero' | 'ledger' | 'detentore'
}

const cent = (x: any) => Math.round(Number(x || 0) * 100) / 100

// VALUTA TUTTA LA FILA, INSIEME: tutto quello che la staffetta decide PRIMA di comprare la lettera di vettura.
// `body` e' la richiesta che la staffetta manda al primo venditore; `contesto` e' lo stesso contenuto nella forma
// del piano degli addebiti. Il conto del detentore viene dopo il corriere vero: movimentiDelDetentore.
export async function valutaPonteUnico(
  admin: Admin,
  p: { masterOrigine: string; nomeContratto: string; corriereOrigine?: string; body: any; contesto: ContestoPonte },
): Promise<{ fila: LivelloPonte[]; strada: string; livelli: LivelloValutato[]; movimenti: MovimentoAtteso[]; errore?: string; ms: { fila: number; tutto: number } }> {
  const t0 = Date.now()
  const { fila, errore, strada } = await filaDelPonte(admin, p.masterOrigine, p.nomeContratto, p.corriereOrigine)
  const msFila = Date.now() - t0
  if (errore || !fila.length) return { fila, strada, livelli: [], movimenti: [], errore: errore || 'fila vuota', ms: { fila: msFila, tutto: Date.now() - t0 } }

  const c = p.contesto
  const pianoAlbero = (master: string, nome: string, serviziAccessori?: { nome?: string }[]) => pianoAddebitiCondivisione(admin, {
    masterOriginante: master, nomeContratto: nome, dest: c.dest, packages: c.packages,
    contrassegno: c.contrassegno, assicurazione: c.assicurazione, serviziAccessori,
    mittCap: c.mittCap, mittProvincia: c.mittProvincia, mittPaese: c.mittPaese,
  })

  // Tutto in parallelo: ogni livello e il piano d'albero dell'origine e di ogni venditore intermedio. Nessuno
  // dipende dall'altro: i prezzi di ogni livello stanno nel SUO listino.
  const [livelli, alberoOrigine, alberiIntermedi] = await Promise.all([
    Promise.all(fila.map(async (l): Promise<LivelloValutato> => {
      const v = await valutaLivelloV1(admin, { clienteId: l.clienteId, corriereId: l.corriereId }, p.body, { soloValuta: true })
      if (v instanceof Response) {
        const j: any = await v.json().catch(() => ({}))
        return { ...l, ok: false, stato: v.status, errore: String(j?.error || '') }
      }
      return { ...l, ok: true, costoCliente: cent(v.costoCliente), zona: v.ris.zona, pesoFatturato: (v.ris as any).peso_fatturato ?? null }
    })),
    pianoAlbero(p.masterOrigine, p.nomeContratto, c.serviziAccessori),
    // La v1 di un venditore intermedio addebita i SUOI livelli d'albero (di solito nessuno), senza accessori.
    Promise.all(fila.map(l => l.tipo === 'moovexpress' ? pianoAlbero(l.venditoreId, l.nomeContratto) : Promise.resolve([]))),
  ])

  const movimenti: MovimentoAtteso[] = []
  const daAlbero = (riga: number, piano: any[]) => {
    for (const liv of piano) {
      if (liv.ruolo !== 'albero' || !liv.fornitore || liv.importo == null || !(liv.importo < 0)) continue
      movimenti.push({ riga, owner: liv.fornitore, target: liv.master, cliente: null, importo: cent(liv.importo), perche: 'albero' })
    }
  }
  daAlbero(0, alberoOrigine)
  livelli.forEach((l, i) => {
    if (l.ok && l.costoCliente > 0) movimenti.push({ riga: i + 1, owner: l.venditoreId, target: null, cliente: l.clienteId, importo: -l.costoCliente, perche: 'ledger' })
    daAlbero(i + 1, alberiIntermedi[i])
  })
  const errLivello = livelli.find(l => !l.ok) as any
  return {
    fila, strada, livelli, movimenti,
    errore: errLivello ? `livello ${livelli.indexOf(errLivello) + 1}: ${errLivello.stato} ${errLivello.errore}` : undefined,
    ms: { fila: msFila, tutto: Date.now() - t0 },
  }
}

// IL CONTO DEL DETENTORE, dopo il corriere vero: la sua /api/v1/shipments chiama addebitaCatena col costo del
// corriere (`costo`), e ogni livello della catena con un prezzo registra il suo costo sul proprio conto. Qui la
// stessa catena (costruisciCatena), senza scrivere. `riga` = l'indice della gamba del detentore.
export async function movimentiDelDetentore(
  admin: Admin, ultimo: LivelloPonte, c: ContestoPonte, costo: number, riga: number,
): Promise<{ movimenti: MovimentoAtteso[]; errore?: string }> {
  if (ultimo.tipo === 'moovexpress') return { movimenti: [] }
  const { catena, errore } = await costruisciCatena(admin, {
    masterDirettoId: ultimo.venditoreId, corriereOwnerId: ultimo.corriereMasterId, costoSpedizione: costo,
    provincia: c.dest.provincia, packages: c.packages, cap: c.dest.cap, paese: c.dest.paese, citta: c.dest.citta,
    corriereNome: ultimo.nomeContratto, contrassegno: c.contrassegno, assicurazione: c.assicurazione,
    mittCap: c.mittCap, mittProvincia: c.mittProvincia, mittPaese: c.mittPaese,
  })
  const movimenti: MovimentoAtteso[] = []
  for (const liv of catena) {
    if (!(liv.prezzo > 0)) continue
    movimenti.push({ riga, owner: liv.masterId, target: liv.masterId, cliente: null, importo: -cent(liv.prezzo), perche: 'detentore' })
  }
  return { movimenti, errore }
}
