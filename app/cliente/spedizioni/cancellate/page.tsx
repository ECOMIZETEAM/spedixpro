'use client'
import { useState, useEffect } from 'react'

export default function SpedizioniCancellateClientePage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    fetch('/api/spedizioni/lista?stato=annullata')
      .then(r => r.json())
      .then(d => { setSpedizioni(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const visibili = cerca
    ? spedizioni.filter(s =>
        s.numero?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()))
    : spedizioni
  const totalePagine = Math.max(1, Math.ceil(visibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const paginate = visibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <a href="/cliente/spedizioni" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>← Le mie Spedizioni</a>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Spedizioni Cancellate</h1>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>🗑️ Cancellate <span style={{color:'#999',fontWeight:'400',fontSize:'12px'}}>({visibili.length})</span></span>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#666'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)} placeholder="N. spedizione o destinatario..."
              style={{padding:'5px 10px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'12px',width:'220px',color:'#1a1a1a',background:'#fff'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#bbb'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#bbb'}}>
            <div style={{fontSize:'36px',marginBottom:'12px'}}>🗑️</div>
            <div style={{fontSize:'14px',fontWeight:'500',color:'#999'}}>Nessuna spedizione cancellata</div>
          </div>
        ) : (
          <div>
          <div style={{padding:'10px 16px',fontSize:'12px',color:'#1a1a1a'}}>Mostra{' '}<select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'5px',color:'#1a1a1a'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select>{' '}elementi</div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  {['N. Spedizione','Destinatario','Città','Peso','Colli','Data','Totale'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px',color:'#bbb',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginate.map(s => (
                  <tr key={s.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                    <td style={{padding:'10px 14px'}}><span style={{fontWeight:'600',color:'#f97316'}}>{s.numero}</span></td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{color:'#333',fontWeight:'500'}}>{s.dest_nome}</div>
                      <div style={{color:'#bbb',fontSize:'11px'}}>{s.dest_citta} ({s.dest_provincia}), {s.dest_paese}</div>
                    </td>
                    <td style={{padding:'10px 14px',color:'#666'}}>{s.dest_citta}</td>
                    <td style={{padding:'10px 14px',color:'#666'}}>{s.peso_reale}kg</td>
                    <td style={{padding:'10px 14px',color:'#666'}}>{s.colli}</td>
                    <td style={{padding:'10px 14px',color:'#999',fontSize:'12px',whiteSpace:'nowrap'}}>{new Date(s.updated_at || s.created_at).toLocaleDateString('it-IT')} {new Date(s.updated_at || s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{padding:'10px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(s.costo_totale||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'4px',padding:'12px 16px',borderTop:'1px solid #f0f0f0'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length: totalePagine}, (_,i)=>i+1)
              .filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2)
              .map((n,idx,arr)=>(
                <span key={n} style={{display:'flex',alignItems:'center'}}>
                  {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>…</span>}
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
