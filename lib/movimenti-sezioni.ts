import { haContoProprio } from '@/lib/cascata'

/* LISTA MOVIMENTI A SEZIONI: un conto, una lista.
 *
 * Un master puo' avere piu' conti, e la lista li mescolava. Sotto "Credito · MULTIEXPRESS −0,57" Wave
 * vedeva le sue spedizioni GLS col saldo del conto proprio (−318,74): righe di due conti diversi, con
 * un saldo che saltava dall'uno all'altro. Lorenzo (21/10/2026): una sezione per il master sopra (tutti
 * i contratti che ti vende, un saldo solo perche' ricarica un conto solo, con il filtro corriere
 * dentro), una per ogni contratto comprato da un altro master (il ledger "(ingrosso)" presso di lui),
 * una per ogni contratto TUO — anche vuota: "quando si crea un corriere, in automatico si crea anche
 * una lista movimenti" — e le commissioni. GLS nazionale ed Europa sono due righe corrieri, quindi due
 * sezioni. Il totale speso lo fa chi guarda, sommando i conti.
 *
 * Tutto col client di servizio: i ledger la RLS li nasconde al master stesso. Quali ledger sono suoi si
 * ricava SOLO da corrieri_condivisi (master = chi guarda): il browser sceglie una sezione per id, mai un
 * ledger o un cliente. */

export type Sezione = {
  id: string
  tipo: 'rete' | 'fornitore' | 'proprio' | 'commissioni'
  etichetta: string
  titolo: string
  sottotitolo: string
  saldo: number
  movimenti: number | null   // solo dove costa poco saperlo (contratti propri); null = non contato
}

export type ArgsSezione = { master: string; sezione: 'rete' | 'ledger' | 'proprio' | 'commissioni'; ledger?: string; nome?: string }

const norm = (s: any) => String(s || '').trim().toLowerCase()
const r2 = (n: number) => Math.round(n * 100) / 100

// Una riga del conto proprio che appartiene al contratto di un'altra sezione (vedi fuoriConto).
export type RigaFuoriConto = { id: string; tipo: string; descrizione: string; riferimento: string | null; importo: number; created_at: string; corriere: string | null }

