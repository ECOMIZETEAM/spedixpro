import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { nonStaffMaster } from '@/lib/permessi'
import { ledgerGambeInterne } from '@/lib/gambe-visibilita'
import { contrattiPossedutiNomi } from '@/lib/rete-masters'
import { vettoreFisico } from '@/lib/vettore'
import { giornoRoma, giorniFaRoma, inizioGiornoRomaISO } from '@/lib/date-roma'

// LA LIVE VIEW DEI MASTER (grafica nuova, 19/11/2026): la giornata di oggi, coi dati veri.
//
// Le spedizioni: lo stesso perimetro della home e dell'Elenco — la rete del master (sé + sotto-albero), i soli
// contratti che possiede, le gambe interne tolte con la regola unica del database (lib/gambe-visibilita.ts): un pacco
// passato da tre master della rete conta una volta, come in home.
//
// I soldi, due misure con due nomi diversi, ciascuna da una fonte sola:
// - INCASSATO e GUADAGNO della giornata (in testa, nella sezione «I soldi di oggi», ora per ora, e ieri): le due
//   funzioni della card «Guadagno Spedizioni» del Report Guadagno (guadagno_spedizioni_serie_v1 +
//   guadagno_ingrosso_adj_serie_v1), chiamate un'ora alla volta. Non si ricalcolano qui: per MULTIEXPRESS il 19/11 la
//   seconda valeva da sola 18.581 € dei 37.608 € incassati entro le 18 (i pacchi comprati all'ingrosso), e i suoi soldi
//   stanno su righe diverse da quella del pacco. Rifatta qui la regola, la Live View e il Report avrebbero detto due
//   cifre diverse per la stessa giornata.
// - quanto il TUO DIRETTO ti paga su una spedizione (il cliente sulle tue, il figlio di prima linea su quelle della
//   rete): serve al nastro, a «ha speso oggi» dei clienti e a «ti ha pagato» dei master. Viene dai movimenti, mai da
//   costo_spedizione, e non mostra mai il prezzo che un sotto-master fa ai suoi clienti.
//
// Carico: il 19/11 alle 18 le righe di oggi erano 14.294 (7.380 pacchi). Niente conteggi su tutta la tabella (blocco
// del database del 26/10): solo righe di oggi e di ieri lette sugli indici (master_id, created_at) e movimenti sugli
// indici di chi paga. La giornata intera si legge al massimo una volta al minuto per master, le ore passate dei soldi
// ogni dieci minuti, ieri ogni mezz'ora (memoria qui sotto); la pagina poi chiede solo le spedizioni nuove (?dopo=).
//
// Non ci sono: chi sta creando una spedizione adesso, le spedizioni lasciate a meta' e quelle non riuscite con le
// cause — il portale oggi non le registra da nessuna parte (Lorenzo 19/11: per ora senza quei riquadri).

const MAX_RIGHE = 30000
const MINUTO = 60_000, ORA = 3_600_000
const STATI_IN_VIAGGIO = new Set(['in_transito', 'in_consegna', 'in_giacenza', 'non_consegnato', 'reso_mittente'])
const FMT_ORA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' })
const oraRoma = (d: string | number | Date) => +FMT_ORA.format(new Date(d)) % 24
const r2 = (x: number) => Math.round(x * 100) / 100
const sigla = (v: any) => { const s = String(v || '').trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) ? s : null }

type Perimetro = {
  me: string
  reteIds: string[]
  ownNomi: string[]
  gambe: string[]
  primaLinea: Map<string, string>   // master della rete -> il mio figlio diretto da cui passa
  nomeMaster: Map<string, string>
  figli: string[]
  ingrosso: boolean                 // compra o rivende all'ingrosso: la seconda funzione dei soldi ha qualcosa da dire
}

// ── la memoria: per master e per giorno; una lettura in corso si condivide fra chi la chiede insieme ──
const memoria = new Map<string, { t: number, p: Promise<any> }>()
function ricordato<T>(chiave: string, durata: number, fai: () => Promise<T>): Promise<T> {
  const m = memoria.get(chiave)
  if (m && Date.now() - m.t < durata) return m.p
  if (memoria.size > 2000) memoria.clear()
  const p = fai()
  memoria.set(chiave, { t: Date.now(), p })
  p.catch(() => memoria.delete(chiave))
  return p
}

