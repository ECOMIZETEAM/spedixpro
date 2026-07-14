'use client'
import { useEffect, useState } from 'react'

const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' as const }
const th = { fontSize: '11px', fontWeight: 700 as const, color: '#8a8a8a', textTransform: 'uppercase' as const, textAlign: 'left' as const, padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }
const td = { fontSize: '13px', color: '#1a1a1a', padding: '8px 12px', borderBottom: '1px solid #f6f6f6' }

export default function MioListinoPage() {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/agente/mio-listino').then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Caricamento…</div>

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Il mio listino</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 18px' }}>
        Il listino (il tuo costo) che ti ha assegnato il tuo referente. Sola lettura.
      </p>

      {(!d || d.assegnato === false) ? (
        <div style={{ ...card, padding: '24px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
          Nessun listino assegnato. Chiedi al tuo referente di assegnartene uno.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: 700, marginBottom: '10px' }}>
            {d.nome}{d.solo_peso_reale ? ' · solo peso reale' : ''}
          </div>
          {(d.corrieri || []).map((c: any, i: number) => (
            <div key={i} style={card}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a' }}>{c.nome_contratto}</span>
                <span style={{ fontSize: '11px', color: '#8a8a8a' }}>peso volume 1/{c.fattore}</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '360px' }}>
                  <thead><tr><th style={th}>Zona</th><th style={th}>Fino a kg</th><th style={th}>Prezzo</th><th style={th}>Fuel</th></tr></thead>
                  <tbody>
                    {(c.righe || []).map((r: any, j: number) => (
                      <tr key={j}>
                        <td style={td}>{r.zona}</td>
                        <td style={td}>{r.tipo === 'oltre' ? `oltre, ogni ${r.peso_max}kg` : `${r.peso_max}`}</td>
                        <td style={{ ...td, fontWeight: 700 }}>€ {Number(r.prezzo).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style={td}>{r.fuel ? `${r.fuel}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
