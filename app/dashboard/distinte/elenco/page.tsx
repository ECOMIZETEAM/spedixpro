'use client'
import { useState, useEffect } from 'react'

export default function ElencoDistintePage() {
  const [distinte, setDistinte] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const oggi = new Date().toISOString().split('T')[0]
  const [dal, setDal] = useState('')
  const [al, setAl] = useState('')

  useEffect(() => { carica() }, [dal, al])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al)
    const res = await fetch('/api/distinte?' + params.toString())
    const d = await res.json()
    setDistinte(Array.isArray(d) ? d : [])
    setLoading(false)
  }

  const filtrate = distinte.filter(d => !cerca ||
    String(d.numero || '').toLowerCase().includes(cerca.toLowerCase()) ||
    String(d.clienti?.ragione_sociale || '').toLowerCase().includes(cerca.toLowerCase()))

  const inp = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff' } as const
  const th = { padding: '9px 12px', textAlign: 'left' as const, fontSize: '11px', fontWeight: '700', color: '#1a1a1a', borderBottom: '1px solid #d1d5db', whiteSpace: 'nowrap' as const }
  const td = { padding: '9px 12px', fontSize: '12px', color: '#1a1a1a' }

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Elenco Distinte</h1>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', padding: '14px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Dalla data</div>
          <input type="date" value={dal} onChange={e => setDal(e.target.value)} style={inp} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Alla data</div>
          <input type="date" value={al} onChange={e => setAl(e.target.value)} style={inp} />
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Cerca</div>
          <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Numero o cliente..." style={{ ...inp, width: '240px' }} />
        </div>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Numero', 'Cliente', 'Contratto', 'Data', 'Colli', 'Peso (kg)', 'Stato'].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: '20px' }}>Caricamento...</td></tr>
              ) : !filtrate.length ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: '20px' }}>Nessuna distinta creata</td></tr>
              ) : filtrate.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ ...td, fontWeight: '700', color: '#2563eb' }}>{d.numero}</td>
                  <td style={td}>{d.clienti?.ragione_sociale || '—'}</td>
                  <td style={td}>{d.corrieri?.nome_contratto || '—'}</td>
                  <td style={td}>{d.data ? new Date(d.data).toLocaleDateString('it-IT') : '—'}</td>
                  <td style={td}>{d.totale_colli || 0}</td>
                  <td style={td}>{Number(d.totale_peso || 0).toFixed(2)}</td>
                  <td style={td}><span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>{d.stato || 'chiusa'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: '12px', color: '#1a1a1a' }}>Risultati: {filtrate.length} distinte</div>
      </div>
    </div>
  )
}