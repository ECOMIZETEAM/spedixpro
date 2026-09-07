'use client'
import { useState, useEffect, useMemo } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

type Apply = { corriere_id: string; zona_id: string; peso_max: number; prezzo: number }
type Racc = {
  tipo: 'aggiungi' | 'allinea'; zona: string; peso: number; corriere: string; prezzo: number
  corriere_attuale: string; margine_nuovo: number; margine_attuale: number; per_spedizione: number; apply: Apply
}
type Cli = { listino_id: string; clienti: string[]; spedizioni_90gg: number; stima_guadagno_90gg: number; raccomandazioni: Racc[] }

const TOP = 6

export default function OttimizzaMargini() {
  const dialog = useDialog()
  const [attivo, setAttivo] = useState(true)
  const [totale, setTotale] = useState(0)
  const [data, setData] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [aperto, setAperto] = useState<string | null>(null)
  const [tutti, setTutti] = useState<Record<string, boolean>>({})
  const [esiti, setEsiti] = useState<Record<string, { gruppo: string; n: number }>>({})   // key → applicazione
  const [busy, setBusy] = useState<string | null>(null)

  const carica = () => {
    setLoading(true)
    fetch('/api/network/ottimizza-margini').then(r => r.json()).then(j => {
      setAttivo(j?.attivo !== false); setTotale(Number(j?.totale_potenziale_90gg) || 0)
      setData(Array.isArray(j?.clienti) ? j.clienti : []); setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { carica() }, [])

  const eur = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const nomeCli = (c: Cli) => (c.clienti || []).join(', ') || 'Listino'
  const visibili = useMemo(() => data.filter(c => !cerca || nomeCli(c).toLowerCase().includes(cerca.toLowerCase())), [data, cerca])

  async function applica(key: string, listino_id: string, rotte: Apply[], msg: string) {
    if (!await dialog.confirm({ title: 'Applica al listino', message: msg, confirmText: 'Applica' })) return
    setBusy(key)
    try {
      const r = await fetch('/api/network/ottimizza-margini/applica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listino_id, rotte }) })
      const j = await r.json()
      if (j?.success) setEsiti(e => ({ ...e, [key]: { gruppo: j.gruppo, n: j.applicate } }))
      else await dialog.alert({ title: 'Errore', message: j?.error || 'Non applicato.' })
    } finally { setBusy(null) }
  }
  async function annulla(key: string) {
    const es = esiti[key]; if (!es) return
    setBusy(key)
    try {
      await fetch('/api/network/ottimizza-margini/applica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ undo: es.gruppo }) })
      setEsiti(e => { const n = { ...e }; delete n[key]; return n })
    } finally { setBusy(null) }
  }

  if (!loading && !attivo) return (
    <div style={{ maxWidth: 760 }}><h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Ottimizza margini</h1>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#94a3b8', marginTop: 12 }}>Funzione non attiva per questo master.</div></div>
  )
  const pill = (bg: string, col: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: bg, color: col, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' as const })
  const btnApplica = { padding: '7px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }

  return (
    <div style={{ maxWidth: 1040 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.01em' }}>Ottimizza margini</h1>
      <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
        Mettiamo il corriere che <b style={{ color: '#334155' }}>ti costa meno</b> al prezzo più basso che il cliente ha già: così in creazione lo vede al prezzo migliore, lo usa, e tu guadagni di più. Col tasto <b>Applica</b> lo aggiungiamo al suo listino (annullabile).
      </p>

      {!loading && (
        <div style={{ background: 'linear-gradient(135deg,#065f46,#10b981)', borderRadius: 16, padding: '22px 26px', marginBottom: 18, color: '#fff', boxShadow: '0 10px 30px -12px rgba(16,185,129,0.5)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>Guadagno potenziale — ultimi 90 giorni</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, marginTop: 4, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{eur(totale)}</div>
          <div style={{ fontSize: 13, opacity: 0.92, marginTop: 4 }}>Stima sul tuo volume reale (ultimi 90 giorni). {data.length} clienti con opportunità.</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={pill('#fff7ed', '#c2410c')}>+ AGGIUNGI — corriere non ancora nel listino</span>
        <span style={pill('#eff6ff', '#1d4ed8')}>● ALLINEA — corriere già presente, prezzo da abbassare</span>
        <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente…"
          style={{ marginLeft: 'auto', width: 260, padding: '9px 13px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, color: '#0f172a', outline: 'none' }} />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Calcolo margini…</div>
      ) : !visibili.length ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28, textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>✓ Tutto ottimizzato: su ogni rotta il cliente ha già il corriere che ti costa meno.</div>
      ) : visibili.map(c => {
        const isOpen = aperto === c.listino_id
        const mostraTutti = !!tutti[c.listino_id]
        const lista = mostraTutti ? c.raccomandazioni : c.raccomandazioni.slice(0, TOP)
        const keyAll = 'all|' + c.listino_id
        const esAll = esiti[keyAll]
        return (
          <div key={c.listino_id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', marginBottom: 12, overflow: 'hidden', boxShadow: isOpen ? '0 8px 24px -14px rgba(15,23,42,0.25)' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 18px', cursor: 'pointer' }} onClick={() => setAperto(isOpen ? null : c.listino_id)}>
              <span style={{ fontWeight: 800, fontSize: 15.5, color: '#0f172a' }}>{nomeCli(c)}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={pill('#f1f5f9', '#475569')}>📦 {c.spedizioni_90gg} sped./90gg</span>
                {c.stima_guadagno_90gg > 0 && <span style={pill('#dcfce7', '#15803d')}>▲ +{eur(c.stima_guadagno_90gg)} potenziali</span>}
                <span style={pill('#f1f5f9', '#475569')}>{c.raccomandazioni.length} consigli</span>
                <span style={{ color: '#94a3b8', fontSize: 13, width: 16, textAlign: 'center' }}>{isOpen ? '▲' : '▼'}</span>
              </span>
            </div>

            {isOpen && (
              <div style={{ borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 18px', background: '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                  {esAll ? (
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: '#15803d', fontWeight: 700 }}>✓ Applicati {esAll.n} <button onClick={() => annulla(keyAll)} disabled={busy === keyAll} style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#dc2626', borderRadius: 7, fontSize: 12, padding: '5px 10px', cursor: 'pointer' }}>Annulla</button></span>
                  ) : (
                    <button disabled={busy === keyAll} onClick={() => applica(keyAll, c.listino_id, c.raccomandazioni.map(r => r.apply), `Applico tutti i ${c.raccomandazioni.length} consigli al listino di ${nomeCli(c)}. Aggiunge/allinea i corrieri al prezzo indicato (mai sotto costo né sotto il minimo). Annullabile. Procedo?`)}
                      style={{ ...btnApplica, background: busy === keyAll ? '#86efac' : '#16a34a' }}>{busy === keyAll ? 'Applico…' : `Applica tutti (${c.raccomandazioni.length})`}</button>
                  )}
                </div>
                {lista.map((r, i) => {
                  const isAgg = r.tipo === 'aggiungi'; const accent = isAgg ? '#f97316' : '#3b82f6'
                  const key = c.listino_id + '|' + i; const es = esiti[key]
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px 13px 0', borderBottom: '1px solid #f6f7f9', borderLeft: `3px solid ${accent}` }}>
                      <div style={{ paddingLeft: 15, minWidth: 150 }}>
                        <span style={pill(isAgg ? '#fff7ed' : '#eff6ff', isAgg ? '#c2410c' : '#1d4ed8')}>{isAgg ? '+ AGGIUNGI' : '● ALLINEA'}</span>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 5 }}>{r.zona} · ≤{r.peso} kg</div>
                      </div>
                      <div style={{ flex: 1, fontSize: 14, color: '#0f172a', lineHeight: 1.45 }}>
                        {isAgg ? <>Aggiungi <b style={{ color: '#c2410c' }}>{r.corriere}</b> a <b>{eur(r.prezzo)}</b></> : <>Allinea <b style={{ color: '#0369a1' }}>{r.corriere}</b> a <b>{eur(r.prezzo)}</b></>}
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>il cliente lo userà (ti costa meno di {r.corriere_attuale}) · margine {eur(r.margine_attuale)} → <b style={{ color: '#16a34a' }}>{eur(r.margine_nuovo)}</b></div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>+{eur(r.per_spedizione)}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>a spedizione</div>
                      </div>
                      <div style={{ paddingRight: 18, minWidth: 92, textAlign: 'right' }}>
                        {es ? <span style={{ fontSize: 12, color: '#15803d', fontWeight: 700 }}>✓ <button onClick={() => annulla(key)} disabled={busy === key} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>annulla</button></span>
                          : <button disabled={busy === key} onClick={() => applica(key, c.listino_id, [r.apply], `Metto ${r.corriere} a ${eur(r.prezzo)} su ${r.zona} ≤${r.peso}kg nel listino di ${nomeCli(c)}. Annullabile. Procedo?`)} style={{ ...btnApplica, background: busy === key ? '#86efac' : '#16a34a' }}>Applica</button>}
                      </div>
                    </div>
                  )
                })}
                {c.raccomandazioni.length > TOP && (
                  <button onClick={() => setTutti(t => ({ ...t, [c.listino_id]: !mostraTutti }))} style={{ width: '100%', padding: 11, background: '#fafafa', border: 'none', borderTop: '1px solid #f1f5f9', color: '#2563eb', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {mostraTutti ? 'Mostra solo i migliori' : `Mostra tutti i ${c.raccomandazioni.length} consigli`}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
