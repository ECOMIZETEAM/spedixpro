import { createAdminSupabase } from '@/lib/supabase-admin'
import { ControlloRisultato } from '@/lib/controllo-tipi'

// CONTROLLO "Zone & Listini". Le fasce sono CUMULATIVE ("fino a X kg", peso_min sempre 0): conta solo
// il peso_max crescente. Trova gli errori di configurazione che sbagliano/rompono il prezzo:
//  - PREZZO NON CRESCENTE: una fascia piu' pesante costa MENO di una piu' leggera (heavier = cheaper).
//  - CAP DUPLICATO: due fasce con lo stesso peso_max ma prezzo diverso (prezzo ambiguo).
//  - MANCA "OLTRE": nessuna regola oltre l'ultima fascia e cap basso -> i pesi alti non hanno prezzo.
//  - PREZZO <= 0.
//  - ZONA SENZA TARIFFA: una zona esistente con CAP ma senza nessuna fascia (destinazioni non prezzabili).
export async function trovaProblemiZoneListini(): Promise<ControlloRisultato> {
  const admin = createAdminSupabase()
  const { data: ms } = await admin.from('masters').select('id,nome')
  const nomeM = new Map<string, string>(); for (const m of ms || []) nomeM.set(m.id, m.nome || '—')
  const { data: cs } = await admin.from('corrieri').select('id,nome_contratto')
  const nomeC = new Map<string, string>(); for (const c of cs || []) nomeC.set(c.id, c.nome_contratto || '—')
  const { data: lis } = await admin.from('listini_corrieri').select('id,nome,master_id,corriere_id')
  const listino = new Map<string, any>(); for (const l of lis || []) listino.set(l.id, l)
  const { data: zs } = await admin.from('zone').select('id,nome,master_id,corriere_id')
  const zona = new Map<string, any>(); for (const z of zs || []) zona.set(z.id, z)

  const fasce: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('listini_corrieri_fasce').select('listino_id,zona_id,peso_max,prezzo,tipo').order('id').range(from, from + 999)
    if (!data?.length) break; fasce.push(...data); if (data.length < 1000) break
  }
  const zoneConCap = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('zone_cap').select('zona_id').order('id').range(from, from + 999)
    if (!data?.length) break; for (const zc of data) zoneConCap.add(zc.zona_id); if (data.length < 1000) break
  }

  const righe: any[] = []
  const etich = (lid: string, zid: string) => {
    const l = listino.get(lid) || {}; const z = zona.get(zid) || {}
    return { listino: l.nome || '—', master: nomeM.get(l.master_id) || '—', corriere: nomeC.get(l.corriere_id || z.corriere_id) || '—', zona: z.nome || '—' }
  }
  const add = (lid: string, zid: string, problema: string, dettaglio: string) => righe.push({ ...etich(lid, zid), problema, dettaglio })

  const perGruppo = new Map<string, any[]>()
  const zoneUsate = new Set<string>()
  for (const f of fasce) {
    if (f.zona_id) zoneUsate.add(f.zona_id)
    if ((Number(f.prezzo) || 0) <= 0) add(f.listino_id, f.zona_id, 'prezzo ≤ 0', `fascia fino a ${f.peso_max} kg con prezzo ${f.prezzo}`)
    const k = f.listino_id + '|' + f.zona_id; const arr = perGruppo.get(k) || []; arr.push(f); perGruppo.set(k, arr)
  }
  for (const [k, arr] of perGruppo) {
    const [lid, zid] = k.split('|')
    const fa = arr.filter((f: any) => f.tipo !== 'oltre').sort((a: any, b: any) => Number(a.peso_max) - Number(b.peso_max))
    const haOltre = arr.some((f: any) => f.tipo === 'oltre')
    if (!fa.length) continue
    for (let i = 1; i < fa.length; i++) {
      const capPrev = Number(fa[i - 1].peso_max), capCur = Number(fa[i].peso_max)
      const pPrev = Number(fa[i - 1].prezzo), pCur = Number(fa[i].prezzo)
      if (Math.abs(capCur - capPrev) < 0.001) { if (Math.abs(pCur - pPrev) > 0.005) add(lid, zid, 'cap duplicato', `due fasce fino a ${capCur} kg con prezzi diversi (${pPrev} e ${pCur})`) }
      else if (pCur < pPrev - 0.005) add(lid, zid, 'prezzo non crescente', `fino a ${capCur} kg costa ${pCur}€, meno di fino a ${capPrev} kg (${pPrev}€): un pacco piu' pesante costerebbe meno`)
    }
    const ultimoCap = Number(fa[fa.length - 1].peso_max)
    if (!haOltre && ultimoCap < 50) add(lid, zid, 'manca oltre', `nessuna regola oltre ${ultimoCap} kg: i pesi alti non hanno prezzo`)
  }
  // zone ESISTENTI con CAP ma senza nessuna fascia
  for (const zid of zoneConCap) if (!zoneUsate.has(zid) && zona.has(zid)) {
    const z = zona.get(zid)
    righe.push({ listino: '—', master: nomeM.get(z.master_id) || '—', corriere: nomeC.get(z.corriere_id) || '—', zona: z.nome || '—', problema: 'zona senza tariffa', dettaglio: 'ha CAP ma nessuna fascia: destinazioni non prezzabili' })
  }

  const perProblema: Record<string, number> = {}
  for (const r of righe) perProblema[r.problema] = (perProblema[r.problema] || 0) + 1
  righe.sort((a, b) => (a.master + a.problema).localeCompare(b.master + b.problema))

  return {
    kpi: [
      { label: 'Problemi trovati', valore: righe.length.toLocaleString('it-IT'), colore: righe.length ? '#b91c1c' : '#15803d' },
      ...Object.entries(perProblema).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: k, valore: String(v), colore: '#c2410c' })),
    ],
    colonne: [
      { key: 'master', label: 'Master' }, { key: 'listino', label: 'Listino' }, { key: 'corriere', label: 'Corriere' },
      { key: 'zona', label: 'Zona' }, { key: 'problema', label: 'Problema', tipo: 'badge' }, { key: 'dettaglio', label: 'Dettaglio' },
    ],
    righe, categoriaKey: 'problema', cercaKeys: ['master', 'listino', 'corriere', 'zona'], csvNome: 'zone-listini',
    nota: 'Errori di configurazione di zone e listini che impediscono o sbagliano il calcolo del prezzo. Le fasce sono cumulative (fino a X kg).',
  }
}
