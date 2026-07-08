'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'auto'}

export default function StoriaPage() {
  const [movimenti, setMovimenti] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [clienteId, setClienteId] = useState('')
  const [dal, setDal] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
  const [al, setAl] = useState(() => new Date().toISOString().split('T')[0])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
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

  const totalePagine = Math.max(1, Math.ceil(movimenti.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const movimentiPaginati = movimenti.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Storia Consumabili</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{movimenti.length} movimenti trovati</p>
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
            <DateRangePicker dal={dal} al={al} onChange={(d1,d2)=>{setDal(d1);setAl(d2)}} />
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
        ) : (<>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#f9fafb'}}>
                {['Data','Cliente','Descrizione','Vettore','Q.tà','Prezzo Unit.','IVA','Totale'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movimentiPaginati.map((m:any) => (
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
            {/* barra-paginazione */}
            {totalePagine > 0 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
                <span style={{fontSize:'12px',color:'#666'}}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, movimenti.length)} di {movimenti.length}</span>
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
            )}
        </>)}
      </div>
    </div>
  )
}