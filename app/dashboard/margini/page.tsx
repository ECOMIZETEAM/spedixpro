'use client'
import { useState, useEffect, useMemo, Fragment } from 'react'

type Riga = { corriere: string; prezzo_cliente: number; costo: number; margine: number }
type Rotta = { zona: string; peso_max: number; migliore: string; margine_migliore: number; guadagno_vs_secondo: number | null; corrieri: Riga[] }
type Cli = { listino_id: string; clienti: string[]; rotte: Rotta[]; rotte_multi: number }

export default function OttimizzaMargini() {
  const [data, setData] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [aperto, setAperto] = useState<string | null>(null)
  const [dettaglio, setDettaglio] = useState<string | null>(null)   // "listino|zona|peso" della rotta espansa

  useEffect(() => {
    fetch('/api/network/ottimizza-margini').then(r => r.json()).then(j => { setData(Array.isArray(j?.clienti) ? j.clienti : []); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const eur = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const nomeCli = (c: Cli) => (c.clienti || []).join(', ') || 'Listino'
  const visibili = useMemo(() => data.filter(c => !cerca || nomeCli(c).toLowerCase().includes(cerca.toLowerCase())), [data, cerca])

  const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', marginBottom: '12px', overflow: 'hidden' } as const
  const th = { padding: '8px 10px', textAlign: 'left' as const, fontSize: '11px', fontWeight: 700, color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' as const }
  const td = { padding: '8px 10px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f3f4f6' }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', margin: '0 0 6px' }}>Ottimizza margini</h1>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px' }}>
        Per ogni cliente, zona e fascia: il corriere che ti fa guadagnare di più (margine <b>tutto incluso</b>: prezzo cliente − tuo costo, nolo + fuel).
        Contrassegno/assicurazione e sponda dipendono dal singolo invio e non entrano nel confronto. Solo analisi: nessun prezzo viene modificato.
      </p>

      <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente…"
        style={{ width: '100%', maxWidth: '340px', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', color: '#1a1a1a', marginBottom: '16px' }} />

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Calcolo margini…</div>
      ) : !visibili.length ? (
        <div style={{ ...card, padding: '20px', textAlign: 'center', color: '#9ca3af' }}>Nessun dato: nessun cliente con corriere attivo confrontabile.</div>
      ) : visibili.map(c => {
        const isOpen = aperto === c.listino_id
        return (
          <div key={c.listino_id} style={card}>
            <button onClick={() => setAperto(isOpen ? null : c.listino_id)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{nomeCli(c)}</span>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>{c.rotte.length} rotte · {isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div style={{ overflowX: 'auto', borderTop: '1px solid #eee' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Zona', 'Fascia', 'Corriere migliore', 'Margine', '+€ vs 2°', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {c.rotte.map((r, i) => {
                      const key = c.listino_id + '|' + r.zona + '|' + r.peso_max
                      const exp = dettaglio === key
                      return (
                        <Fragment key={i}>
                          <tr>
                            <td style={td}>{r.zona}</td>
                            <td style={td}>fino a {r.peso_max} kg</td>
                            <td style={{ ...td, fontWeight: 700, color: '#0369a1' }}>{r.migliore}</td>
                            <td style={{ ...td, fontWeight: 700, color: r.margine_migliore >= 0 ? '#16a34a' : '#dc2626' }}>{eur(r.margine_migliore)}</td>
                            <td style={{ ...td, color: '#9a3412' }}>{r.guadagno_vs_secondo != null && r.guadagno_vs_secondo > 0 ? '+' + eur(r.guadagno_vs_secondo) : '—'}</td>
                            <td style={td}>{r.corrieri.length > 1 && <button onClick={() => setDettaglio(exp ? null : key)} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '12px' }}>{exp ? 'nascondi' : 'confronta'}</button>}</td>
                          </tr>
                          {exp && (
                            <tr>
                              <td colSpan={6} style={{ background: '#f9fafb', padding: '8px 16px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <thead><tr>{['Corriere', 'Prezzo cliente', 'Tuo costo', 'Margine'].map(h => <th key={h} style={{ ...th, borderBottom: '1px solid #e5e7eb' }}>{h}</th>)}</tr></thead>
                                  <tbody>
                                    {r.corrieri.map((x, j) => (
                                      <tr key={j} style={{ background: j === 0 ? '#f0fdf4' : 'transparent' }}>
                                        <td style={td}>{x.corriere}{j === 0 ? ' ✅' : ''}</td>
                                        <td style={td}>{eur(x.prezzo_cliente)}</td>
                                        <td style={td}>{eur(x.costo)}</td>
                                        <td style={{ ...td, fontWeight: 600, color: x.margine >= 0 ? '#16a34a' : '#dc2626' }}>{eur(x.margine)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
