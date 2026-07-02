'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

const sel = {padding:'6px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box' as const}
const inp = {padding:'6px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}

export default function ElencoRitiriPage() {
  const searchParams = useSearchParams()
  const success = searchParams.get('success')
  const [ritiri, setRitiri] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [filtri, setFiltri] = useState({
    clienteId: '', vettore: '', codRitiro: '',
    dal: '', al: '',
  })

  useEffect(() => {
    carica()
    fetch('/api/clienti/lista').then(r => r.json()).then(d => {
      setClienti(Array.isArray(d) ? d : (d?.clienti || []))
    }).catch(() => {})
  }, [])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.vettore) params.set('vettore', filtri.vettore)
    if (filtri.codRitiro) params.set('codRitiro', filtri.codRitiro)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    try {
      const res = await fetch('/api/ritiri?' + params.toString())
      const d = await res.json()
      setRitiri(Array.isArray(d) ? d : [])
    } catch { setRitiri([]) }
    setLoading(false)
  }

  const setF = (k: string, v: string) => setFiltri(f => ({ ...f, [k]: v }))

  const filtrati = cerca
    ? ritiri.filter(r =>
        r.cod_ritiro?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.tracking_ritiro?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.mitt_nome?.toLowerCase().includes(cerca.toLowerCase()))
    : ritiri

  const STATO_LABELS: Record<string, { label: string; bg: string; color: string }> = {
    richiesto: { label: 'Richiesto', bg: '#fff7ed', color: '#f97316' },
    confermato: { label: 'Confermato', bg: '#eff6ff', color: '#2563eb' },
    completato: { label: 'Completato', bg: '#f0fdf4', color: '#16a34a' },
    annullato: { label: 'Annullato', bg: '#fef2f2', color: '#dc2626' },
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Elenco Ritiri</h1>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>{filtrati.length} ritiri</p>
        </div>
        <a href="/dashboard/ritiri/nuovo" style={{ background: '#f97316', color: '#fff', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>+ Nuovo Ritiro</a>
      </div>

      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#15803d' }}>
          ✓ Ritiro richiesto con successo! ID Pickup: <strong>{success}</strong>
        </div>
      )}

      {/* Filtri */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', padding: '14px 16px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#1a1a1a', marginBottom: '10px' }}>▼ Filtri</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Cliente</div>
            <select value={filtri.clienteId} onChange={e => setF('clienteId', e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c: any) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Vettore</div>
            <select value={filtri.vettore} onChange={e => setF('vettore', e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option>
              <option value="gls">GLS</option>
              <option value="brt">BRT</option>
              <option value="poste">Poste Italiane</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Data:</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="date" value={filtri.dal} onChange={e => setF('dal', e.target.value)} style={inp} />
              <span style={{ color: '#1a1a1a' }}>—</span>
              <input type="date" value={filtri.al} onChange={e => setF('al', e.target.value)} style={inp} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>COD Ritiro</div>
            <input value={filtri.codRitiro} onChange={e => setF('codRitiro', e.target.value)}
              style={{ ...inp, width: '100%', boxSizing: 'border-box' as const }} placeholder="es. CP123..." />
          </div>
          <div>
            <button onClick={carica}
              style={{ padding: '7px 20px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
              Filtra
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#1a1a1a' }}>Cerca:</span>
            <input value={cerca} onChange={e => setCerca(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', width: '180px', color: '#1a1a1a' }} placeholder="CP, mittente..." />
          </div>
        </div>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#1a1a1a' }}>Caricamento...</div>
        ) : !filtrati.length ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#1a1a1a' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
            <div style={{ fontSize: '14px', fontWeight: '500' }}>Nessun ritiro trovato</div>
            <a href="/dashboard/ritiri/nuovo" style={{ display: 'inline-block', marginTop: '12px', background: '#f97316', color: '#fff', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>Crea il primo</a>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['ID Pickup', 'Cliente', 'Mittente', 'Colli', 'Peso', 'Data Ritiro', 'Stato', 'Richiesto il'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 14px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrati.map(r => {
                  const st = STATO_LABELS[r.stato] || { label: r.stato, bg: '#f3f4f6', color: '#6b7280' }
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 14px', fontWeight: '600', color: '#1a1a1a' }}>{r.cod_ritiro || r.tracking_ritiro || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.clienti?.ragione_sociale || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.mitt_nome}</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.colli}</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.peso} kg</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.data_ritiro ? new Date(r.data_ritiro).toLocaleDateString('it-IT') : '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '600' }}>{st.label}</span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#999', fontSize: '12px' }}>{new Date(r.created_at).toLocaleDateString('it-IT')}</td>
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
