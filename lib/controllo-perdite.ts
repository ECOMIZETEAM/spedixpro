import { createAdminSupabase } from '@/lib/supabase-admin'
import { ControlloRisultato, eur, r2 } from '@/lib/controllo-tipi'
import { isZonaEsclusiva, isZonaDisagiata, rigaValePerCitta } from '@/lib/zone-match'

// CONTROLLO "Spedizioni in perdita" (Centrale di Controllo, super master) — versione PROFONDA.
// Trova i master la cui MARGINE < 0 su una spedizione, usando il margine TOTALE (spedizione + rettifiche)
// e togliendo i falsi allarmi:
//  - SETTLED: se un master ha RICEVUTO una rettifica ma non l'ha ancora GIRATA sotto (pending), il suo
//    margine risale una volta propagata → non e' una perdita (aggiungo la parte pending). Cosi' spariscono
//    sia le rettifiche in transito, sia quelle GIA' corrette (la catena tornata a paro da una rettifica).
//  - Il MITTENTE della propria spedizione (nessun cliente, nessun figlio sotto) NON e' una perdita: paga
//    per spedire il suo pacco, non rivende.
// Poi categorizza la CAUSA VERA, non "listino sotto costo" a caso:
//  A) ZONA SPECIALE venduta sotto: la destinazione e' in una zona esclusiva (Isole Minori / disagiata /
//     Sardegna-Sicilia-Calabria / SCS / Livigno) ma e' stata venduta a prezzo Italia (il listino a valle
//     non prezza quella zona → il CAP e' scivolato). E' il caso sistemico.
//  B) ERRORE PESO/VOLUME: peso fisicamente impossibile per l'ingombro (es. 300 kg in 20x15x10) o peso
//     fatturato molto oltre il volumetrico onesto.
//  C) LISTINO SOTTO COSTO: stessa zona a monte e a valle, la vendita e' davvero sotto il costo.
// Sola lettura, nessun addebito.

