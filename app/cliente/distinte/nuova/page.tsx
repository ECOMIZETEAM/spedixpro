'use client'
import { useState, useEffect } from 'react'
export default function CreaDistintaCliente() {
  const [tutte, setTutte] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [corriereId, setCorriereId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [cerca, setCerca] = useState('')
  const [creando, setCreando] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch('/api/cliente/distinte/aperte').then(r=>r.json()).then(d=>{setTutte(Array.isArray(d)?d:[]);setLoading(false)}).catch(()=>setLoading(false))
  }, [])
  const corrieri = Array.from(new Map(tutte.map(s=>[s.corriere_id, (s.corrieri?.nome_contratto)||'Contratto'])).entries()).map(([id,nome])=>({id,nome}))
  const visibili = tutte.filter(s => corriereId && s.corriere_id===corriereId).filter(s =>
    !cerca || s.numero?.toLowerCase().includes(cerca.toLowerCase()) || s.dest_nome?.toLowerCase().includes(cerca.toLowerCase())
  )
  const toggle = (id:string)=>setSelected(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const toggleAll = ()=>{ if(selected.length===visibili.length) setSelected([]); else setSelected(visibili.map(s=>s.id)) }
  const seleziona = (n:number)=>setSelected(visibili.slice(0,n).map(s=>s.id))
  async function creaDistinta(){
    if(!corriereId){setMsg('Seleziona un contratto');return}
    if(!selected.length){setMsg('Seleziona almeno una spedizione');return}
    setCreando(true); setMsg('')
    const res = await fetch('/api/cliente/distinte/crea',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spedizioniIds:selected,corriereId})})
    const d = await res.json()
    setCreando(false)
    if(d.error){setMsg('Errore: '+d.error);return}
    setMsg('Distinta '+d.numero+' creata con '+d.totali.spedizioni+' spedizioni')
    setTutte(prev=>prev.filter(s=>!selected.includes(s.id)))
    setSelected([])
  }
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const th = {textAlign:'left' as const,padding:'10px 14px',fontSize:'11px',fontWeight:'700' as const,color:'#1a1a1a',borderBottom:'1px solid #e8e8e8',whiteSpace:'nowrap' as const}
  const td = {padding:'10px 14px',fontSize:'12px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5'}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Crea Distinta <span style={{fontSize:'13px',color:'#999',fontWeight:'400'}}>({tutte.filter(s=>!corriereId||s.corriere_id===corriereId).length} spedizioni in attesa di chiusura)</span></h1>
      </div>
      <div style={card}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Filtri</div>
        <div style={{padding:'16px',display:'grid',gridTemplateColumns:'1fr',gap:'12px',maxWidth:'400px'}}>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Contratto</label>
            <select value={corriereId} onChange={e=>{setCorriereId(e.target.value);setSelected([])}} style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a'}}>
              <option value="">— Seleziona contratto —</option>
              {corrieri.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div style={card}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={()=>seleziona(20)} style={{padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Seleziona 20</button>
          <button onClick={()=>seleziona(50)} style={{padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Seleziona 50</button>
          <button onClick={()=>seleziona(100)} style={{padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Seleziona 100</button>
          <input value={cerca} onChange={e=>setCerca(e.target.value)} placeholder="Cerca..." style={{marginLeft:'auto',padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a'}}/>
          <button onClick={creaDistinta} disabled={creando} style={{padding:'8px 18px',border:'none',borderRadius:'6px',background:'#1a1a1a',color:'#fff',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:creando?0.6:1}}>{creando?'Creazione...':'Crea Distinta'}</button>
        </div>
        {msg && <div style={{padding:'10px 16px',fontSize:'13px',color:msg.startsWith('Errore')?'#dc2626':'#16a34a',background:msg.startsWith('Errore')?'#fef2f2':'#f0fdf4'}}>{msg}</div>}
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento...</div>
        ) : !corriereId ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Seleziona un contratto per vedere le spedizioni</div>
        ) : !visibili.length ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna spedizione in attesa per questo contratto</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={th}><input type="checkbox" checked={selected.length===visibili.length&&visibili.length>0} onChange={toggleAll}/></th>
                  <th style={th}>N. Spedizione</th>
                  <th style={th}>Destinatario</th>
                  <th style={th}>Città</th>
                  <th style={th}>CAP</th>
                  <th style={th}>Prov.</th>
                  <th style={th}>Peso</th>
                  <th style={th}>Colli</th>
                  <th style={th}>Data</th>
                  <th style={th}>ID Ordine</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map(s=>(
                  <tr key={s.id} style={{background:selected.includes(s.id)?'#fff7ed':'#fff'}}>
                    <td style={td}><input type="checkbox" checked={selected.includes(s.id)} onChange={()=>toggle(s.id)}/></td>
                    <td style={{...td,color:'#2563eb',fontWeight:'600'}}>{s.numero||'—'}</td>
                    <td style={td}>{s.dest_nome}</td>
                    <td style={td}>{s.dest_citta}</td>
                    <td style={td}>{s.dest_cap}</td>
                    <td style={td}>{s.dest_provincia}</td>
                    <td style={td}>{s.peso_fatturato||s.peso_reale||'—'}</td>
                    <td style={td}>{s.colli||1}</td>
                    <td style={td}>{new Date(s.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{s.note||''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}