// saldiPropri=false: salta la somma dei contratti propri (la query piu' pesante: LOGIXIA ha 30.000 righe su
// SDA EXPRESS L) e le righe fuori conto. Serve all'intestazione, che a ogni cambio pagina deve solo sapere
// QUANTI conti ci sono; i saldi li chiede quando si apre la tendina. In quel modo i saldi dei contratti
// propri valgono 0: chi lo usa non li mostra.
export async function sezioniDelMaster(admin: any, io: string, o: { saldiPropri?: boolean } = {}): Promise<{
  sezioni: Sezione[]
  argsDi: (id: string) => ArgsSezione | null
  fuoriContoDi: (id: string) => RigaFuoriConto[]
  corrieriDi: (id: string) => string[]
}> {
  const [{ data: me }, { data: legami }, { data: miei }, { data: riep, error: eRiep }] = await Promise.all([
    admin.from('masters').select('nome,parent_master_id,credito,commissioni_moovexpress').eq('id', io).single(),
    // Anche i legami revocati: il conto presso il fornitore e il suo storico restano.
    admin.from('corrieri_condivisi').select('id,stato,fornitore_master_id,cliente_ledger_id,corriere_id')
      .eq('master_id', io).not('cliente_ledger_id', 'is', null).order('created_at', { ascending: true }),
    admin.from('corrieri').select('id,nome_contratto,proprio,collegamento_id').eq('master_id', io).order('nome_contratto', { ascending: true }),
    o.saldiPropri === false ? Promise.resolve({ data: [] as any[], error: null }) : admin.rpc('movimenti_sezioni_proprio_v1', { p_master: io }),
  ])
  if (eRiep) throw new Error(eRiep.message)

  const leg = ((legami || []) as any[]).filter((l, i, a) => a.findIndex(x => x.cliente_ledger_id === l.cliente_ledger_id) === i)
  const fornIds = [...new Set(leg.map(l => l.fornitore_master_id).filter(Boolean))]
  const corrVend = leg.map(l => l.corriere_id).filter(Boolean)
  const [{ data: padre }, { data: fornM }, { data: corrV }, { data: ledg }] = await Promise.all([
    (me as any)?.parent_master_id
      ? admin.from('masters').select('nome,parent_master_id').eq('id', (me as any).parent_master_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
    fornIds.length ? admin.from('masters').select('id,nome').in('id', fornIds) : Promise.resolve({ data: [] as any[] }),
    corrVend.length ? admin.from('corrieri').select('id,nome_contratto').in('id', corrVend) : Promise.resolve({ data: [] as any[] }),
    leg.length ? admin.from('clienti').select('id,credito').in('id', leg.map(l => l.cliente_ledger_id)) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeForn = new Map(((fornM || []) as any[]).map(f => [f.id, f.nome]))
  const nomeCorrV = new Map(((corrV || []) as any[]).map(c => [c.id, c.nome_contratto]))
  const creditoLedger = new Map(((ledg || []) as any[]).map(c => [c.id, Number(c.credito || 0)]))
  const rp = new Map(((riep || []) as any[]).map(r => [String(r.chiave), { n: Number(r.n || 0), somma: r2(Number(r.somma || 0)) }]))

  // Attaccato alla piattaforma (MULTIEXPRESS): quello e' il suo conto principale, non "un master sopra".
  const vertice = !!padre && !(padre as any).parent_master_id
  const dueConti = await haContoProprio(io)
  const sezioni: Sezione[] = [{
    id: 'rete', tipo: 'rete', etichetta: vertice ? 'Conto principale' : 'Il tuo master', titolo: (padre as any)?.nome || 'Rete',
    sottotitolo: vertice ? 'Tutti i tuoi contratti' : 'Tutti i contratti che ti vende, e le ricariche',
    saldo: Number((me as any)?.credito || 0), movimenti: null,
  }]
  const ledgerDi = new Map<string, string>()
  const contrattiDi = new Map<string, string[]>([['rete', []]])
  for (const l of leg) {
    // I contratti di questo conto: la riga del venditore e le mie copie agganciate al legame. Possono essere
    // piu' d'uno sullo stesso ledger (spedizioni 2000 compra da GTS sia GTS EXPRESS sia GLS CASERTA Consegna
    // Diretta, un conto solo): come per il master sopra, una sezione sola che li nomina tutti, col filtro
    // corriere dentro. Il legame Wave→MULTI ha corriere_id vuoto: li' contano solo le copie.
    const nomi = Array.from(new Set([nomeCorrV.get(l.corriere_id), ...((miei || []) as any[]).filter(c => c.collegamento_id === l.id).map(c => c.nome_contratto)]
      .map(n => String(n || '').trim()).filter(Boolean))).sort()
    const contratto = nomi.join(', ') || 'Contratto'
    ledgerDi.set(`l:${l.id}`, l.cliente_ledger_id)
    contrattiDi.set(`l:${l.id}`, nomi.length > 1 ? nomi : [])
    sezioni.push({
      id: `l:${l.id}`, tipo: 'fornitore', etichetta: 'Comprato da', titolo: nomeForn.get(l.fornitore_master_id) || 'Fornitore',
      sottotitolo: l.stato === 'attiva' ? contratto : `${contratto} · revocato`,
      saldo: creditoLedger.get(l.cliente_ledger_id) ?? 0, movimenti: null,
    })
  }
  // CONTRATTI TUOI: solo per chi ha il conto proprio. Il vertice ha i suoi contratti sul conto unico
  // (fn_conto_di), e lista e saldo stanno gia' nella sezione principale. La chiave e' il nome del
  // contratto trim + minuscolo, la regola con cui fn_conto_di ha messo il movimento sul conto proprio.
  const chiaviPropri = new Set<string>()
  if (dueConti) {
    for (const c of ((miei || []) as any[]).filter(c => c.proprio)) {
      const k = norm(c.nome_contratto)
      if (!k || chiaviPropri.has(k)) continue
      chiaviPropri.add(k)
      const r = rp.get(k)
      sezioni.push({
        id: `p:${k}`, tipo: 'proprio', etichetta: 'Contratto tuo', titolo: c.nome_contratto,
        sottotitolo: 'Quanto ti costa il corriere (lo paghi tu)', saldo: r?.somma ?? 0, movimenti: r?.n ?? 0,
      })
    }
  }
  // RIGHE DEL CONTO PROPRIO SU UN CONTRATTO CHE IL MASTER COMPRA. La sezione la decide il CONTRATTO, non
  // il conto su cui la riga e' finita: SDA EXPRESS L e' il contratto di LOGIXIA, e le prove del 2-3/10
  // che l'hanno messo sul conto proprio di Wave vanno nella sezione LOGIXIA, non in una card "conto
  // proprio" che faceva credere a Wave di avere un SDA EXPRESS L suo (Lorenzo, 21/10). Stesso per le
  // spedizioni fatte dal padre per conto del figlio prima della correzione di fn_conto_di del 22/09
  // (CF GROUP, spedizioni 2000): vanno nella sezione del padre. Restano FUORI dalla lista e dal saldo
  // progressivo di quel conto, perche' quel saldo non le contiene: la pagina le mostra a parte, dette
  // per quello che sono. Sono poche (al massimo sette per master).
  const fuoriConto = new Map<string, RigaFuoriConto[]>()
  if ([...rp.keys()].some(k => !chiaviPropri.has(k))) {
    const { data: estranee, error: eEst } = await admin.rpc('movimenti_sezione_v1', { p_master: io, p_sezione: 'altri', p_limit: 200 })
    if (eEst) throw new Error(eEst.message)
    for (const r of (estranee || []) as any[]) {
      const k = norm(r.corriere)
      // comprato per codice da un altro master → la sezione di quel fornitore; altrimenti viene dal padre
      const copia = ((miei || []) as any[]).find(c => c.collegamento_id && norm(c.nome_contratto) === k)
      const dove = copia && ledgerDi.has(`l:${copia.collegamento_id}`) ? `l:${copia.collegamento_id}` : 'rete'
      if (!fuoriConto.has(dove)) fuoriConto.set(dove, [])
      fuoriConto.get(dove)!.push({
        id: r.id, tipo: r.tipo, descrizione: r.descrizione, riferimento: r.riferimento,
        importo: Number(r.importo), created_at: r.created_at, corriere: r.corriere || null,
      })
    }
  }
  const commissioni = Number((me as any)?.commissioni_moovexpress || 0)
  if (dueConti || Math.abs(commissioni) >= 0.005) {
    sezioni.push({
      id: 'commissioni', tipo: 'commissioni', etichetta: 'MoovExpress', titolo: 'Commissioni MoovExpress',
      sottotitolo: '0,05 € a spedizione sui contratti tuoi', saldo: commissioni, movimenti: null,
    })
  }

  const argsDi = (id: string): ArgsSezione | null => {
    if (!sezioni.some(s => s.id === id)) return null
    if (id === 'rete' || id === 'commissioni') return { master: io, sezione: id }
    if (id.startsWith('l:')) return { master: io, sezione: 'ledger', ledger: ledgerDi.get(id)! }
    if (id.startsWith('p:')) return { master: io, sezione: 'proprio', nome: id.slice(2) }
    return null
  }
  // Il filtro corriere della sezione del master sopra: i contratti che stanno su quel conto; per il vertice
  // anche i suoi.
  contrattiDi.set('rete', Array.from(new Set(((miei || []) as any[])
    .filter(c => !c.collegamento_id && (!dueConti || !c.proprio)).map(c => c.nome_contratto).filter(Boolean))).sort())
  return {
    sezioni, argsDi, fuoriContoDi: (id: string) => fuoriConto.get(id) || [],
    // Le opzioni del filtro corriere di una sezione: vuoto dove il contratto e' uno solo.
    corrieriDi: (id: string) => contrattiDi.get(id) || [],
  }
}

// Una pagina di una sezione. Oltre l'ultima pagina non torna nessuna riga, e con lei il totale: lo si
// rilegge da una riga sola, se no la paginazione direbbe "0 movimenti" a chi ne ha migliaia.
export async function leggiSezione(admin: any, a: ArgsSezione, o: {
  page: number; perPage: number; cerca?: string | null; corriereNome?: string | null; corriereIds?: string[] | null; conSomma?: boolean
}) {
  const chiama = (offset: number, limit: number) => admin.rpc('movimenti_sezione_v1', {
    p_master: a.master, p_sezione: a.sezione, p_ledger: a.ledger ?? null, p_nome: a.nome ?? null,
    p_cerca: o.cerca || null, p_corriere_nome: o.corriereNome || null, p_corriere_ids: o.corriereIds ?? null,
    p_offset: offset, p_limit: limit,
  })
  const offset = (Math.max(1, o.page) - 1) * o.perPage
  const { data, error } = await chiama(offset, o.perPage)
  if (error) throw new Error(error.message)
  const righe = (data || []) as any[]
  let testa = righe[0]
  if (!righe.length && offset > 0) {
    const { data: d1, error: e1 } = await chiama(0, 1)
    if (e1) throw new Error(e1.message)
    testa = (d1 || [])[0]
  }
  return {
    movimenti: righe.map(r => ({
      id: r.id, tipo: r.tipo, descrizione: r.descrizione, riferimento: r.riferimento,
      importo: Number(r.importo), saldo_dopo: Number(r.saldo), created_at: r.created_at,
      spedizione_id: r.spedizione_id, corriere: r.corriere || null,
    })),
    total: Number(testa?.totale || 0),
    somma: o.conSomma ? r2(Number(testa?.somma || 0)) : null,
  }
}
