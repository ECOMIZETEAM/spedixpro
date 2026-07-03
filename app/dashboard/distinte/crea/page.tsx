'use client'
import { useState, useEffect } from 'react'

export default function CreaDistintaPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [contratti, setContratti] = useState<any[]>([])
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [selezionate, setSelezionate] = useState<Set<string>>(new Set())
  const [clienteId, setClienteId] = useState('')
  const [corriereId, setCorriereId] = useState('')
  const oggi = new Date().toISOString().split('T')[0]
  const [dal, setDal] = useState(oggi)
  const [al, setAl] = useState(oggi)
  const [cerca, setCerca] = useState('')
  const [loading, setLoading] = useState(false)
  const [creando, setCreando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : []))
    fetch('/api/corrieri/lista').then(r => r.json()).then(d => setCorrieri(Array.isArray(d) ? d : []))
  }, [])

  useEffect(() => { caricaContratti() }, [clienteId, dal, al])
  useEffect(() => { caricaSpedizioni() }, [clienteId, corriereId, dal, al])
  async function caricaContratti() {
    const params = new URLSearchParams()
    if (clienteId) params.set('clienteId', clienteId)
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al)
    const res = await fetch('/api/distinte/contratti?' + params.toString())
    const d = await res.json()
    const arr = Array.isArray(d) ? d : []
    setContratti(arr)
    // seleziono di default il primo contratto con LDV da chiudere
    const primo = arr.find((c: any) => c.da_chiudere > 0)
    if (primo) setCorriereId(primo.id)
  }

  async function caricaSpedizioni() {
    setLoading(true)
    const params = new URLSearchParams()
    if (clienteId) params.set('clienteId', clienteId)
    if (corriereId) params.set('corriereId', corriereId)
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al)
    const res = await fetch('/api/distinte/spedizioni?' + params.toString())
    const d = await res.json()
    setSpedizioni(Array.isArray(d) ? d : [])
    setSelezionate(new Set())
    setLoading(false)
  }

  function toggle(id: string) {
    setSelezionate(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }
  function selezionaN(n: number) {
    const ids = filtrate.slice(0, n).map(s => s.id)
    setSelezionate(new Set(ids))
  }

  async function creaDistinta() {
    if (!selezionate.size) { alert('Seleziona almeno una spedizione'); return }
    if (!corriereId) { alert('Seleziona un Contratto: ogni distinta deve essere di un solo contratto'); return }
    setCreando(true)
    const res = await fetch('/api/distinte/spedizioni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spedizioniIds: Array.from(selezionate), clienteId: clienteId || null, corriereId: corriereId || null })
    })
    const d = await res.json()
    setCreando(false)
    if (d.success) {
      setMsg('Distinta N. ' + d.numero + ' creata con successo!')
      await caricaSpedizioni()
      setTimeout(() => setMsg(''), 4000)
    } else { alert('Errore: ' + (d.error || 'creazione fallita')) }
  }

  const filtrate = spedizioni.filter(s => !cerca ||
    String(s.numero || '').toLowerCase().includes(cerca.toLowerCase()) ||
    String(s.dest_nome || '').toLowerCase().includes(cerca.toLowerCase()))

  const lbl = { fontSize: '12px', fontWeight: '600', color: '#1a1a1a', display: 'block', marginBottom: '4px' } as const
  const inp = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' } as const
  const btnSel = { padding: '6px 12px', background: '#f1f5f9', color: '#1a1a1a', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', marginRight: '6px' } as const

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Crea Distinta</h1>
      </div>
      {msg && <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', fontWeight: '600' }}>{msg}</div>}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', padding: '16px', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a', marginBottom: '12px' }}>Filtri</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div>
            <label style={lbl}>Data Spedizione</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type="date" value={dal} onChange={e => setDal(e.target.value)} style={inp} />
              <input type="date" value={al} onChange={e => setAl(e.target.value)} style={inp} />
            </div>
          </div>
          <div>
            <label style={lbl}>Cliente</label>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={inp}>
              <option value="">Tutti i clienti</option>
              {clienti.map(c => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Contratto</label>
            <select value={corriereId} onChange={e => setCorriereId(e.target.value)} style={inp}>
              <option value="">Tutti i contratti</option>
              {corrieri.map(c => <option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #d1d5db', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <button style={btnSel} onClick={() => selezionaN(20)}>Seleziona 20</button>
            <button style={btnSel} onClick={() => selezionaN(50)}>Seleziona 50</button>
            <button style={btnSel} onClick={() => selezionaN(100)}>Seleziona 100</button>
          </div>
          <button onClick={creaDistinta} disabled={creando || !selezionate.size}
            style={{ padding: '8px 18px', background: selezionate.size ? '#2563eb' : '#93c5fd', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: selezionate.size ? 'pointer' : 'not-allowed' }}>
            Crea Distinta ({selezionate.size})
          </button>
        </div>
        <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end' }}>
          <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca..."
            style={{ padding: '7px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', width: '260px' }} />
        </div>
        <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['', 'N. Spedizione', 'Mittente', 'Destinatario', 'Citta', 'CAP', 'Provincia', 'Peso', 'Colli', 'Data'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 10px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#1a1a1a', borderBottom: '1px solid #d1d5db', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ padding: '20px', textAlign: 'center', color: '#1a1a1a' }}>Caricamento...</td></tr>
              ) : !filtrate.length ? (
                <tr><td colSpan={10} style={{ padding: '20px', textAlign: 'center', color: '#1a1a1a' }}>Nessuna spedizione da mettere in distinta</td></tr>
              ) : filtrate.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '9px 10px' }}><input type="checkbox" checked={selezionate.has(s.id)} onChange={() => toggle(s.id)} /></td>
                  <td style={{ padding: '9px 10px', color: '#2563eb', fontWeight: '600' }}>{s.numero}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{s.mitt_nome || '—'}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{s.dest_nome || '—'}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{s.dest_citta || '—'}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{s.dest_cap || '—'}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{s.dest_provincia || '—'}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{Number(s.peso_reale || 0).toFixed(2)}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a' }}>{s.colli || 1}</td>
                  <td style={{ padding: '9px 10px', color: '#1a1a1a', whiteSpace: 'nowrap' }}>{s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: '12px', color: '#1a1a1a' }}>Risultati: {filtrate.length} spedizioni</div>
      </div>
    </div>
  )
}