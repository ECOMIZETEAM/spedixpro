'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}

const STATI_SPED: Record<string,{bg:string,color:string,label:string}> = {
  in_lavorazione:{bg:'#fffbeb',color:'#d97706',label:'In Lavorazione'},
  spedita:{bg:'#eff6ff',color:'#2563eb',label:'Spedita'},
  consegnata:{bg:'#f0fdf4',color:'#16a34a',label:'Consegnata'},
  in_transito:{bg:'#f0fdf4',color:'#16a34a',label:'In transito'},
  in_consegna:{bg:'#ecfdf5',color:'#059669',label:'In Consegna'},
}
const STATI_COD: Record<string,{bg:string,color:string,label:string}> = {
  in_attesa:{bg:'#fff7ed',color:'#ea580c',label:'In attesa'},
  in_distinta:{bg:'#fef9c3',color:'#ca8a04',label:'In distinta'},
  pagato:{bg:'#f0fdf4',color:'#16a34a',label:'Pagato'},
}

export default function ListaContrassegniPage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [cerca, setCerca] = useState('')
  const [creandoDistinta, setCreandoDistinta] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId:'', vettore:'', contratto:'', statoSpedizione:'', statoContrassegno:'',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
    carica()
  }, [])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.statoSpedizione) params.set('stato', filtri.statoSpedizione)
    if (filtri.statoContrassegno) params.set('statoContrassegno', filtri.statoContrassegno)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch('/api/contrassegni?' + params.toString())
    const data = await res.json()
    setSpedizioni(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))
  const visibili = cerca ? spedizioni.filter(s => s.numero?.toLowerCase().includes(cerca.toLowerCase()) || s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) || s.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase())) : spedizioni
  function toggleSelect(id:string) { setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]) }
  function toggleAll() { if (selectedIds.length===visibili.length) setSelectedIds([]); else setSelectedIds(visibili.map(s=>s.id)) }

  async function creaDistinta() {
    if (!selectedIds.length) return
    setCreandoDistinta(true)
    const res = await fetch('/api/contrassegni/distinte', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ spedizioneIds: selectedIds })
    })
    const data = await res.json()
    setCreandoDistinta(false)
    if (data.success) { setSelectedIds([]); carica(); alert('Distinte create: ' + data.distinte?.length) }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Lista contrassegni</h1></div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>▼ Filtri</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:'10px',marginBottom:'10px'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Cliente</div>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i Clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Vettore</div>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option><option value="gls">GLS</option><option value="brt">BRT</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Contratto</div>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Stato spedizioni</div>
            <select value={filtri.statoSpedizione} onChange={e=>setF('statoSpedizione',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="in_lavorazione">In Lavorazione</option>
              <option value="consegnata">Consegnata</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Stato contrassegni</div>
            <select value={filtri.statoContrassegno} onChange={e=>setF('statoContrassegno',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="in_attesa">In attesa</option>
              <option value="in_distinta">In distinta</option>
              <option value="pagato">Pagato</option>
            </select>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'10px',alignItems:'end'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Data Spedizione:</div>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:'8px'}}>
            <button onClick={carica} style={{padding:'7px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>▼ Filtra</button>
          </div>
        </div>
      </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'10px',marginBottom:'12px'}}>
        <button onClick={creaDistinta} disabled={creandoDistinta||selectedIds.length===0}
          style={{padding:'7px 16px',background:selectedIds.length>0?'#f97316':'#e5e7eb',color:selectedIds.length>0?'#fff':'#9ca3af',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
          {creandoDistinta ? 'Creazione...' : ('+ Crea Distinte' + (selectedIds.length>0 ? ' (' + selectedIds.length + ')' : ''))}
        </button>
        <button style={{padding:'7px 12px',background:'#fff',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>📊</button>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'10px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
            <select style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px'}}><option>50</option><option>100</option></select>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>elementi</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',width:'180px',color:'#1a1a1a'}}/>
          </div>
        </div>
        {loading ? (
          <div style={{padding:'60px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'60px',textAlign:'center' as const,color:'#1a1a1a'}}>
            <div style={{fontSize:'36px',marginBottom:'12px'}}>💰</div>
            <div style={{fontWeight:'500'}}>Nessun contrassegno trovato</div>
          </div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  <th style={{padding:'9px 12px',borderBottom:'1px solid #d1d5db',width:'36px'}}>
                    <input type="checkbox" checked={selectedIds.length===visibili.length&&visibili.length>0} onChange={toggleAll}/>
                  </th>
                  {['N. Spedizione','Mittente','Destinatario','Data Spedizione','Contrassegno','Allegati','Stato spedizione','N. Dist.','Stato contrassegno','Ultimo aggiornamento',''].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map(s => {
                  const stSped = STATI_SPED[s.stato] || {bg:'#f5f5f5',color:'#1a1a1a',label:s.stato}
                  const stCod = STATI_COD[s.stato_contrassegno||'in_attesa'] || STATI_COD['in_attesa']
                  const isSelected = selectedIds.includes(s.id)
                  return (
                    <tr key={s.id} style={{borderBottom:'1px solid #d1d5db',background:isSelected?'#fff7ed':'#fff'}}>
                      <td style={{padding:'9px 12px'}}><input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(s.id)}/></td>
                      <td style={{padding:'9px 12px'}}><span style={{color:'#f97316',fontWeight:'700'}}>{s.numero}</span></td>
                      <td style={{padding:'9px 12px',fontSize:'12px',fontWeight:'600',color:'#1a1a1a'}}>{s.clienti?.ragione_sociale||s.mitt_nome}</td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{fontWeight:'600',color:'#1a1a1a',fontSize:'12px'}}>{s.dest_nome}</div>
                        <div style={{color:'#1a1a1a',fontSize:'11px'}}>{s.dest_indirizzo}, {s.dest_citta}, {s.dest_cap}, {s.dest_provincia}</div>
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>{new Date(s.created_at).toLocaleDateString('it-IT')}</td>
                      <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>€ {Number(s.contrassegno).toFixed(2)}</td>
                      <td style={{padding:'9px 12px',textAlign:'center' as const}}><span style={{fontSize:'16px',cursor:'pointer'}}>📁</span></td>
                      <td style={{padding:'9px 12px'}}><span style={{background:stSped.bg,color:stSped.color,padding:'3px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>{stSped.label}</span></td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>—</td>
                      <td style={{padding:'9px 12px'}}><span style={{background:stCod.bg,color:stCod.color,padding:'3px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>{stCod.label}</span></td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(s.updated_at||s.created_at).toLocaleDateString('it-IT')}</td>
                      <td style={{padding:'9px 12px'}}><span style={{color:'#dc2626',fontSize:'16px',cursor:'pointer'}}>⊘</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{padding:'10px 16px',borderTop:'1px solid #d1d5db',fontSize:'12px',color:'#1a1a1a'}}>Risultati: {visibili.length} elementi</div>
      </div>
    </div>
  )
}