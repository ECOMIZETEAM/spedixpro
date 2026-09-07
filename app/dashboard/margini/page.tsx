'use client'
import { useState, useEffect, useMemo } from 'react'

type Racc = {
  tipo: 'cambia' | 'aggiungi'; zona: string; peso: number; per_spedizione: number
  usa?: string; margine_usa?: number; invece_di?: string; margine_invece?: number
  corriere?: string; margine_stimato?: number; nota?: string
}
type Cli = { listino_id: string; clienti: string[]; spedizioni_90gg: number; stima_guadagno_90gg: number; raccomandazioni: Racc[] }

const TOP = 6

export default function OttimizzaMargini() {
  const [attivo, setAttivo] = useState(true)
  const [totale, setTotale] = useState(0)
  const [data, setData] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [aperto, setAperto] = useState<string | null>(null)
  const [tutti, setTutti] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/network/ottimizza-margini').then(r => r.json()).then(j => {
      setAttivo(j?.attivo !== false); setTotale(Number(j?.totale_potenziale_90gg) || 0)
      setData(Array.isArray(j?.clienti) ? j.clienti : []); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const eur = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const nomeCli = (c: Cli) => (c.clienti || []).join(', ') || 'Listino'
  const visibili = useMemo(() => data.filter(c => !cerca || nomeCli(c).toLowerCase().includes(cerca.toLowerCase())), [data, cerca])

  if (!loading && !attivo) return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Ottimizza margini</h1>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#94a3b8', marginTop: 12 }}>Funzione non attiva per questo master.</div>
    </div>
  )

  const pill = (bg: string, col: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: bg, color: col, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' as const })

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: '-0.01em' }}>Ottimizza margini</h1>
      <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
        Per ogni cliente ti diciamo <b style={{ color: '#334155' }}>cosa fare</b> per guadagnare di più — quale corriere usare e quali attivare — con il guadagno per spedizione. Solo consiglio: nessun prezzo viene modificato.
      </p>

      {/* HERO: guadagno potenziale */}
      {!loading && (
        <div style={{ background: 'linear-gradient(135deg,#065f46,#10b981)', borderRadius: 16, padding: '22px 26px', marginBottom: 18, color: '#fff', boxShadow: '0 10px 30px -12px rgba(16,185,129,0.5)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>Guadagno potenziale — ultimi 90 giorni</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, marginTop: 4, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{eur(totale)}</div>
          <div style={{ fontSize: 13, opacity: 0.92, marginTop: 4 }}>Stima sul tuo volume reale, spostando ogni rotta sul corriere a margine più alto. {data.length} clienti con opportunità.</div>
        </div>
      )}

      {/* Legenda + ricerca */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={pill('#eff6ff', '#1d4ed8')}>● CAMBIA — usa un corriere che hai già</span>
        <span style={pill('#fff7ed', '#c2410c')}>+ AGGIUNGI — attiva un corriere nuovo</span>
        <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente…"
          style={{ marginLeft: 'auto', width: 260, padding: '9px 13px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, color: '#0f172a', outline: 'none' }} />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Calcolo margini…</div>
      ) : !visibili.length ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28, textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>✓ Tutto ottimizzato: i corrieri attuali sono già i migliori su ogni rotta.</div>
      ) : visibili.map(c => {
        const isOpen = aperto === c.listino_id
        const mostraTutti = !!tutti[c.listino_id]
        const lista = mostraTutti ? c.raccomandazioni : c.raccomandazioni.slice(0, TOP)
        return (
          <div key={c.listino_id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', marginBottom: 12, overflow: 'hidden', boxShadow: isOpen ? '0 8px 24px -14px rgba(15,23,42,0.25)' : 'none' }}>
            {/* header cliente */}
            <button onClick={() => setAperto(isOpen ? null : c.listino_id)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 15.5, color: '#0f172a' }}>{nomeCli(c)}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={pill('#f1f5f9', '#475569')}>📦 {c.spedizioni_90gg} sped./90gg</span>
                {c.stima_guadagno_90gg > 0 && <span style={pill('#dcfce7', '#15803d')}>▲ +{eur(c.stima_guadagno_90gg)} potenziali</span>}
                <span style={pill('#f1f5f9', '#475569')}>{c.raccomandazioni.length} consigli</span>
                <span style={{ color: '#94a3b8', fontSize: 13, width: 16, textAlign: 'center' }}>{isOpen ? '▲' : '▼'}</span>
              </span>
            </button>

            {isOpen && (
              <div style={{ borderTop: '1px solid #f1f5f9' }}>
                {lista.map((r, i) => {
                  const isCambia = r.tipo === 'cambia'
                  const accent = isCambia ? '#3b82f6' : '#f97316'
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px 13px 0', borderBottom: '1px solid #f6f7f9', borderLeft: `3px solid ${accent}` }}>
                      <div style={{ paddingLeft: 15, minWidth: 150 }}>
                        <span style={pill(isCambia ? '#eff6ff' : '#fff7ed', isCambia ? '#1d4ed8' : '#c2410c')}>{isCambia ? '● CAMBIA' : '+ AGGIUNGI'}</span>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 5 }}>{r.zona} · ≤{r.peso} kg</div>
                      </div>
                      <div style={{ flex: 1, fontSize: 14, color: '#0f172a', lineHeight: 1.45 }}>
                        {isCambia ? (
                          <>Sposta su <b style={{ color: '#0369a1' }}>{r.usa}</b> <span style={{ color: '#94a3b8' }}>invece di {r.invece_di}</span>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>margine {eur(r.margine_invece!)} → <b style={{ color: '#16a34a' }}>{eur(r.margine_usa!)}</b></div></>
                        ) : (
                          <>Attiva <b style={{ color: '#c2410c' }}>{r.corriere}</b> <span style={{ color: '#94a3b8' }}>(non nel suo listino)</span>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>renderebbe <b style={{ color: '#16a34a' }}>{eur(r.margine_stimato!)}</b> vs il tuo migliore {r.invece_di} ({eur(r.margine_invece!)})</div></>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', paddingRight: 18, whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>+{eur(r.per_spedizione)}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>a spedizione</div>
                      </div>
                    </div>
                  )
                })}
                {c.raccomandazioni.length > TOP && (
                  <button onClick={() => setTutti(t => ({ ...t, [c.listino_id]: !mostraTutti }))}
                    style={{ width: '100%', padding: '11px', background: '#fafafa', border: 'none', borderTop: '1px solid #f1f5f9', color: '#2563eb', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
