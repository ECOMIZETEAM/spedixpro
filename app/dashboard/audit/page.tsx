'use client'
import { useState, useEffect, useCallback } from 'react'

const card = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '16px', marginBottom: '16px' }
const inp = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff' }
const th = { textAlign: 'left' as const, padding: '9px 12px', fontSize: '11px', fontWeight: 700 as const, textTransform: 'uppercase' as const, color: '#666', borderBottom: '1px solid #e8e8e8', whiteSpace: 'nowrap' as const }
const td = { padding: '9px 12px', fontSize: '12.5px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' as const }

const TABELLE = [
  ['', 'Tutte le tabelle'],
  ['listini_corrieri', 'Listino corrieri (default)'],
  ['listini_corrieri_corrieri', 'Listino corrieri (per contratto)'],
  ['listini_clienti', 'Listino cliente (default)'],
  ['listini_clienti_corrieri', 'Listino cliente (per contratto)'],
  ['listini_corrieri_fasce', 'Fasce prezzo (corrieri)'],
  ['listini_clienti_fasce', 'Fasce prezzo (cliente)'],
  ['listini_corrieri_supplementi', 'Supplementi (corrieri)'],
  ['listini_clienti_supplementi', 'Supplementi (cliente)'],
]

function fmtData(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}
function fmtVal(v: any) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function AuditPage() {
  const [righe, setRighe] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState('')
  const [tabella, setTabella] = useState('')
  const [q, setQ] = useState('')
  const oggi = new Date().toISOString().split('T')[0]
  const [dal, setDal] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
  const [al, setAl] = useState(oggi)

  const carica = useCallback(async () => {
    setLoading(true); setErrore('')
    const params = new URLSearchParams()
    if (tabella) params.set('tabella', tabella)
    if (q.trim()) params.set('q', q.trim())
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al)
    try {
      const res = await fetch(`/api/audit?${params}`)
      const data = await res.json()
      if (!res.ok) { setErrore(data?.error || 'Errore'); setRighe([]) }
      else setRighe(data.righe || [])
    } catch { setErrore('Errore di rete') }
    setLoading(false)
  }, [tabella, q, dal, al])

  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Registro Attività</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Chi ha modificato cosa sui listini (fattori volumetrici, prezzi, supplementi) — da → a. Riservato al super master.</p>
      </div>

      {errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626' }}>{errore}</div>}

      <div style={{ ...card, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Tabella</label>
          <select value={tabella} onChange={e => setTabella(e.target.value)} style={{ ...inp, minWidth: '220px' }}>
            {TABELLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Cerca (attore, id, valore)</label>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && carica()} placeholder="es. nome, 5000, id listino…" style={{ ...inp, minWidth: '240px' }} />
        </div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Dal</label>
          <input type="date" value={dal} onChange={e => setDal(e.target.value)} style={inp} /></div>
        <div><label style={{ fontSize: '11px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Al</label>
          <input type="date" value={al} onChange={e => setAl(e.target.value)} style={inp} /></div>
        <button onClick={carica} style={{ padding: '9px 20px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Filtra</button>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #e8e8e8', fontSize: '12px', color: '#666' }}>{loading ? 'Caricamento…' : `${righe.length} modifiche`}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>
              <th style={th}>Data e ora</th><th style={th}>Attore</th><th style={th}>Azione</th><th style={th}>Tabella</th><th style={th}>Record</th><th style={th}>Modifiche</th>
            </tr></thead>
            <tbody>
              {!loading && righe.length === 0 ? (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#999', padding: '30px' }}>Nessuna modifica nel periodo.</td></tr>
              ) : righe.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#666' }}>{fmtData(r.at)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.attore}</td>
                  <td style={td}><span style={{ fontSize: '11px', fontWeight: 700, color: r.azione === 'DELETE' ? '#dc2626' : r.azione === 'INSERT' ? '#16a34a' : '#2563eb' }}>{r.azione}</span></td>
                  <td style={{ ...td, color: '#666' }}>{r.tabella}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px', color: '#999' }}>{(r.record_id || '').slice(0, 8)}</td>
                  <td style={td}>
                    {r.azione === 'UPDATE' && r.modifiche ? (
                      Object.entries(r.modifiche).map(([campo, v]: any) => (
                        <div key={campo} style={{ marginBottom: '2px' }}>
                          <b>{campo}</b>: <span style={{ color: '#dc2626' }}>{fmtVal(v?.da)}</span> → <span style={{ color: '#16a34a' }}>{fmtVal(v?.a)}</span>
                        </div>
                      ))
                    ) : (
                      <span style={{ color: '#999', fontSize: '11px' }}>{JSON.stringify(r.modifiche || {}).slice(0, 120)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
