import { CAMPI_MOVIMENTI_NOLO, TIPI_MOVIMENTI_NOLO, movimentiDelNolo, quantoPesaNolo } from '@/lib/ripesature-calcolo'

// ── QUANTO HO INCASSATO E QUANTO HO PAGATO SU UN PACCO ──
//
// Chiesto da Lorenzo il 13/11/2026. In Rettifica Costi le rettifiche ricevute e non girate sotto stavano in rosso come
// «Davvero non recuperate» con accanto «Pagato da te», e i master leggevano: la piattaforma sbaglia, perdo soldi. Rifatto
// il conto pacco per pacco su Ecomize Solution: delle 189 «davvero non recuperate» (416,44 €), 135 erano pacchi su cui ci
// guadagnava ancora (il cliente aveva gia' pagato piu' di quanto Ecomize ha pagato in tutto, rettifica compresa: su
// 282343J061744 MB POSTE 16,70 €, Ecomize 8,33 + 6,27 = 14,60 €), 24 spedizioni fatte dal suo account senza cliente, e
// 31 pacchi davvero in perdita, contando anche le gia' fatte pagare sotto (−80,36 €). Dal 16/11/2026 la pagina non mostra
// piu' il margine (vedi «I GRUPPI SONO IL PERCHE'» in lib/rettifiche-non-girate): di qui si usano chi sta subito sotto e
// se la spedizione e' del master senza cliente. Il conto resta per chi lo vuole rifare a mano.
//
// I soldi si leggono come li legge il motore delle rettifiche (movimentiDelNolo): solo nolo — spedizione e rettifiche,
// non resi, giacenze e POD — da TUTTE le gambe del pacco (condivisione: stesso tracking). Chi paga e' master_target_id
// (lib/ripesature-calcolo, «CHI PAGA E' master_target_id»). Sui contratti condivisi un master che compra a codice paga
// sul suo cliente-ledger «(ingrosso)» presso il fornitore (corrieri_condivisi.cliente_ledger_id), non a nome suo: quei
// movimenti contano come pagati da lui, come nel motore. Senza, su 55 pacchi SDA EXPRESS L di MULTI su 160 MULTI
// risultava aver pagato 0. Solo letture.

export type ContoPacco = {
  incassato: number | null    // pagato da chi sta subito sotto; null = non si sa chi e'
  pagato: number              // pagato da me, spedizione + rettifiche
  chi: string | null          // il cliente o il sotto-master subito sotto
  senzaCliente: boolean       // spedizione fatta dal mio account senza un cliente: non c'e' nessuno sotto
}

const arr = (n: number) => Math.round(n * 100) / 100

// In parallelo a blocchi: per MULTI sono ~2.700 pacchi in 90 giorni, uno alla volta sarebbero minuti.
async function aBlocchi<T>(ids: string[], quanti: number, fai: (pezzo: string[]) => Promise<T[]>): Promise<T[]> {
  const pezzi: string[][] = []
  for (let i = 0; i < ids.length; i += quanti) pezzi.push(ids.slice(i, i + quanti))
  const out: T[] = []
  let k = 0
  await Promise.all(Array.from({ length: Math.min(4, pezzi.length) }, async () => {
    while (k < pezzi.length) out.push(...await fai(pezzi[k++]))
  }))
  return out
}

