'use client'
import { useState, useEffect } from 'react'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'auto'}

export default function StoriaPage() {
  const [movimenti, setMovimenti] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [clienteId, setClienteId] = useState('')
  const [dal, setDal] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
  const [al, setAl] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
  }, [])

  useEffect(() => { carica() }, [clienteId, dal, al])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (clienteId) params.set('clienteId', clienteId)
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al)
    const res = await fetch(`/api/consumabili?${params}`)
    const data = await res.json()
    setMovimenti(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const totale = movimenti.reduce((acc, m) => acc + parseFloat(m.totale||0), 0)

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Storia Consumabili</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{movimenti.length} movimenti trovati</p>
      </div>

      {/* Filtri */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
          <div>
            <label style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Cliente</label>
            <select value={clienteId} onChange={e=>setClienteId(e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Periodo</label>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <input type="date" value={dal} onChange={e=>setDal(e.target.value)} style={inp}/>
              <span style={{color:'#1a1a1a'}}>—</span>
              <input type="date" value={al} onChange={e=>setAl(e.target.value)} style={inp}/>
            </div>
          </div>
        </div>
      </div>

      {/* Tabella */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Movimenti</span>
          {movimenti.length > 0 && <span style={{fontSize:'13px',fontWeight:'700',color:'#f97316'}}>Totale: € {totale.toFixed(2)}</span>}
        </div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !movimenti.length ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>
            <div style={{fontSize:'32px',marginBottom:'8px'}}>📋</div>
            Nessun movimento trovato
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#f9fafb'}}>
                {['Data','Cliente','Descrizione','Vettore','Q.tà','Prezzo Unit.','IVA','Totale'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movimenti.map((m:any) => (
                <tr key={m.id} style={{borderBottom:'1px solid #d1d5db'}}>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(m.data_acquisto).toLocaleDateString('it-IT')}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'500'}}>{m.clienti?.ragione_sociale||'—'}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a'}}>{m.descrizione}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a'}}>{m.vettore||'—'}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',textAlign:'center' as const}}>{m.quantita}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a'}}>€ {Number(m.prezzo_unitario).toFixed(2)}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a'}}>{m.iva}%</td>
                  <td style={{padding:'9px 14px',fontWeight:'700',color:'#f97316'}}>€ {Number(m.totale).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}