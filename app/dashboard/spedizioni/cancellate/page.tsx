'use client'
import { useState, useEffect } from 'react'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}

export default function SpedizioniCancellatePage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [pagina, setPagina] = useState(1)
  const perPagina = 10
  const [filtri, setFiltri] = useState({
    clienteId: '',
    dal: '',
    al: '',
    numero: ''
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
    carica()
  }, [])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.numero) params.set('numero', filtri.numero)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch('/api/spedizioni/cancellate?' + params.toString())
    const data = await res.json()
    setSpedizioni(Array.isArray(data) ? data : [])
    setPagina(1)
    setLoading(false)
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  const filtrate = cerca
    ? spedizioni.filter(s =>
        s.numero?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase())
      )
    : spedizioni

  const totalePagine = Math.ceil(filtrate.length / perPagina)
  const paginata = filtrate.slice((pagina-1)*perPagina, pagina*perPagina)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Spedizioni Cancellate</h1>
      </div>

      {/* Filtri */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>▼ Filtri</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:'12px',alignItems:'end'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Cliente</div>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Data Spedizione:</div>
            <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
              <input type="date" value={filtri.dal} onChange={e=>setF('dal',e.target.value)} style={inp}/>
              <span style={{color:'#1a1a1a'}}>—</span>
              <input type="date" value={filtri.al} onChange={e=>setF('al',e.target.value)} style={inp}/>
            </div>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>N. Spedizione</div>
            <input value={filtri.numero} onChange={e=>setF('numero',e.target.value)} style={{...inp,width:'100%',boxSizing:'border-box' as const}}/>
          </div>
          <div>
            <button onClick={carica}
              style={{padding:'7px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>
              Filtra
            </button>
          </div>
        </div>
      </div>

      {/* Tabella */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📋 Spedizioni Cancellate</span>
          <button style={{padding:'5px 10px',background:'#fff',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',cursor:'pointer'}}>📊</button>
        </div>
        <div style={{padding:'8px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
            <select style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px'}}>
              <option>10</option><option>25</option><option>50</option>
            </select>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>elementi</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>{setCerca(e.target.value);setPagina(1)}}
              style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',width:'180px',color:'#1a1a1a'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !paginata.length ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessuna spedizione cancellata trovata</div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                {['N. Spedizione','Cliente','Destinatario','Città','CAP','Pr','Peso','Colli','Contrassegno','Cancellata il','Cancellata da'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {paginata.map((s:any)=>(
                  <tr key={s.id} style={{borderBottom:'1px solid #d1d5db'}}>
                    <td style={{padding:'9px 12px',fontWeight:'600',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:s.clienti?.ragione_sociale?'#f97316':'#666',fontWeight:'500',fontSize:'12px'}}>{s.clienti?.ragione_sociale||s.mitt_nome}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.dest_nome}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.dest_citta}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.dest_cap}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.dest_provincia||'NA'}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.peso_reale}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.colli}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{Number(s.contrassegno||0).toFixed(4)}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>
                      {s.cancellata_il ? new Date(s.cancellata_il).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : new Date(s.updated_at||s.created_at).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.cancellata_da||s.mitt_email||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginazione */}
        <div style={{padding:'10px 16px',borderTop:'1px solid #d1d5db',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px',color:'#1a1a1a'}}>
          <span>Risultati da {filtrate.length===0?0:(pagina-1)*perPagina+1} a {Math.min(pagina*perPagina,filtrate.length)} di {filtrate.length} elementi</span>
          <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={pagina===1}
              style={{padding:'4px 10px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:pagina===1?'not-allowed':'pointer',color:pagina===1?'#999':'#374151'}}>
              Precedente
            </button>
            {Array.from({length:Math.min(totalePagine,8)},(_,i)=>i+1).map(n=>(
              <button key={n} onClick={()=>setPagina(n)}
                style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',background:pagina===n?'#f97316':'#fff',color:pagina===n?'#fff':'#374151',fontSize:'12px',cursor:'pointer',fontWeight:pagina===n?'700':'400'}}>
                {n}
              </button>
            ))}
            {totalePagine > 8 && <span style={{padding:'0 4px'}}>...</span>}
            {totalePagine > 8 && (
              <button onClick={()=>setPagina(totalePagine)}
                style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',background:pagina===totalePagine?'#f97316':'#fff',color:pagina===totalePagine?'#fff':'#374151',fontSize:'12px',cursor:'pointer'}}>
                {totalePagine}
              </button>
            )}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={pagina===totalePagine||totalePagine===0}
              style={{padding:'4px 10px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:pagina>=totalePagine?'not-allowed':'pointer',color:pagina>=totalePagine?'#999':'#374151'}}>
              Successivo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}