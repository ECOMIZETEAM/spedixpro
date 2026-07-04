'use client'

import { useEffect, useState } from 'react'

const ACCENT = '#f97316'

type Movimento = {
  id: string
  tipo: string
  descrizione: string
  riferimento: string | null
  importo: number
  saldo_dopo: number
  created_at: string
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '20px',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#888',
  textTransform: 'uppercase', letterSpacing: '.03em', padding: '10px 12px',
  borderBottom: '1px solid #eee', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  fontSize: '13px', color: '#333', padding: '11px 12px', borderBottom: '1px solid #f2f2f2',
  whiteSpace: 'nowrap',
}

function fmtEuro(n: number) {
  const v = Number(n || 0)
  const s = v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `€ ${s}`
}
function fmtImporto(n: number) {
  const v = Number(n || 0)
  const seg = v > 0 ? '+' : v < 0 ? '−' : ''
  const abs = Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${seg} € ${abs}`
}
function fmtData(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
}

export default function MovimentiClientePage() {
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [saldo, setSaldo] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/movimenti/lista')
        const data = await res.json()
        if (res.ok) {
          setMovimenti(data.movimenti || [])
          setSaldo(Number(data.saldo || 0))
        } else {
          setErr(data.error || 'Errore nel caricamento')
        }
      } catch {
        setErr('Errore di rete')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const visibili = cerca
    ? movimenti.filter(m =>
        m.descrizione?.toLowerCase().includes(cerca.toLowerCase()) ||
        (m.riferimento || '').toLowerCase().includes(cerca.toLowerCase()))
    : movimenti

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Lista Movimenti</h1>
        <p style={{ color: '#999', fontSize: '13px', marginTop: '4px' }}>
          Storico di ricariche, spedizioni, rimborsi, resi e rettifiche
        </p>
      </div>

      {/* Saldo attuale */}
      <div style={{ ...card, marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em' }}>
            Credito disponibile
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: saldo < 0 ? '#b91c1c' : '#15803d', marginTop: '4px' }}>
            {fmtEuro(saldo)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12.5px', color: '#666' }}>Cerca:</span>
          <input
            value={cerca}
            onChange={e => setCerca(e.target.value)}
            placeholder="Movimento o riferimento…"
            style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', width: '220px', color: '#1a1a1a', background: '#fff' }}
          />
        </div>
      </div>

      {/* Tabella */}
      <div style={card}>
        {err && (
          <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c' }}>
            {err}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : !visibili.length ? (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#999' }}>Nessun movimento</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Data e ora</th>
                  <th style={th}>Movimento</th>
                  <th style={{ ...th, textAlign: 'right' }}>Importo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map(m => {
                  const positivo = Number(m.importo) > 0
                  return (
                    <tr key={m.id}>
                      <td style={{ ...td, color: '#666', fontSize: '12px' }}>{fmtData(m.created_at)}</td>
                      <td style={{ ...td, color: '#1a1a1a', whiteSpace: 'normal' }}>{m.descrizione}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: positivo ? '#15803d' : '#b91c1c' }}>
                        {fmtImporto(Number(m.importo))}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: '#1a1a1a' }}>{fmtEuro(Number(m.saldo_dopo))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
