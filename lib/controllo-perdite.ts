import { createAdminSupabase } from '@/lib/supabase-admin'

// CONTROLLO "Spedizioni in perdita" (Centrale di Controllo, super master).
// Per ogni spedizione ricostruisce la catena dai MOVIMENTI (ogni livello ha il suo costo = quanto
// PAGA; il cliente paga in cima) e trova i master la cui MARGINE < 0 su quella spedizione:
//   margine(X) = quanto INCASSA dal livello sotto − quanto PAGA X.
// Poi categorizza il PERCHE': listino sotto costo vs anomalia peso/volume (ripesatura falsa).
// Sola lettura, nessun addebito. Il credito NON si tocca: e' solo diagnosi.

export type PerditaRiga = {
  numero: string; spedizione_id: string; master: string; master_id: string
  paga: number; incassa: number; margine: number
  peso_reale: number; peso_onesto: number; peso_fatturato: number
  causa: string; dettaglio: string; stato: string; created_at: string
}
export type RisultatoPerdite = {
  righe: PerditaRiga[]; perCausa: Record<string, { n: number; tot: number }>
  perMaster: Record<string, { n: number; tot: number }>; totale: number; spedizioniScansionate: number; giorni: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function trovaSpedizioniInPerdita(giorni = 14, limitRighe = 3000): Promise<RisultatoPerdite> {
  const admin = createAdminSupabase()
  const dal = new Date(Date.now() - giorni * 864e5).toISOString()

  // masters: id -> nome / parent
  const { data: ms } = await admin.from('masters').select('id,nome,parent_master_id')
  const nome = new Map<string, string>(), parent = new Map<string, string | null>()
  for (const m of ms || []) { nome.set(m.id, m.nome || '—'); parent.set(m.id, (m as any).parent_master_id) }

  // spedizioni nella finestra (escluse le annullate)
  const speds: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('spedizioni')
      .select('id,numero,peso_reale,peso_fatturato,lunghezza,larghezza,altezza,colli,stato,created_at')
      .gte('created_at', dal).not('stato', 'in', '(annullata,annullamento_pending,annullamento_manuale)')
      .order('id').range(from, from + 999)
    if (!data?.length) break; speds.push(...data); if (data.length < 1000) break
  }
  const spById = new Map<string, any>(); for (const s of speds) spById.set(s.id, s)

  // movimenti spedizione+rettifica -> costo per (sped,master) e vendita cliente per sped
  const costoAgg = new Map<string, number>(), venditaAgg = new Map<string, number>()
  const ids = speds.map(s => s.id)
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    for (let from = 0; ; from += 1000) {
      const { data: mvs } = await admin.from('movimenti').select('spedizione_id,master_target_id,cliente_id,importo')
        .in('tipo', ['spedizione', 'rettifica']).in('spedizione_id', chunk).order('id').range(from, from + 999)
      if (!mvs?.length) break
      for (const mv of mvs) {
        const imp = Number((mv as any).importo || 0)
        if ((mv as any).cliente_id) venditaAgg.set((mv as any).spedizione_id, (venditaAgg.get((mv as any).spedizione_id) || 0) + imp)
        else if ((mv as any).master_target_id) { const k = (mv as any).spedizione_id + '|' + (mv as any).master_target_id; costoAgg.set(k, (costoAgg.get(k) || 0) + imp) }
      }
      if (mvs.length < 1000) break
    }
  }
  const costo = new Map<string, number>(); for (const [k, v] of costoAgg) costo.set(k, r2(Math.abs(v)))
  const vend = new Map<string, number>(); for (const [k, v] of venditaAgg) vend.set(k, r2(Math.abs(v)))
  const mastersDiSped = new Map<string, string[]>()
  for (const k of costo.keys()) { const [sp, m] = k.split('|'); const arr = mastersDiSped.get(sp) || []; arr.push(m); mastersDiSped.set(sp, arr) }

  const righe: PerditaRiga[] = []
  for (const [sp, masters] of mastersDiSped) {
    const s = spById.get(sp); if (!s) continue
    const colli = Math.max(Number(s.colli) || 1, 1)
    const vol = (Number(s.lunghezza) || 0) * (Number(s.larghezza) || 0) * (Number(s.altezza) || 0) / 5000 * colli
    const pesoOnesto = r2(Math.max(Number(s.peso_reale) || 0, vol))
    const pf = Number(s.peso_fatturato) || 0
    for (const X of masters) {
      const costoX = costo.get(sp + '|' + X) || 0
      const figlio = masters.find(Y => Y !== X && parent.get(Y) === X)   // livello sotto = figlio-su-spedizione
      if (!figlio && !vend.has(sp)) continue                             // foglia senza vendita: non valutabile
      const incassa = figlio ? (costo.get(sp + '|' + figlio) || 0) : (vend.get(sp) || 0)
      const margine = r2(incassa - costoX)
      if (margine >= -0.01) continue
      const eurKg = pesoOnesto > 0 ? costoX / pesoOnesto : 999
      let causa: string, dettaglio: string
      if (pesoOnesto > 0 && pf > pesoOnesto * 1.5 + 3) {
        causa = 'anomalia peso/volume'; dettaglio = `peso fatturato ${pf} kg contro ${pesoOnesto} kg reali/volumetrici (misure)`
      } else if (pesoOnesto > 0 && pesoOnesto <= 10 && eurKg > 6) {
        causa = 'anomalia peso/volume'; dettaglio = `costo ${costoX}€ per ${pesoOnesto} kg = ${eurKg.toFixed(1)} €/kg: probabile ripesatura falsa del fornitore`
      } else {
        causa = 'listino sotto costo'; dettaglio = `paga ${costoX}€ ma incassa ${incassa}€ dal livello sotto: il listino a valle e' sotto il costo`
      }
      righe.push({ numero: s.numero, spedizione_id: sp, master: nome.get(X) || X, master_id: X, paga: costoX, incassa, margine, peso_reale: Number(s.peso_reale) || 0, peso_onesto: pesoOnesto, peso_fatturato: pf, causa, dettaglio, stato: s.stato, created_at: s.created_at })
    }
  }
  righe.sort((a, b) => a.margine - b.margine)

  const perCausa: Record<string, { n: number; tot: number }> = {}
  const perMaster: Record<string, { n: number; tot: number }> = {}
  for (const r of righe) {
    const c = perCausa[r.causa] || { n: 0, tot: 0 }; c.n++; c.tot = r2(c.tot + r.margine); perCausa[r.causa] = c
    const m = perMaster[r.master] || { n: 0, tot: 0 }; m.n++; m.tot = r2(m.tot + r.margine); perMaster[r.master] = m
  }
  const totale = r2(righe.reduce((s, r) => s + r.margine, 0))
  return { righe: righe.slice(0, limitRighe), perCausa, perMaster, totale, spedizioniScansionate: speds.length, giorni }
}
