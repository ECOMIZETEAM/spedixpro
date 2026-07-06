'use client'
import { useState, useEffect } from 'react'

export default function StoricoCreditoSmsPage() {
  const [storico, setStorico] = useState<any[]>([])
  const [cerca, setCerca] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    setStorico([])
  }, [])

  const storicofiltrato = cerca
    ? storico.filter(s => s.descrizione?.toLowerCase().includes(cerca.toLowerCase()))
    : storico

  const totalePagine = Math.max(1, Math.ceil(storicofiltrato.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const storicoPaginate = storicofiltrato.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Notifiche SMS</h1>
        <span style={{display:'block',marginTop:'4px',fontSize:'12px',fontWeight:'400',color:'#666'}}>
          Mostra{' '}
          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}}
            style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>{' '}elementi
        </span></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px',color:'#1a1a1a',fontWeight:'600',cursor:'pointer'}}>
            🔄 Storico Credito
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)}
              style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'180px',color:'#1a1a1a'}}/>
          </div>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead>
            <tr style={{background:'#f9fafb'}}>
              {['Data','Descrizione','Importo','Totale'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!storicofiltrato.length ? (
              <tr><td colSpan={4} style={{padding:'20px 14px',color:'#f97316',fontSize:'13px'}}>Nessun dato disponibile nella tabella</td></tr>
            ) : storicoPaginate.map((s:any,i:number)=>(
              <tr key={i} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{s.data}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a'}}>{s.descrizione}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a'}}>€ {s.importo}</td>
                <td style={{padding:'9px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {s.totale}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
          <span style={{fontSize:'12px',color:'#666'}}>{storicofiltrato.length===0?0:((paginaCorr-1)*perPage+1)}-{Math.min(paginaCorr*perPage,storicofiltrato.length)} di {storicofiltrato.length}</span>
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(
              <span key={n} style={{display:'flex',alignItems:'center'}}>
                {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>…</span>}
                <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
              </span>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
          </div>
        </div>
        <div style={{padding:'10px 14px',borderTop:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'12px',color:'#1a1a1a'}}>
          <span>Risultati da 0 a 0 di 0 elementi</span>
          <div style={{display:'flex',gap:'6px'}}>
            <button style={{padding:'4px 12px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Precedente</button>
            <button style={{padding:'4px 12px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}