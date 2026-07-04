'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',background:'#fff',color:'#1a1a1a'}

export default function DistinteResiPage() {
  const [distinte, setDistinte] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dal, setDal] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().split('T')[0]
  })
  const [al, setAl] = useState(() => new Date().toISOString().split('T')[0])
  const [clienteId, setClienteId] = useState('')

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
  }, [])

  useEffect(() => { carica() }, [dal, al, clienteId])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al + 'T23:59:59')
    if (clienteId) params.set('cliente_id', clienteId)
    const res = await fetch(`/api/resi/distinte?${params}`)
    const data = await res.json()
    setDistinte(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Elenco Distinte Resi</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{distinte.length} distinte trovate</p>
      </div>

      {/* Filtri */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'12px',textTransform:'uppercase' as const,letterSpacing:'0.5px',display:'flex',alignItems:'center',gap:'6px'}}>
          <span>▼</span> Filtri
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Data distinte</label>
            <DateRangePicker dal={dal} al={al} onChange={(d1,d2)=>{setDal(d1);setAl(d2)}} />
          </div>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Cliente</label>
            <select value={clienteId} onChange={e=>setClienteId(e.target.value)}
              style={{...inp,width:'100%'}}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tabella */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>
          Lista Distinte di Reso
        </div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#f9fafb'}}>
                {['Nr','Cliente','Data','Totale Ldv','Totale','Azioni'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,letterSpacing:'0.5px',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!distinte.length ? (
                <tr><td colSpan={6} style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessuna distinta trovata</td></tr>
              ) : distinte.map((d:any) => (
                <tr key={d.id} style={{borderBottom:'1px solid #d1d5db'}}>
                  <td style={{padding:'10px 14px',fontWeight:'700',color:'#1a1a1a'}}>{d.numero}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a'}}>{d.clienti?.ragione_sociale||'—'}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(d.created_at).toLocaleString('it-IT')}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a',fontWeight:'500'}}>{d.totale_ldv}</td>
                  <td style={{padding:'10px 14px',fontWeight:'700',color:'#f97316'}}>€ {Number(d.totale||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px'}}>
                    <div style={{display:'flex',gap:'6px'}}>
                      <button onClick={()=>window.open(`/dashboard/resi/distinte/${d.id}`,'_blank')}
                        style={{padding:'5px 12px',background:'#eff6ff',color:'#1d4ed8',border:'1px solid #93c5fd',borderRadius:'5px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>👁 Visualizza</button>
                      <button onClick={()=>window.open(`/dashboard/resi/distinte/${d.id}`,'_blank')}
                        style={{padding:'5px 12px',background:'#f0fdf4',color:'#15803d',border:'1px solid #86efac',borderRadius:'5px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>⬇ Scarica</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}