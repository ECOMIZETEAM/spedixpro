'use client'
import { useState, useEffect } from 'react'

type Movimento = {
  id: string
  created_at: string
  tipo: string
  descrizione: string
  importo: number
  saldo_dopo: number
}

export default function MovimentiPage() {
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [saldo, setSaldo] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    fetch('/api/cliente/movimenti')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErr(d.error); setLoading(false); return }
        setMovimenti(Array.isArray(d.movimenti) ? d.movimenti : [])
        setSaldo(d.saldo || 0)
        setLoading(false)
      })
      .catch(() => { setErr('Errore caricamento'); setLoading(false) })
  }, [])

  const visibili = cerca
    ? movimenti.filter(m => m.descrizione?.toLowerCase().includes(cerca.toLowerCase()) || m.tipo?.toLowerCase().includes(cerca.toLowerCase()))
    : movimenti

  const totalePagine = Math.max(1, Math.ceil(visibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const _pag = visibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Movimenti Credito</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Saldo attuale: <strong style={{ color: '#16a34a' }}>{'\u20AC'} {Number(saldo).toFixed(2)}</strong></p>
      </div>

      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', color: '#1a1a1a' }}>Mostra</span>
          <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPagina(1) }}
            style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '13px', color: '#1a1a1a', background: '#fff' }}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
          <span style={{ fontSize: '13px', color: '#1a1a1a' }}>elementi</span>
        </div>
        <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder="Cerca..."
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', width: '200px', color: '#1a1a1a', background: '#fff' }} />
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#1a1a1a' }}>Caricamento...</div>
        ) : err ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>{err}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Data', 'Tipo', 'Descrizione', 'Importo', 'Saldo'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 14px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#1a1a1a', borderBottom: '1px solid #d1d5db' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!visibili.length ? (
                <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#1a1a1a' }}>Nessun movimento</td></tr>
              ) : _pag.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '9px 14px', fontSize: '12px', color: '#1a1a1a' }}>{new Date(m.created_at).toLocaleString('it-IT')}</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ background: m.tipo === 'ricarica' ? '#f0fdf4' : '#fef2f2', color: m.tipo === 'ricarica' ? '#16a34a' : '#dc2626', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>{m.tipo}</span>
                  </td>
                  <td style={{ padding: '9px 14px', color: '#1a1a1a' }}>{m.descrizione}</td>
                  <td style={{ padding: '9px 14px', fontWeight: '700', color: m.importo >= 0 ? '#16a34a' : '#dc2626' }}>{m.importo >= 0 ? '+' : ''}{'\u20AC'} {Number(m.importo).toFixed(2)}</td>
                  <td style={{ padding: '9px 14px', color: '#1a1a1a' }}>{'\u20AC'} {Number(m.saldo_dopo).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !err && totalePagine > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px', borderTop: '1px solid #e5e7eb' }}>
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaCorr <= 1} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', fontSize: '12px', cursor: 'pointer', color: paginaCorr <= 1 ? '#ccc' : '#1a1a1a' }}>Precedente</button>
            {Array.from({ length: totalePagine }, (_, i) => i + 1).filter(n => n === 1 || n === totalePagine || Math.abs(n - paginaCorr) <= 2).map((n) => (
              <button key={n} onClick={() => setPagina(n)} style={{ minWidth: '30px', padding: '5px 8px', border: '1px solid', borderColor: n === paginaCorr ? '#f97316' : '#d1d5db', borderRadius: '5px', background: n === paginaCorr ? '#f97316' : '#fff', color: n === paginaCorr ? '#fff' : '#1a1a1a', fontSize: '12px', cursor: 'pointer' }}>{n}</button>
            ))}
            <button onClick={() => setPagina(p => Math.min(totalePagine, p + 1))} disabled={paginaCorr >= totalePagine} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', fontSize: '12px', cursor: 'pointer', color: paginaCorr >= totalePagine ? '#ccc' : '#1a1a1a' }}>Successivo</button>
          </div>
        )}
      </div>
    </div>
  )
}