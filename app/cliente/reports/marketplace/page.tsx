'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'

type Gruppo = { piattaforma: string; data: string; n: number }

const PIATT: Record<string, { label: string; emoji: string; nota: string }> = {
  amazon: { label: 'Amazon', emoji: '📦', nota: 'Scarica il file e caricalo su Amazon (Seller Central → Ordini → Carica file conferma spedizione) per marcare gli ordini come spediti con tracking.' },
  shopify: { label: 'Shopify', emoji: '🛍️', nota: 'CSV con numero ordine e tracking, utile come riferimento per l\'evasione.' },
  altro: { label: 'Altri file', emoji: '📄', nota: 'CSV ordine + tracking.' },
}

const card: React.CSSProperties = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden', marginBottom: '20px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', padding: '10px 14px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', color: '#333', padding: '11px 14px', borderBottom: '1px solid #f2f2f2', whiteSpace: 'nowrap' }

export default function ReportMarketplacePage() {
  const [gruppi, setGruppi] = useState<Gruppo[]>([])
  const [totali, setTotali] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cliente/reports/marketplace')
        const data = await res.json()
        if (res.ok) { setGruppi(data.gruppi || []); setTotali(data.totali || {}) }
      } catch { /* silente */ }
      setLoading(false)
    })()
  }, [])

  const scarica = (piatt: string, data?: string) => {
    const q = new URLSearchParams({ piattaforma: piatt })
    if (data) q.set('data', data)
    window.location.href = '/api/cliente/reports/marketplace/download?' + q.toString()
  }

  const piattaforme = ['amazon', 'shopify'].filter(p => (totali[p] || 0) > 0 || gruppi.some(g => g.piattaforma === p))
  const hasDati = gruppi.length > 0

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Report Marketplace</h1>
        <p style={{ color: '#999', fontSize: '13px', marginTop: '4px' }}>
          Ordini importati da file (Amazon, Shopify) e spediti: scarica il file con i tracking da ricaricare sul marketplace.
        </p>
      </div>

      {loading ? (
        <div style={{ color: '#999', fontSize: '13px' }}>Caricamento…</div>
      ) : !hasDati ? (
        <div style={{ ...card, padding: '28px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
          Nessun ordine importato da file e spedito, per ora. Quando importi un file (Amazon/Shopify) e spedisci gli ordini, qui trovi i report con i tracking da scaricare.
        </div>
      ) : (
        (piattaforme.length ? piattaforme : ['amazon', 'shopify']).map(piatt => {
          const gs = gruppi.filter(g => g.piattaforma === piatt)
          if (!gs.length) return null
          const meta = PIATT[piatt] || PIATT.altro
          const tot = totali[piatt] || gs.reduce((s, g) => s + g.n, 0)
          return (
            <div key={piatt} style={card}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>{meta.emoji}</span>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Report {meta.label}</div>
                    <div style={{ fontSize: '12px', color: '#888' }}>{tot} ordini spediti</div>
                  </div>
                </div>
                <button onClick={() => scarica(piatt)}
                  style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                  ⬇ Scarica tutto ({meta.label})
                </button>
              </div>
              <div style={{ padding: '10px 16px', fontSize: '12px', color: '#666', background: '#fafafa', borderBottom: '1px solid #eee' }}>{meta.nota}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Data spedizione</th>
                      <th style={th}>N. ordini</th>
                      <th style={{ ...th, textAlign: 'right' }}>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gs.map(g => (
                      <tr key={g.data}>
                        <td style={td}>{g.data}</td>
                        <td style={td}>{g.n}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button onClick={() => scarica(piatt, g.data)}
                            style={{ background: '#fff', color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                            ⬇ Scarica
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
