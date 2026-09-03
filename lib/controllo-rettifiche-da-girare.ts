import { createAdminSupabase } from '@/lib/supabase-admin'
import { ControlloRisultato, eur, r2 } from '@/lib/controllo-tipi'

// CONTROLLO "Rettifiche da girare". L'altra faccia della perdita: un master ha RICEVUTO una rettifica
// (target_master_id = lui, confermata=true) e non l'ha ancora DECISA/propagata al livello sotto
// (propagazione IS NULL). Sono soldi che ha gia' pagato e che deve ancora recuperare girandoli sotto.
// NON e' una perdita strutturale: e' un incasso in sospeso, da caricare (Rettifica Costi -> Conferma).
export async function trovaRettificheDaGirare(): Promise<ControlloRisultato> {
  const admin = createAdminSupabase()
  const { data: ms } = await admin.from('masters').select('id,nome')
  const nome = new Map<string, string>(); for (const m of ms || []) nome.set(m.id, m.nome || '—')

  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('rettifiche')
      .select('numero_spedizione,master_id,target_master_id,differenza,fuori_sagoma,peso_reale,peso_volume_reale,created_at')
      .not('target_master_id', 'is', null).eq('confermata', true).is('propagazione', null)
      .order('created_at', { ascending: false }).range(from, from + 999)
    if (!data?.length) break; rows.push(...data); if (data.length < 1000) break
  }

  const righe: any[] = []
  const perMaster: Record<string, { n: number; tot: number }> = {}
  for (const r of rows) {
    const importo = r2((Number(r.differenza) || 0) - (Number(r.fuori_sagoma) || 0))   // negativo = da recuperare
    if (importo >= -0.005) continue                                                   // niente da recuperare (assorbi/zero)
    const daRecuperare = r2(-importo)
    const master = nome.get(r.target_master_id) || r.target_master_id
    const fs = Number(r.fuori_sagoma) || 0
    const causa = fs > 0 && (Number(r.differenza) || 0) > -0.005 ? 'solo fuori sagoma' : (fs > 0 ? 'ripesatura + fuori sagoma' : 'ripesatura peso')
    righe.push({
      numero: r.numero_spedizione, master, da: nome.get(r.master_id) || r.master_id,
      da_recuperare: daRecuperare, peso_ripesato: r2(Math.max(Number(r.peso_reale) || 0, Number(r.peso_volume_reale) || 0)),
      causa, dettaglio: `ricevuta da ${nome.get(r.master_id) || '—'}, mai girata al livello sotto`,
    })
    const pm = perMaster[master] || { n: 0, tot: 0 }; pm.n++; pm.tot = r2(pm.tot + daRecuperare); perMaster[master] = pm
  }
  righe.sort((a, b) => b.da_recuperare - a.da_recuperare)
  const totale = r2(righe.reduce((s, x) => s + x.da_recuperare, 0))
  const topMaster = Object.entries(perMaster).sort((a, b) => b[1].tot - a[1].tot).slice(0, 4)

  return {
    kpi: [
      { label: 'Rettifiche da girare', valore: righe.length.toLocaleString('it-IT'), colore: '#c2410c' },
      { label: 'Da recuperare', valore: eur(totale), colore: '#15803d' },
      ...topMaster.map(([k, v]) => ({ label: k, valore: `${v.n} · ${eur(v.tot)}` })),
    ],
    colonne: [
      { key: 'numero', label: 'Spedizione', tipo: 'mono' },
      { key: 'master', label: 'Deve girarla' },
      { key: 'da', label: 'Ricevuta da' },
      { key: 'da_recuperare', label: 'Da recuperare', align: 'right', tipo: 'eur' },
      { key: 'peso_ripesato', label: 'Peso ripesato', align: 'right', tipo: 'peso' },
      { key: 'causa', label: 'Tipo', tipo: 'badge' },
    ],
    righe, categoriaKey: 'causa', cercaKeys: ['numero', 'master', 'da'], csvNome: 'rettifiche-da-girare',
    nota: 'Sono correzioni gia\' addebitate al master ma non ancora passate sotto: le carica da Spedizioni → Rettifica Costi.',
  }
}
