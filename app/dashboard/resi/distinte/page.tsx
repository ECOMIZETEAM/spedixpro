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
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
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

  const totalePagine = Math.max(1, Math.ceil(distinte.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const distintePaginate = distinte.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Elenco Distinte Resi</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{distinte.length} distinte trovate</p>
        <span style={{display:'block',marginTop:'4px',fontSize:'12px',fontWeight:'400',color:'#666'}}>
          Mostra{' '}
          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}}
            style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>{' '}elementi
        </span>
      </div>

      {/* Filtri */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'12px',textTransform:'uppercase' as const,letterSpacing:'0.5px',display:'flex',alignItems:'center',gap:'6px'}}>
          <span>{'\u25BC'}</span> Filtri
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Data distinte</label>
            <DateRangePicker dal={dal} al={al} onChange={(d1,d2)=>{setDal(d1);setAl(d2)}} />
          </div>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Cliente</label>
            <select value={clienteId} onChange={e=>{setClienteId(e.target.value);setPagina(1)}}
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
              ) : distintePaginate.map((d:any) => (
                <tr key={d.id} style={{borderBottom:'1px solid #d1d5db'}}>
                  <td style={{padding:'10px 14px',fontWeight:'700',color:'#1a1a1a'}}>{d.numero}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a'}}>
                    {d.clienti?.ragione_sociale || (d.sottomaster ? (
                      <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                        <span style={{background:'#1a1a1a',color:'#fff',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:'700',letterSpacing:'0.5px'}}>RETE</span>
                        {d.sottomaster}
                      </span>
                    ) : '-')}
                  </td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(d.created_at).toLocaleString('it-IT')}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a',fontWeight:'500'}}>
                    {d.totale_ldv}
                    {Array.isArray(d.voci) && d.voci.length > 0 && (
                      <div style={{fontSize:'11px',color:'#666',marginTop:'2px',fontFamily:'monospace'}}>
                        {d.voci.slice(0,3).map((v:any)=>v.numero).filter(Boolean).join(', ')}{d.voci.length>3?` +${d.voci.length-3}`:''}
                      </div>
                    )}
                  </td>
                  <td style={{padding:'10px 14px',fontWeight:'700',color:'#f97316'}}>{'\u20AC'} {Number(d.totale||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px'}}>
                    <div style={{display:'flex',gap:'6px'}}>
                      <button onClick={()=>window.open(`/dashboard/resi/distinte/${d.id}`,'_blank')}
                        style={{padding:'5px 12px',background:'#fff7ed',color:'#ea580c',border:'1px solid #fdba74',borderRadius:'5px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>{'\uD83D\uDC41'} Visualizza</button>
                      <button onClick={()=>window.open(`/dashboard/resi/distinte/${d.id}`,'_blank')}
                        style={{padding:'5px 12px',background:'#f0fdf4',color:'#15803d',border:'1px solid #86efac',borderRadius:'5px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>{'\u2B07'} Scarica</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && totalePagine > 0 && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#666'}}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, distinte.length)} di {distinte.length}</span>
            <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
              <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
              {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(
                <span key={n} style={{display:'flex',alignItems:'center'}}>
                  {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>{'\u2026'}</span>}
                  <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
                </span>
              ))}
              <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}