async function perimetro(admin: any, me: string): Promise<Perimetro> {
  // UNA query sui masters (tabella piccola), poi la discesa in memoria: come l'Elenco spedizioni
  const ieri = inizioGiornoRomaISO(giorniFaRoma(1))
  const [{ data: tutti }, ownNomi, gambe, adj] = await Promise.all([
    admin.from('masters').select('id,nome,parent_master_id'),
    contrattiPossedutiNomi(admin, me),
    ledgerGambeInterne(admin, me),
    admin.rpc('guadagno_ingrosso_adj_serie_v1', { p_master: me, p_dal: ieri, p_al: new Date().toISOString(), p_per_mese: false }),
  ])
  const figliDi = new Map<string, any[]>(), nomeMaster = new Map<string, string>()
  for (const m of (tutti || []) as any[]) {
    nomeMaster.set(m.id, m.nome)
    if (!m.parent_master_id) continue
    if (!figliDi.has(m.parent_master_id)) figliDi.set(m.parent_master_id, [])
    figliDi.get(m.parent_master_id)!.push(m)
  }
  const reteIds = [me], primaLinea = new Map<string, string>(), visti = new Set([me])
  let frontiera = [me]
  for (let i = 0; i < 20 && frontiera.length; i++) {
    const nuovi: string[] = []
    for (const f of frontiera) for (const c of (figliDi.get(f) || [])) {
      if (visti.has(c.id)) continue
      visti.add(c.id); reteIds.push(c.id); nuovi.push(c.id)
      primaLinea.set(c.id, c.parent_master_id === me ? c.id : (primaLinea.get(c.parent_master_id) || c.id))
    }
    frontiera = nuovi
  }
  // se la funzione non risponde la si chiama comunque: meglio una chiamata in piu' che dei soldi mancanti
  const ingrosso = !!adj.error || ((adj.data || []) as any[]).some(b => Number(b.ricavi || 0) || Number(b.costi || 0))
  return { me, reteIds, ownNomi, gambe, primaLinea, nomeMaster, figli: (figliDi.get(me) || []).map((c: any) => c.id), ingrosso }
}

// ── I SOLDI DI UN INTERVALLO: le funzioni del Report Guadagno, card «Guadagno Spedizioni» (stessa somma della rotta
//    /api/reports/guadagno). Entrambe includono gli estremi: l'ora si chiude un millisecondo prima della successiva. ──
async function soldiFra(admin: any, P: Perimetro, dal: number, al: number) {
  const args = { p_master: P.me, p_dal: new Date(dal).toISOString(), p_al: new Date(al).toISOString(), p_per_mese: false }
  const [a, b] = await Promise.all([
    admin.rpc('guadagno_spedizioni_serie_v1', args),
    P.ingrosso ? admin.rpc('guadagno_ingrosso_adj_serie_v1', args) : Promise.resolve({ data: [], error: null }),
  ])
  if (a.error) throw new Error('soldi: ' + a.error.message)
  if (b.error) throw new Error('soldi all\'ingrosso: ' + b.error.message)
  let ricavi = 0, costi = 0
  for (const x of [...(a.data || []), ...(b.data || [])] as any[]) { ricavi += Number(x.ricavi || 0); costi += Number(x.costi || 0) }
  return { euro: r2(ricavi), guad: r2(ricavi - costi) }
}

// le ore di un giorno, sei chiamate alla volta; le ore gia' chiuse si ricordano, l'ultima si rifa'
async function soldiOraPerOra(admin: any, P: Perimetro, giorno: string, inizio: number, fino: number, durataChiuse: number) {
  const ore: { euro: number, guad: number }[] = []
  const quante = Math.min(24, Math.ceil((fino - inizio) / ORA))
  for (let h = 0; h < quante; h += 6) {
    const blocco = await Promise.all(Array.from({ length: Math.min(6, quante - h) }, (_, k) => {
      const i = h + k, a = inizio + i * ORA, b = Math.min(inizio + (i + 1) * ORA - 1, fino)
      const chiusa = b < fino
      return chiusa
        ? ricordato(`soldi|${P.me}|${giorno}|${i}|${P.ingrosso}`, durataChiuse, () => soldiFra(admin, P, a, b))
        : soldiFra(admin, P, a, b)
    }))
    ore.push(...blocco)
  }
  return ore
}