export async function trovaSpedizioniInPerdita(giorni = 14, limitRighe = 3000): Promise<ControlloRisultato> {
  const admin = createAdminSupabase()
  const dal = new Date(Date.now() - giorni * 864e5).toISOString()

  const { data: ms } = await admin.from('masters').select('id,nome,parent_master_id')
  const nome = new Map<string, string>(), parent = new Map<string, string | null>()
  for (const m of ms || []) { nome.set(m.id, m.nome || '—'); parent.set(m.id, (m as any).parent_master_id) }

  // spedizioni finestra (escluse annullate) + corriere per il nome_contratto
  const speds: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('spedizioni')
      .select('id,numero,corriere_id,peso_reale,peso_fatturato,lunghezza,larghezza,altezza,colli,stato,created_at,dest_provincia,dest_cap,dest_citta,dest_paese')
      .gte('created_at', dal).not('stato', 'in', '(annullata,annullamento_pending,annullamento_manuale)')
      .order('id').range(from, from + 999)
    if (!data?.length) break; speds.push(...data); if (data.length < 1000) break
  }
  const spById = new Map<string, any>(); for (const s of speds) spById.set(s.id, s)

  // corriere -> nome_contratto (per riconoscere la zona del contratto giusto)
  const corrIds = [...new Set(speds.map(s => s.corriere_id).filter(Boolean))]
  const contrattoDi = new Map<string, string>()
  for (let i = 0; i < corrIds.length; i += 300) {
    const { data } = await admin.from('corrieri').select('id,nome_contratto').in('id', corrIds.slice(i, i + 300))
    for (const c of data || []) contrattoDi.set(c.id, (c.nome_contratto || '').trim().toLowerCase())
  }

  // movimenti: spedizione + rettifica, separati per tipo
  const sumCostoTarget = new Map<string, number>()   // sped|target -> somma signed (sped+rett), cliente null
  const sumRettRicevute = new Map<string, number>()  // sped|target -> somma signed rettifica, cliente null
  const sumRettPassate = new Map<string, number>()   // sped|owner  -> somma signed rettifica girate sotto (target!=owner o cliente)
  const sumVendita = new Map<string, number>()        // sped -> somma signed movimenti cliente
  const ids = speds.map(s => s.id)
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    for (let from = 0; ; from += 1000) {
      const { data: mvs } = await admin.from('movimenti').select('spedizione_id,master_id,master_target_id,cliente_id,importo,tipo')
        .in('tipo', ['spedizione', 'rettifica']).in('spedizione_id', chunk).order('id').range(from, from + 999)
      if (!mvs?.length) break
      for (const mv of mvs) {
        const imp = Number((mv as any).importo || 0), sp = (mv as any).spedizione_id
        if ((mv as any).cliente_id) {
          sumVendita.set(sp, (sumVendita.get(sp) || 0) + imp)
          if ((mv as any).tipo === 'rettifica' && (mv as any).master_id) { const k = sp + '|' + (mv as any).master_id; sumRettPassate.set(k, (sumRettPassate.get(k) || 0) + imp) }
        } else if ((mv as any).master_target_id) {
          const t = (mv as any).master_target_id, k = sp + '|' + t
          sumCostoTarget.set(k, (sumCostoTarget.get(k) || 0) + imp)
          if ((mv as any).tipo === 'rettifica') {
            sumRettRicevute.set(k, (sumRettRicevute.get(k) || 0) + imp)
            const owner = (mv as any).master_id
            if (owner && owner !== t) { const ko = sp + '|' + owner; sumRettPassate.set(ko, (sumRettPassate.get(ko) || 0) + imp) }
          }
        }
      }
      if (mvs.length < 1000) break
    }
  }
  const abs2 = (m: Map<string, number>, k: string) => r2(Math.abs(m.get(k) || 0))

  // master coinvolti per spedizione
  const mastersDiSped = new Map<string, string[]>()
  for (const k of sumCostoTarget.keys()) { const [sp, m] = k.split('|'); const arr = mastersDiSped.get(sp) || []; arr.push(m); mastersDiSped.set(sp, arr) }

  type Perdita = { s: any; X: string; paga: number; incassa: number; margine: number; pesoOnesto: number; pf: number }
  const perdite: Perdita[] = []
  for (const [sp, masters] of mastersDiSped) {
    const s = spById.get(sp); if (!s) continue
    for (const X of masters) {
      const paga = abs2(sumCostoTarget, sp + '|' + X)
      const figlio = masters.find(Y => Y !== X && parent.get(Y) === X)
      if (!figlio && !sumVendita.has(sp)) continue                    // mittente della propria spedizione: non e' perdita
      const incassa = figlio ? abs2(sumCostoTarget, sp + '|' + figlio) : abs2(sumVendita, sp)
      const margine = r2(incassa - paga)
      const ricevute = abs2(sumRettRicevute, sp + '|' + X)
      const passate = abs2(sumRettPassate, sp + '|' + X)
      const pending = Math.max(0, r2(ricevute - passate))            // rettifiche ricevute non ancora girate
      const settled = r2(margine + pending)
      if (settled >= -0.01) continue
      const colli = Math.max(Number(s.colli) || 1, 1)
      const pesoOnesto = r2(Math.max(Number(s.peso_reale) || 0, (Number(s.lunghezza) || 0) * (Number(s.larghezza) || 0) * (Number(s.altezza) || 0) / 5000 * colli))
      perdite.push({ s, X, paga, incassa, margine: settled, pesoOnesto, pf: Number(s.peso_fatturato) || 0 })
    }
  }

  // ── Risoluzione ZONA per le sole perdite: il CAP di destinazione, per il contratto della spedizione,
  //    cade in una zona ESCLUSIVA? (Isole/disagiata/Sardegna/…). Uso zone_cap + le stesse funzioni del motore.
  const capPerdite = [...new Set(perdite.map(p => (p.s.dest_cap || '').trim()).filter(Boolean))]
  const zoneRighe: any[] = []   // {cap, provincia, citta, zona_nome, contratto}
  for (let i = 0; i < capPerdite.length; i += 200) {
    const { data } = await admin.from('zone_cap')
      .select('cap,provincia,citta,zone!inner(nome,corrieri!inner(nome_contratto))')
      .in('cap', capPerdite.slice(i, i + 200))
    for (const r of data || []) {
      const z: any = (r as any).zone
      zoneRighe.push({ cap: (r as any).cap, provincia: (r as any).provincia, citta: (r as any).citta, zona_nome: z?.nome, contratto: (z?.corrieri?.nome_contratto || '').trim().toLowerCase() })
    }
  }
  // indice: cap -> righe
  const zonePerCap = new Map<string, any[]>()
  for (const r of zoneRighe) { const a = zonePerCap.get(r.cap) || []; a.push(r); zonePerCap.set(r.cap, a) }
  // per una spedizione: nome della zona speciale che rivendica il suo CAP (per il suo contratto), se c'e'
  const zonaSpecialeDi = (s: any): string | null => {
    const cap = (s.dest_cap || '').trim(); if (!cap) return null
    const contratto = contrattoDi.get(s.corriere_id) || ''
    const prov = (s.dest_provincia || '').toUpperCase().trim()
    const righe = (zonePerCap.get(cap) || []).filter(r => !contratto || r.contratto === contratto)
    for (const r of righe) {
      if (!isZonaEsclusiva(r.zona_nome)) continue
      const capMatch = r.cap && r.cap !== '*' && r.cap === cap && rigaValePerCitta(r, s.dest_citta)
      const provMatch = r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === prov && (!r.cap || r.cap === '*') && rigaValePerCitta(r, s.dest_citta)
      if (capMatch || provMatch) return r.zona_nome
    }
    return null
  }

  // categorizza
  const righe: any[] = []
  for (const p of perdite) {
    const s = p.s
    const pesoImpossibile = (Number(s.peso_reale) || 0) > 40 && p.pesoOnesto > 0 && (Number(s.peso_reale) || 0) > p.pesoOnesto * 6
    const zonaSpec = zonaSpecialeDi(s)
    let causa: string, dettaglio: string
    if (pesoImpossibile) {
      causa = 'errore peso/volume'; dettaglio = `peso reale ${s.peso_reale} kg impossibile per ${s.lunghezza}x${s.larghezza}x${s.altezza} cm (${p.pesoOnesto} kg volumetrici): dato da correggere`
    } else if (zonaSpec) {
      causa = 'zona speciale venduta sotto'; dettaglio = `destinazione ${s.dest_citta || s.dest_cap} = zona "${zonaSpec}" (${isZonaDisagiata(zonaSpec) ? 'disagiata' : 'isola/supplemento'}): pagata ${p.paga}€ ma venduta ${p.incassa}€ (prezzo Italia). Manca la fascia di quella zona nel listino a valle → doveva essere ESCLUSO.`
    } else if (p.pf > p.pesoOnesto * 1.5 + 3 && p.pesoOnesto > 0) {
      causa = 'errore peso/volume'; dettaglio = `peso fatturato ${p.pf} kg contro ${p.pesoOnesto} kg reali/volumetrici (misure)`
    } else {
      causa = 'listino sotto costo'; dettaglio = `stessa zona a monte e a valle: paga ${p.paga}€, vende ${p.incassa}€ → il listino di vendita e' sotto il costo`
    }
    righe.push({
      numero: s.numero, spedizione_id: s.id, master: nome.get(p.X) || p.X, master_id: p.X,
      dest: `${s.dest_citta || ''} (${s.dest_provincia || ''}) ${s.dest_cap || ''}`.trim(),
      paga: p.paga, incassa: p.incassa, margine: p.margine, peso_onesto: p.pesoOnesto, causa, dettaglio, stato: s.stato,
    })
  }
  righe.sort((a, b) => a.margine - b.margine)

  const perCausa: Record<string, { n: number; tot: number }> = {}
  for (const r of righe) { const c = perCausa[r.causa] || { n: 0, tot: 0 }; c.n++; c.tot = r2(c.tot + r.margine); perCausa[r.causa] = c }
  const totale = r2(righe.reduce((s, r) => s + r.margine, 0))

  return {
    kpi: [
      { label: 'Righe in perdita', valore: righe.length.toLocaleString('it-IT'), colore: '#b91c1c' },
      { label: 'Perdita totale', valore: eur(totale), colore: '#b91c1c' },
      ...Object.entries(perCausa).sort((a, b) => a[1].tot - b[1].tot).map(([k, v]) => ({ label: k, valore: `${v.n} · ${eur(v.tot)}`, colore: '#c2410c' })),
    ],
    colonne: [
      { key: 'numero', label: 'Spedizione', tipo: 'mono' },
      { key: 'master', label: 'Master (in perdita)' },
      { key: 'dest', label: 'Destinazione' },
      { key: 'paga', label: 'Paga', align: 'right', tipo: 'eur' },
      { key: 'incassa', label: 'Incassa', align: 'right', tipo: 'eur' },
      { key: 'margine', label: 'Margine', align: 'right', tipo: 'eur' },
      { key: 'causa', label: 'Causa', tipo: 'badge' },
      { key: 'dettaglio', label: 'Dettaglio' },
    ],
    righe: righe.slice(0, limitRighe),
    categoriaKey: 'causa', cercaKeys: ['numero', 'master', 'dest'], csvNome: 'spedizioni-in-perdita', finestra: true,
    nota: `${speds.length.toLocaleString('it-IT')} spedizioni scansionate (${giorni} gg). Margine TOTALE (base + rettifiche, settled): esclude le gia' corrette e le rettifiche in transito.`,
  }
}
