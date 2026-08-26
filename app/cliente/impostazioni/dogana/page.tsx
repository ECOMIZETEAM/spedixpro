'use client'
import { useState, useEffect } from 'react'

// Dati doganali del cliente (EORI). Serve per le spedizioni extra-UE: senza, la dogana blocca
// l'emissione della lettera di vettura. Salvato su clienti.eori via PATCH /api/cliente/dati.
export default function DatiDoganaliPage() {
  const [eori, setEori] = useState('')
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  useEffect(() => {
    fetch('/api/cliente/dati').then(r => r.json()).then(d => { setEori(d?.eori || ''); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  async function salva() {
    setSalvando(true); setMsg(null)
    try {
      const r = await fetch('/api/cliente/dati', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eori }) })
      setMsg(r.ok ? { ok: true, t: 'Salvato' } : { ok: false, t: 'Errore nel salvataggio' })
    } catch { setMsg({ ok: false, t: 'Errore di rete' }) }
    setSalvando(false)
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Dati doganali</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Per le spedizioni fuori dall&apos;Unione Europea</p>
      </div>
      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '24px', maxWidth: '540px' }}>
        <p style={{ fontSize: '13.5px', color: '#555', lineHeight: 1.6, margin: '0 0 18px' }}>
          Il <strong>codice EORI</strong> identifica la tua azienda come esportatore verso i paesi extra-UE
          (Svizzera, Regno Unito, ecc.). Senza, la dogana non sdogana il pacco e il corriere non emette la
          lettera di vettura. Va inserito una sola volta.
        </p>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>Codice EORI</label>
        <input value={eori} onChange={e => setEori(e.target.value)} disabled={loading} placeholder="Es. IT12345678901"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <button onClick={salva} disabled={salvando || loading}
            style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', opacity: (salvando || loading) ? 0.6 : 1 }}>
            {salvando ? 'Salvataggio…' : 'Salva'}
          </button>
          {msg && <span style={{ fontSize: '13px', fontWeight: 600, color: msg.ok ? '#15803d' : '#b91c1c' }}>{msg.ok ? '✓ ' : ''}{msg.t}</span>}
        </div>
      </div>
    </div>
  )
}
