'use client'
import { useState, useEffect } from 'react'

export default function SpedizioniCancellatePage() {
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
        s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase()))
    : spedizioni

  const totalePagine = Math.max(1, Math.ceil(visibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const visibiliPaginate = visibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <a href="/dashboard/spedizioni" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>{'\u2190'} Lista Spedizioni</a>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Spedizioni Cancellate</h1>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>{'\uD83D\uDDD1\uFE0F'} Cancellate <span style={{color:'#666',fontWeight:'400',fontSize:'12px'}}>({visibili.length})</span></span>
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
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'600'}}>Cerca:</span>
            <input value={cerca} onChange={e=>{setCerca(e.target.value);setPagina(1)}} placeholder="N. spedizione, cliente o destinatario..."
              style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'260px',color:'#1a1a1a',background:'#fff'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'36px',marginBottom:'12px'}}>{'\uD83D\uDDD1\uFE0F'}</div>
            <div style={{fontWeight:'500'}}>Nessuna spedizione cancellata</div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  {['N. Spedizione','Cliente','Destinatario','Citta','CAP','Peso','Colli','Data','Totale'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase',letterSpacing:'0.4px',color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibiliPaginate.map(s => (
                  <tr key={s.id} style={{borderBottom:'1px solid #eee'}}>
                    <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.clienti?.ragione_sociale || '-'}</td>
                    <td style={{padding:'9px 12px'}}>
                      <div style={{color:'#1a1a1a',fontWeight:'500'}}>{s.dest_nome}</div>
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_citta} {s.dest_provincia && `(${s.dest_provincia})`}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_cap}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.peso_reale}kg</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.colli}</td>
                    <td style={{padding:'9px 12px',color:'#666',fontSize:'12px',whiteSpace:'nowrap'}}>{new Date(s.updated_at || s.created_at).toLocaleDateString('it-IT')} {new Date(s.updated_at || s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>{'\u20AC'} {Number(s.costo_totale||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalePagine > 1 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
                <span style={{fontSize:'12px',color:'#666'}}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, visibili.length)} di {visibili.length}</span>
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
        )}
      </div>
    </div>
  )
}