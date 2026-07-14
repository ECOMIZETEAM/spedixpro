'use client'
import { useEffect, useState } from 'react'

const eur = (x: number) => x > 0 ? '€ ' + Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

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
        Il listino (il tuo costo) assegnato dal tuo referente. Sola lettura.
      </p>

      {(!d || d.assegnato === false) ? (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '24px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
          Nessun listino assegnato. Chiedi al tuo referente di assegnartene uno.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: 700, marginBottom: '14px' }}>
            {d.nome}{d.solo_peso_reale ? ' · solo peso reale' : ''}
          </div>
          {(d.corrieri || []).map((c: any, i: number) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{c.nome_contratto}</span>
                <span style={{ fontSize: '11px', color: '#8a8a8a' }}>peso volume 1/{c.fattore}</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: `${160 + (c.zone?.length || 1) * 90}px` }}>
                  <thead>
                    <tr>
                      <th style={thL}>Peso (kg)</th>
                      {(c.zone || []).map((z: string, k: number) => <th key={k} style={th}>{z}</th>)}
                      <th style={th}>Fuel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(c.fasce || []).map((f: any, j: number) => (
                      <tr key={j} style={{ background: j % 2 ? '#fcfcfc' : '#fff' }}>
                        <td style={tdL}>{f.tipo === 'oltre' ? `oltre, ogni ${f.peso_max}` : `fino a ${f.peso_max}`}</td>
                        {(c.zone || []).map((z: string, k: number) => <td key={k} style={td}>{eur(Number(f.prezzi?.[z] || 0))}</td>)}
                        <td style={td}>{f.fuel ? `${f.fuel}%` : '—'}</td>
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

const th = { fontSize: '11px', fontWeight: 700 as const, color: '#8a8a8a', textTransform: 'uppercase' as const, textAlign: 'center' as const, padding: '8px 10px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' as const }
const thL = { ...th, textAlign: 'left' as const }
const td = { fontSize: '12.5px', color: '#1a1a1a', padding: '8px 10px', borderBottom: '1px solid #f6f6f6', textAlign: 'center' as const, whiteSpace: 'nowrap' as const }
const tdL = { ...td, textAlign: 'left' as const, fontWeight: 600 as const, color: '#444' }