// Tutte le righe, anche oltre le mille che il database rende per volta. Ordinate per id: senza un ordine le pagine non
// sono stabili e una riga puo' uscire due volte o mai.
async function tutte(q: () => any): Promise<any[]> {
  const out: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await q().order('id').range(da, da + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function contoSulPacco(admin: any, mio: string, spedizioneIds: string[]): Promise<Map<string, ContoPacco>> {
  const out = new Map<string, ContoPacco>()
  const ids = [...new Set(spedizioneIds.filter(Boolean))]
  if (!ids.length) return out

  const sped = await aBlocchi(ids, 200, p => tutte(() => admin.from('spedizioni').select('id,tracking_number').in('id', p)))
  const trackDi = new Map<string, string>(sped.filter((s: any) => s.tracking_number).map((s: any) => [s.id, s.tracking_number]))
  // Le gambe: stesso tracking. L'ORIGINANTE (numero = tracking) e' quella col cliente finale, come nel motore.
  const gambe = await aBlocchi([...new Set(trackDi.values())], 200, p => tutte(() => admin.from('spedizioni')
    .select('id,master_id,cliente_id,numero,tracking_number').in('tracking_number', p)))
  const gambeDi = new Map<string, any[]>()
  for (const g of gambe) { const a = gambeDi.get(g.tracking_number) || []; a.push(g); gambeDi.set(g.tracking_number, a) }

  const movimenti = await aBlocchi(gambe.map((g: any) => g.id), 150, p => tutte(() => admin.from('movimenti')
    .select('id,spedizione_id,' + CAMPI_MOVIMENTI_NOLO).in('spedizione_id', p).in('tipo', TIPI_MOVIMENTI_NOLO)))
  const movDi = new Map<string, any[]>()
  for (const m of movimenti) { const a = movDi.get(m.spedizione_id) || []; a.push(m); movDi.set(m.spedizione_id, a) }

  // L'albero dei master, risalendo finche' serve (pochi livelli).
  const padre = new Map<string, string | null>(), nomi = new Map<string, string>()
  let daLeggere = new Set<string>([mio, ...gambe.map((g: any) => g.master_id), ...movimenti.map((m: any) => m.master_target_id || m.master_id)].filter(Boolean))
  for (let giro = 0; daLeggere.size && giro < 8; giro++) {
    const lotto = [...daLeggere].filter(x => !padre.has(x))
    const ms = await aBlocchi(lotto, 200, p => tutte(() => admin.from('masters').select('id,nome,parent_master_id').in('id', p)))
    for (const m of ms) { padre.set(m.id, m.parent_master_id || null); nomi.set(m.id, m.nome) }
    for (const x of lotto) if (!padre.has(x)) padre.set(x, null)
    daLeggere = new Set(ms.map((m: any) => m.parent_master_id).filter((x: any) => x && !padre.has(x)))
  }
  const clientiIds = [...new Set(gambe.map((g: any) => g.cliente_id).filter(Boolean))]
  const clienti = await aBlocchi(clientiIds, 200, p => tutte(() => admin.from('clienti').select('id,ragione_sociale,master_id').in('id', p)))
  const cliente = new Map<string, any>(clienti.map((c: any) => [c.id, c]))
  // I clienti-ledger dei movimenti: di quale master sono il conto, e presso chi.
  const suiMovimenti = [...new Set(movimenti.map((m: any) => m.cliente_id).filter(Boolean))]
  const legami = await aBlocchi(suiMovimenti, 200, p => tutte(() => admin.from('corrieri_condivisi')
    .select('id,master_id,fornitore_master_id,cliente_ledger_id').in('cliente_ledger_id', p)))
  const ledgerDi = new Map<string, { master: string; presso: string }>(legami.map((l: any) => [l.cliente_ledger_id, { master: l.master_id, presso: l.fornitore_master_id }]))
  for (const l of legami) if (!padre.has(l.master_id)) {
    const { data } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', l.master_id).maybeSingle()
    padre.set(l.master_id, data?.parent_master_id || null); if (data) nomi.set(data.id, data.nome)
  }
  // Chi paga un movimento: il master (a nome suo o sul suo ledger), oppure il cliente.
  const masterPagante = (m: any): string | null => m.cliente_id ? (ledgerDi.get(m.cliente_id)?.master || null) : (m.master_target_id || m.master_id || null)

  for (const id of ids) {
    const tr = trackDi.get(id)
    const leg = (tr && gambeDi.get(tr)) || []
    const orig = leg.find(g => g.numero === g.tracking_number) || leg.find(g => g.id === id) || leg[0]
    if (!orig) continue
    const mov = movimentiDelNolo(leg.flatMap(g => movDi.get(g.id) || []))
    const pagatoDa = (chi: string) => arr(mov.filter(m => masterPagante(m) === chi).reduce((t, m) => t + quantoPesaNolo(m), 0))
    const pagato = pagatoDa(mio)

    // CHI STA SUBITO SOTTO DI ME. Il pacco e' mio: il mio cliente, oppure nessuno (spedita dal mio account). Il pacco e'
    // di un mio discendente: il figlio diretto da cui si risale fino a me. Sui contratti condivisi la catena non e'
    // sempre l'albero: allora e' il master che ha pagato su questo pacco e ha me come padre, o che compra da me a codice.
    let chi: string | null = null, incassato: number | null = null, senzaCliente = false
    if (orig.master_id === mio) {
      const c = orig.cliente_id ? cliente.get(orig.cliente_id) : null
      if (c && c.master_id === mio) {
        chi = String(c.ragione_sociale || '').trim() || 'il tuo cliente'
        incassato = arr(mov.filter(m => m.cliente_id === c.id).reduce((t, m) => t + quantoPesaNolo(m), 0))
      } else if (!orig.cliente_id) senzaCliente = true
    } else {
      let x: string | null = orig.master_id, passi = 0
      while (x && padre.get(x) !== mio && passi++ < 8) x = padre.get(x) ?? null
      if (!x || padre.get(x) !== mio) {
        const daMe = new Set(mov.filter(m => m.cliente_id && ledgerDi.get(m.cliente_id)?.presso === mio).map(m => ledgerDi.get(m.cliente_id)!.master))
        x = [...new Set(mov.map(masterPagante))].find(p => p && p !== mio && (padre.get(p) === mio || daMe.has(p))) || null
      }
      if (x) { chi = nomi.get(x) || 'il tuo sotto-master'; incassato = pagatoDa(x) }
    }
    out.set(id, { incassato, pagato, chi, senzaCliente })
  }
  return out
}