// ── Le spedizioni visibili in un intervallo, a pagine di 1000 sull'indice (master_id, created_at) ──
async function leggiSpedizioni(admin: any, P: Perimetro, colonne: string, dal: string, al: string | null) {
  const righe: any[] = []
  for (let da = 0; da < MAX_RIGHE; da += 1000) {
    let q = P.ownNomi.length
      ? admin.from('spedizioni').select(`${colonne},corrieri!inner(nome_contratto)`).in('corrieri.nome_contratto', P.ownNomi)
      : admin.from('spedizioni').select(`${colonne},corrieri(nome_contratto)`)
    q = q.in('master_id', P.reteIds).gte('created_at', dal).neq('stato', 'annullata')
    if (al) q = q.lt('created_at', al)
    if (P.gambe.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${P.gambe.join(',')})`)
    const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(da, da + 999)
    if (error) throw new Error('spedizioni: ' + error.message)
    righe.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return righe
}

// I movimenti 'spedizione' di oggi che dicono quanto il diretto paga a chi guarda, letti sugli indici:
// - sulle spedizioni della rete paga il figlio di prima linea (master_target_id = figlio). Attenzione: quella riga
//   NON e' intestata a chi guarda — ogni livello registra il suo addebito su se stesso (C&V EXPRESS incassa e paga
//   C&V EXPRESS, 19/11, 26339df8…), ed e' quella che usa anche la funzione del Report;
// - sulle sue paga il cliente (master_id = chi guarda, con un cliente).
// Cinque minuti di margine prima di mezzanotte: l'addebito al cliente nasce qualche secondo PRIMA della spedizione.
async function movimentiDelGiorno(admin: any, P: Perimetro, dal: string) {
  const da = new Date(new Date(dal).getTime() - 5 * MINUTO).toISOString()
  const leggi = async (filtra: (q: any) => any) => {
    const out: any[] = []
    for (let p = 0; p < MAX_RIGHE * 2; p += 1000) {
      const q = admin.from('movimenti').select('id,spedizione_id,master_id,cliente_id,master_target_id,importo')
        .eq('tipo', 'spedizione').gte('created_at', da)
      const { data, error } = await filtra(q).order('created_at', { ascending: true }).order('id', { ascending: true }).range(p, p + 999)
      if (error) throw new Error('movimenti: ' + error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return out
  }
  const [rete, clienti] = await Promise.all([
    P.figli.length ? leggi(q => q.in('master_target_id', P.figli)) : Promise.resolve([]),
    leggi(q => q.eq('master_id', P.me).not('cliente_id', 'is', null)),
  ])
  return [...rete, ...clienti]
}

// Le stesse, per un elenco di spedizioni (le nuove): a blocchi di 300 id sull'indice spedizione_id
async function movimentiDi(admin: any, ids: string[]) {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin.from('movimenti').select('spedizione_id,master_id,cliente_id,master_target_id,importo')
      .eq('tipo', 'spedizione').in('spedizione_id', ids.slice(i, i + 300))
    if (error) throw new Error('movimenti: ' + error.message)
    out.push(...(data || []))
  }
  return out
}

// Quanto il diretto paga a chi guarda su una spedizione (null se non si sa ancora): sulle sue il cliente, su quelle
// della rete il figlio di prima linea — la stessa scelta della funzione del Report.
function pagato(P: Perimetro, s: any, movs: any[] | undefined): number | null {
  if (!movs?.length) return null
  const fl = s.master_id === P.me ? null : P.primaLinea.get(s.master_id) || null
  let pc: number | null = null
  for (const m of movs) {
    if (s.master_id === P.me ? m.cliente_id != null : (fl != null && m.master_target_id === fl)) pc = (pc ?? 0) + Number(m.importo || 0)
  }
  return pc == null ? null : r2(Math.abs(pc))
}

// Chi ha fatto la spedizione, visto da chi guarda: il suo cliente (sulle sue), il figlio di prima linea (sulle
// spedizioni della rete), o lui stesso (sue, senza cliente).
const chiDi = (P: Perimetro, s: any) =>
  s.master_id === P.me ? (s.cliente_id ? 'c' + String(s.cliente_id).slice(0, 12) : 'io') : 'm' + String(P.primaLinea.get(s.master_id) || s.master_id).slice(0, 12)

// Una riga per spedizione, compatta (per MULTIEXPRESS sono migliaia):
// [id corto, secondi da mezzanotte, chi, provincia di partenza, provincia d'arrivo, paese estero, vettore,
//  quanto ti paga il diretto, contrassegno, in distinta 0/1, 0 da partire · 1 in viaggio · 2 consegnata]
type Riga = [string, number, string, string | null, string | null, string | null, string, number | null, number, number, number]
const COLONNE = 'id,created_at,master_id,cliente_id,mitt_provincia,dest_provincia,dest_paese,contrassegno,distinta_id,stato'

function riga(P: Perimetro, s: any, movs: any[] | undefined, inizio: number): Riga {
  const paese = String(s.dest_paese || 'IT').trim().toUpperCase()
  const estero = paese && paese !== 'IT' && paese !== 'ITALIA' ? paese.slice(0, 2) : null
  return [
    String(s.id).slice(0, 12),
    Math.round((new Date(s.created_at).getTime() - inizio) / 1000),
    chiDi(P, s),
    sigla(s.mitt_provincia),
    estero ? null : sigla(s.dest_provincia),
    estero,
    // il vettore fisico dal nome del contratto, mai dal tipo tecnico: i nomi dei fornitori non vanno ai master
    vettoreFisico({ nome_contratto: (s.corrieri as any)?.nome_contratto || '' }),
    pagato(P, s, movs),
    r2(Number(s.contrassegno || 0)),
    s.distinta_id ? 1 : 0,
    s.stato === 'consegnata' ? 2 : STATI_IN_VIAGGIO.has(s.stato) ? 1 : 0,
  ]
}

const perSpedizione = (movimenti: any[]) => {
  const m = new Map<string, any[]>()
  for (const x of movimenti) { if (!m.has(x.spedizione_id)) m.set(x.spedizione_id, []); m.get(x.spedizione_id)!.push(x) }
  return m
}

// I nomi di chi compare: i clienti diretti (col credito, che e' del master che guarda) e i figli di prima linea
async function dizionario(admin: any, P: Perimetro, chiavi: Set<string>, clientiIds: Set<string>) {
  const chi: Record<string, any> = {}
  if (chiavi.has('io')) chi.io = { n: P.nomeMaster.get(P.me) || 'Le tue', t: 'io' }
  const ids = [...clientiIds]
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin.from('clienti').select('id,ragione_sociale,credito,tipo_contratto,ledger').in('id', ids.slice(i, i + 300))
    if (error) throw new Error('clienti: ' + error.message)
    for (const c of (data || []) as any[]) {
      chi['c' + String(c.id).slice(0, 12)] = {
        n: c.ragione_sociale || 'Cliente', t: 'c', cr: r2(Number(c.credito || 0)),
        // a credito a scalare il saldo che finisce ferma il cliente; a fattura andare sotto zero e' normale
        sc: (c.tipo_contratto || '') === 'credito_scalare' && !c.ledger,
      }
    }
  }
  for (const k of chiavi) if (k.startsWith('m') && !chi[k]) {
    const id = P.figli.find(f => f.startsWith(k.slice(1)))
    chi[k] = { n: (id && P.nomeMaster.get(id)) || 'Master', t: 'm' }
  }
  return chi
}

// ── IERI (una volta ogni mezz'ora): quante create ogni dieci minuti, i soldi ora per ora, e per i clienti diretti
//    quante ne hanno fatte ora per ora (per «Chi manca all'appello») ──
// i soldi di ieri ora per ora, ricordati mezz'ora (ieri cambia solo con qualche annullo tardivo)
function soldiIeri(admin: any, P: Perimetro) {
  const giorno = giorniFaRoma(1)
  const t0 = new Date(inizioGiornoRomaISO(giorno)).getTime(), t1 = new Date(inizioGiornoRomaISO(giornoRoma())).getTime()
  return ricordato(`soldiIeriOre|${P.me}|${giorno}|${P.ingrosso}`, 30 * MINUTO, () => soldiOraPerOra(admin, P, giorno, t0, t1, 30 * MINUTO))
}

async function calcolaIeri(admin: any, P: Perimetro) {
  const giorno = giorniFaRoma(1)
  const dal = inizioGiornoRomaISO(giorno), al = inizioGiornoRomaISO(giornoRoma())
  const t0 = new Date(dal).getTime()
  const [righe, soldi] = await Promise.all([
    leggiSpedizioni(admin, P, 'id,created_at,master_id,cliente_id', dal, al),
    soldiIeri(admin, P),
  ])
  const dieci = Array(144).fill(0)            // ogni dieci minuti: «ieri a quest'ora» senza arrotondare all'ora
  const perCliente = new Map<string, number[]>()
  for (const s of righe) {
    const t = new Date(s.created_at).getTime()
    dieci[Math.min(143, Math.max(0, Math.floor((t - t0) / (10 * MINUTO))))]++
    if (s.master_id === P.me && s.cliente_id) {
      if (!perCliente.has(s.cliente_id)) perCliente.set(s.cliente_id, Array(24).fill(0))
      perCliente.get(s.cliente_id)![oraRoma(t)]++
    }
  }
  return { dieci, soldi, perCliente, troncata: righe.length >= MAX_RIGHE }
}

// I soldi di oggi ora per ora, e quelli di ieri fino alla stessa ora: le ore intere di ieri sono gia' calcolate, si
// chiede solo il pezzo dell'ora in corso (ricordato cinque minuti) invece di rifare tutta la giornata di ieri
async function soldiDiOggi(admin: any, P: Perimetro) {
  const oggi = giornoRoma(), inizio = new Date(inizioGiornoRomaISO(oggi)).getTime(), adesso = Date.now()
  const ieriInizio = new Date(inizioGiornoRomaISO(giorniFaRoma(1))).getTime()
  const h = Math.min(23, Math.floor((adesso - inizio) / ORA)), ieriAdesso = ieriInizio + (adesso - inizio)
  const [ore, ieriOre, pezzo] = await Promise.all([
    soldiOraPerOra(admin, P, oggi, inizio, adesso, 10 * MINUTO),
    soldiIeri(admin, P),
    ricordato(`soldiIeriPezzo|${P.me}|${Math.floor(adesso / (5 * MINUTO))}`, 5 * MINUTO,
      () => soldiFra(admin, P, ieriInizio + h * ORA, ieriAdesso)),
  ])
  const prima = ieriOre.slice(0, h)
  const ieriFinOra = {
    euro: r2(prima.reduce((a, o) => a + o.euro, 0) + pezzo.euro),
    guad: r2(prima.reduce((a, o) => a + o.guad, 0) + pezzo.guad),
  }
  return { soldi: { ore }, ieriFinOra }
}

async function giornata(admin: any, P: Perimetro) {
  const oggi = giornoRoma(), da = inizioGiornoRomaISO(oggi), inizio = new Date(da).getTime(), adesso = Date.now()
  const [spedizioni, movimenti, ieri, soldiOggi, totClienti] = await Promise.all([
    leggiSpedizioni(admin, P, COLONNE, da, null),
    movimentiDelGiorno(admin, P, da),
    ricordato(`ieri|${P.me}|${oggi}`, 30 * MINUTO, () => calcolaIeri(admin, P)),
    ricordato(`soldiOggi|${P.me}|${oggi}`, MINUTO, () => soldiDiOggi(admin, P)),
    admin.from('clienti').select('id', { count: 'exact', head: true }).eq('master_id', P.me).eq('attivo', true).or('ledger.is.null,ledger.eq.false'),
  ])
  const perSped = perSpedizione(movimenti)
  const righe = spedizioni.map(s => riga(P, s, perSped.get(s.id), inizio))

  // chi manca: clienti diretti che ieri entro quest'ora ne avevano fatte almeno 3, e oggi ancora nessuna
  const hAdesso = oraRoma(adesso)
  const oggiCli = new Set<string>(spedizioni.filter(s => s.master_id === P.me && s.cliente_id).map(s => s.cliente_id))
  const assenti = [...(ieri.perCliente as Map<string, number[]>).entries()]
    .map(([id, ore]) => ({ id, entro: ore.slice(0, hAdesso + 1).reduce((a, b) => a + b, 0), tot: ore.reduce((a, b) => a + b, 0), ore }))
    .filter(a => !oggiCli.has(a.id) && a.entro >= 3).sort((a, b) => b.entro - a.entro).slice(0, 6)

  const chiavi = new Set(righe.map(r => r[2]))
  const chi = await dizionario(admin, P, chiavi, new Set([...oggiCli, ...assenti.map(a => a.id)]))
  return {
    da, chi, righe,
    soldi: soldiOggi.soldi,
    ieri: {
      ore: ieri.dieci.reduce((o: number[], v: number, i: number) => { o[Math.floor(i / 6)] += v; return o }, Array(24).fill(0)),
      soldi: ieri.soldi,
      // quante create ogni dieci minuti: «ieri a quest'ora» la pagina lo conta da sola mentre l'ora avanza
      dieci: ieri.dieci,
      troncata: ieri.troncata,
    },
    assenti: assenti.map(a => ({ k: 'c' + a.id.slice(0, 12), entro: a.entro, tot: a.tot, ore: a.ore })),
    totali: { clienti: totClienti.count || 0, master: P.figli.length },
    ieriFinOra: soldiOggi.ieriFinOra,
    troncata: spedizioni.length >= MAX_RIGHE,
  }
}

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).single()
  // come la home: la rete del master la legge solo lo staff. L'agente ha i suoi clienti, il cliente la sua pagina.
  if (nonStaffMaster(utente) || (utente as any)?.ruolo === 'agente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const me = (utente as any)?.master_id as string | undefined
  if (!me) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  try {
    const P = await ricordato(`perimetro|${me}`, 10 * MINUTO, () => perimetro(admin, me))
    const parametri = new URL(req.url).searchParams
    // SOLO I SOLDI (la pagina li chiede una volta al minuto): le ore chiuse vengono dalla memoria, si rifà l'ultima
    if (parametri.get('solo') === 'soldi') {
      const s = await ricordato(`soldiOggi|${me}|${giornoRoma()}`, MINUTO, () => soldiDiOggi(admin, P))
      return NextResponse.json({ ...s, ora: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const dopo = parametri.get('dopo')
    if (!dopo) {
      const g = await ricordato(`giornata|${me}|${giornoRoma()}`, MINUTO, () => giornata(admin, P))
      return NextResponse.json({ ...g, ora: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
    }
    // SOLO LE NUOVE: le spedizioni create dopo l'ultima lettura, con tre minuti di sovrapposizione (l'addebito arriva
    // un istante dopo la spedizione: la stessa riga torna col suo importo, e la pagina la aggiorna per id)
    const t = Date.parse(dopo)
    if (!Number.isFinite(t)) return NextResponse.json({ error: 'Parametro non valido' }, { status: 400 })
    const da = inizioGiornoRomaISO(giornoRoma()), inizio = new Date(da).getTime()
    const dal = new Date(Math.max(inizio, Math.min(Date.now(), t) - 3 * MINUTO)).toISOString()
    const spedizioni = await leggiSpedizioni(admin, P, COLONNE, dal, null)
    const perSped = perSpedizione(await movimentiDi(admin, spedizioni.map(s => s.id)))
    const righe = spedizioni.map(s => riga(P, s, perSped.get(s.id), inizio))
    const chi = await dizionario(admin, P, new Set(righe.map(r => r[2])),
      new Set<string>(spedizioni.filter(s => s.master_id === me && s.cliente_id).map(s => s.cliente_id)))
    return NextResponse.json({ da, chi, righe, ora: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    console.error('[LIVE] lettura non riuscita', me, e?.message)
    return NextResponse.json({ error: 'I numeri di oggi non sono disponibili in questo momento: riprova tra poco.' }, { status: 503 })
  }
}
