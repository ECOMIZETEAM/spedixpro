'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}

export default function RitiriPage() {
  const [ritiri, setRitiri] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pagina, setPagina] = useState(1)
  const [perPagina, setPerPagina] = useState(10)
  const [filtri, setFiltri] = useState({
    clienteId: '', vettore: '', codRitiro: '',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    carica()
  }, [])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.vettore) params.set('vettore', filtri.vettore)
    if (filtri.codRitiro) params.set('codRitiro', filtri.codRitiro)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch('/api/ritiri?' + params.toString())
    const data = await res.json()
    setRitiri(Array.isArray(data) ? data : [])
    setPagina(1)
    setLoading(false)
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  const filtrati = cerca
    ? ritiri.filter(r =>
        r.cod_ritiro?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.mitt_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase())
      )
    : ritiri

  const totalePagine = Math.max(1, Math.ceil(filtrati.length / perPagina))
  const paginati = filtrati.slice((pagina-1)*perPagina, pagina*perPagina)

  function toggleSelect(id:string) { setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]) }
  function toggleAll() { if (selectedIds.length===paginati.length) setSelectedIds([]); else setSelectedIds(paginati.map(r=>r.id)) }

  return (
    <div>
      <div style={{marginBottom:'16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Lista Ritiri</h1>
        <a href="/cliente/ritiri/nuovo"
          style={{padding:'8px 18px',background:'#f97316',color:'#fff',borderRadius:'6px',fontSize:'13px',fontWeight:'700',textDecoration:'none'}}>
          + Nuovo Ritiro
        </a>
      </div>

      {/* Filtri */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>▼ Filtri</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:'12px',alignItems:'end'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Cliente</div>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Vettore</div>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option>
              <option value="gls">GLS</option>
              <option value="brt">BRT</option>
              <option value="poste">Poste Italiane</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Data:</div>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>COD Ritiro</div>
            <input value={filtri.codRitiro} onChange={e=>setF('codRitiro',e.target.value)}
              style={{...inp,width:'100%',boxSizing:'border-box' as const}} placeholder="es. CP123..."/>
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
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📋 Ritiri</span>
        </div>
        <div style={{padding:'8px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
            <select value={perPagina} onChange={e=>{setPerPagina(Number(e.target.value));setPagina(1)}} style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a'}}>
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
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
        ) : !paginati.length ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>
            <div style={{fontSize:'32px',marginBottom:'8px'}}>🚚</div>
            Nessun ritiro trovato
          </div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={{padding:'9px 12px',borderBottom:'1px solid #d1d5db',width:'36px'}}>
                  <input type="checkbox" checked={selectedIds.length===paginati.length&&paginati.length>0} onChange={toggleAll}/>
                </th>
                {['Cod Ritiro','Pagamento','Cliente','Mittente','Destinatario','Peso','Colli','Data Inserimento','Data Ritiro','Totale'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {paginati.map((r:any)=>(
                  <tr key={r.id} style={{borderBottom:'1px solid #d1d5db',background:selectedIds.includes(r.id)?'#fff7ed':'#fff'}}>
                    <td style={{padding:'9px 12px'}}>
                      <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={()=>toggleSelect(r.id)}/>
                    </td>
                    <td style={{padding:'9px 12px'}}>
                      <a href={'/cliente/ritiri/'+r.id}
                        style={{color:'#2563eb',fontWeight:'600',fontSize:'12px',textDecoration:'none'}}>
                        {r.cod_ritiro||'—'}
                      </a>
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{r.pagamento||'Porto franco'}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontWeight:'500',fontSize:'12px'}}>{r.clienti?.ragione_sociale||'—'}</td>
                    <td style={{padding:'9px 12px',fontSize:'12px'}}>
                      <div style={{fontWeight:'600',color:'#1a1a1a'}}>{r.mitt_nome||'—'}</div>
                      <div style={{color:'#1a1a1a',fontSize:'11px'}}>{r.mitt_citta}</div>
                      <div style={{color:'#1a1a1a',fontSize:'11px'}}>{r.mitt_telefono}</div>
                    </td>
                    <td style={{padding:'9px 12px',fontSize:'12px'}}>
                      <div style={{fontWeight:'600',color:'#1a1a1a'}}>{r.dest_nome||'—'}</div>
                      <div style={{color:'#1a1a1a',fontSize:'11px'}}>{r.dest_citta}</div>
                      <div style={{color:'#1a1a1a',fontSize:'11px'}}>{r.dest_telefono}</div>
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{r.peso}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{r.colli}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>
                      {new Date(r.created_at).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>
                      {r.data_ritiro ? new Date(r.data_ritiro).toLocaleDateString('it-IT') : '—'}
                    </td>
                    <td style={{padding:'9px 12px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(r.totale||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginazione */}
        <div style={{padding:'10px 16px',borderTop:'1px solid #d1d5db',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px',color:'#1a1a1a'}}>
          <span>Risultati da {filtrati.length===0?0:(pagina-1)*perPagina+1} a {Math.min(pagina*perPagina,filtrati.length)} di {filtrati.length} elementi</span>
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
            {totalePagine>8&&<span style={{padding:'0 4px'}}>...</span>}
            {totalePagine>8&&(
              <button onClick={()=>setPagina(totalePagine)}
                style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',background:pagina===totalePagine?'#f97316':'#fff',color:pagina===totalePagine?'#fff':'#374151',fontSize:'12px',cursor:'pointer'}}>
                {totalePagine}
              </button>
            )}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={pagina>=totalePagine||totalePagine===0}
              style={{padding:'4px 10px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:pagina>=totalePagine?'not-allowed':'pointer',color:pagina>=totalePagine?'#999':'#374151'}}>
              Successivo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}