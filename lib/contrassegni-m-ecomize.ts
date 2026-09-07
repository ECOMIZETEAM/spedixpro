// REGOLA CONTRASSEGNO POSTE EXPRESS M (clienti Ecomize) — resa DUREVOLE.
//
// Il contrassegno del "Poste Express M" di un cliente di Ecomize Solution/LL è DERIVATO dal suo
// "Poste Delivery Business S": stessi scaglioni e prezzi, con **+1,5% sul totale SOLO sull'ultimo
// scaglione**. Se l'S ha un solo scaglione (cap C, prezzo P) si creano due gradini: {300@P, no%} +
// {C@P, +1,5%}, così i piccoli importi non pagano la maggiorazione; se C<=300, unico {C@P, +1,5%}.
//
// PERCHÉ NON BASTA FARLO UNA VOLTA: un salvataggio del listino dal portale riscrive i contrassegni
// senza sapere dell'1,5% e lo PERDE (successo davvero: BRILLITALIA in mezza giornata). La regola
// decide chi paga cosa, quindi non può stare nei soli dati sperando che nessuno la dimentichi — va
// RI-APPLICATA. Questo è il self-heal idempotente: ricalcola l'atteso dall'S e riscrive SOLO i
// listini che se ne sono discostati (a regime non tocca niente). Lo chiama il cron
// /api/cron/riallinea-contrassegni-m. Vedi [[contrassegni-poste-express-m-ecomize]].

const MASTER_ECOMIZE = ['75b08143-26c8-4903-8091-cd03fbd635ed', '0bfa96db-0564-4d90-8f22-989db001f8ad']
const NOME_M = 'Poste Express M'
const NOME_S = 'Poste Delivery Business S'

type Scagl = { valore_max: string; prezzo_fisso: string; perc: string }

function parseDescr(d: any): { vm: number; vmt: string; pf: string; perc: string } | null {
  try {
    const j = typeof d === 'string' ? JSON.parse(d) : d
    const vm = parseFloat(j?.valore_max)
    if (!(vm > 0)) return null
    return { vm, vmt: String(j.valore_max), pf: String(j.prezzo_fisso ?? ''), perc: String(j.perc ?? '') }
  } catch { return null }
}

// Deriva gli scaglioni dell'M da quelli dell'S (già la regola scritta sopra).
export function derivaScaglioniM(scaglioniS: { vm: number; vmt: string; pf: string }[]): Scagl[] {
  const s = scaglioniS.filter(x => x.vm > 0).sort((a, b) => a.vm - b.vm)
  if (!s.length) return []
  const max = s[s.length - 1].vm
  if (s.length >= 2) return s.map(x => ({ valore_max: x.vmt, prezzo_fisso: x.pf, perc: x.vm === max ? '1.5' : '' }))
  const o = s[0]
  if (o.vm > 300) return [
    { valore_max: '300', prezzo_fisso: o.pf, perc: '' },
    { valore_max: o.vmt, prezzo_fisso: o.pf, perc: '1.5' },
  ]
  return [{ valore_max: o.vmt, prezzo_fisso: o.pf, perc: '1.5' }]
}

// Firma canonica per confronto robusto al formato (2.5 vs 2.50, "" vs "0").
const canon = (a: Scagl[]) => a
  .map(x => `${parseFloat(x.valore_max)}@${parseFloat(x.prezzo_fisso)}${parseFloat(x.perc) > 0 ? '+' + parseFloat(x.perc) : ''}`)
  .sort().join(' | ')

export async function riallineaContrassegniMEcomize(
  admin: any, opts: { dryRun?: boolean } = {}
): Promise<{ esaminati: number; riallineati: number; dettaglio: { listino_id: string; da: string; a: string }[] }> {
  const dry = !!opts.dryRun

  // corrieri M/S (di qualunque master): id → nome
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto').in('nome_contratto', [NOME_M, NOME_S])
  const nomeById = new Map<string, string>((corr || []).map((c: any) => [c.id, c.nome_contratto]))
  const msIds = [...nomeById.keys()]
  if (!msIds.length) return { esaminati: 0, riallineati: 0, dettaglio: [] }

  // listini dei clienti Ecomize
  const { data: cli } = await admin.from('clienti').select('listino_cliente_id')
    .in('master_id', MASTER_ECOMIZE).not('listino_cliente_id', 'is', null)
  const listinoIds = [...new Set((cli || []).map((c: any) => c.listino_cliente_id).filter(Boolean))] as string[]

  const dettaglio: { listino_id: string; da: string; a: string }[] = []
  let esaminati = 0, riallineati = 0

  // .in() con troppe UUID tronca in silenzio → batch da 100 (lezione [[poste-express-m-ecomize]]).
  for (let i = 0; i < listinoIds.length; i += 100) {
    const batch = listinoIds.slice(i, i + 100)
    const { data: rows } = await admin.from('listini_clienti_supplementi')
      .select('id,listino_id,corriere_id,descrizione')
      .in('listino_id', batch).eq('tipo', 'contrassegno').in('corriere_id', msIds)

    const perListino = new Map<string, { s: any[]; m: any[]; mCorr: string | null }>()
    for (const r of (rows || [])) {
      const nome = nomeById.get((r as any).corriere_id)
      const k = (r as any).listino_id
      if (!perListino.has(k)) perListino.set(k, { s: [], m: [], mCorr: null })
      const g = perListino.get(k)!
      if (nome === NOME_S) g.s.push(r)
      else if (nome === NOME_M) { g.m.push(r); g.mCorr = (r as any).corriere_id }
    }

    for (const [lid, g] of perListino) {
      if (!g.mCorr || !g.s.length) continue    // deve avere sia l'M (per sapere dove scrivere) sia l'S (da cui derivare)
      esaminati++
      const sScagl = g.s.map((r: any) => parseDescr(r.descrizione)).filter(Boolean) as any[]
      const attesi = derivaScaglioniM(sScagl)
      if (!attesi.length) continue
      const attuali = (g.m.map((r: any) => parseDescr(r.descrizione)).filter(Boolean) as any[])
        .map(x => ({ valore_max: x.vmt, prezzo_fisso: x.pf, perc: x.perc })) as Scagl[]
      if (canon(attesi) === canon(attuali)) continue    // già a regola: non tocco (idempotente, niente churn)

      dettaglio.push({ listino_id: lid, da: canon(attuali), a: canon(attesi) })
      riallineati++
      if (dry) continue
      await admin.from('listini_clienti_supplementi').delete()
        .eq('listino_id', lid).eq('corriere_id', g.mCorr).eq('tipo', 'contrassegno')
      await admin.from('listini_clienti_supplementi').insert(attesi.map(sc => ({
        listino_id: lid, corriere_id: g.mCorr, tipo: 'contrassegno', nome: null,
        valore: parseFloat(sc.prezzo_fisso) || 0, tipo_calcolo: 'totale',
        descrizione: JSON.stringify({ valore_max: sc.valore_max, prezzo_fisso: sc.prezzo_fisso, perc: sc.perc, calcolo_su: 'totale' }),
      })))
    }
  }
  return { esaminati, riallineati, dettaglio }
}
