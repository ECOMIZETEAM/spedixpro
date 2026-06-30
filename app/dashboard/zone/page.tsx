'use client'
import { useState, useEffect } from 'react'

export default function ZonePage() {
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [zone, setZone] = useState<any[]>([])
  const [tab, setTab] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalNuova, setModalNuova] = useState(false)
  const [modalModifica, setModalModifica] = useState<any>(null)
  const [modalSposta, setModalSposta] = useState<any>(null)
  const [formNuova, setFormNuova] = useState({nome:'',descrizione:'',con_fuel:false})
  const [formMod, setFormMod] = useState({nome:'',descrizione:'',con_fuel:false})
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const c = await fetch('/api/corrieri/lista').then(r=>r.json()).catch(()=>[])
    const z = await fetch('/api/zone').then(r=>r.json()).catch(()=>[])
    setCorrieri(Array.isArray(c)?c:[])
    setZone(Array.isArray(z)?z:[])
    if(Array.isArray(c)&&c.length) setTab(c[0].id)
    setLoading(false)
  }

  const zoneTab = zone.filter(z=>z.corriere_id===tab)
  const corrTab = corrieri.find(c=>c.id===tab)

  async function salvaZona() {
    setSaving(true)
    await fetch('/api/zone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...formNuova,corriereId:tab})})
    setFormNuova({nome:'',descrizione:'',con_fuel:false}); setModalNuova(false); setSaving(false); load()
  }

  async function salvaMod() {
    setSaving(true)
    await fetch('/api/zone/'+modalModifica.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(formMod)})
    setModalModifica(null); setSaving(false); load()
  }

  async function elimina(id:string,nome:string) {
    if(!confirm('Eliminare "'+nome+'"?')) return
    await fetch('/api/zone/'+id,{method:'DELETE'}); load()
  }

  async function sposta(zonaId:string,corrId:string) {
    await fetch('/api/zone/'+zonaId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({corriere_id:corrId})})
    setModalSposta(null); load()
  }

  function esporta(z:any) {
    const csv='nome,descrizione,con_fuel\n'+`"${z.nome}","${z.descrizione||''}",${z.con_fuel||false}`
    const a=document.createElement('a')
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download=`zona_${z.nome}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const inp={padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box' as const}
  const tbtn=(id:string)=>({padding:'8px 16px',background:'none',border:'none',cursor:'pointer',fontSize:'13px',fontWeight:tab===id?'700' as const:'400' as const,color:tab===id?'#f97316':'#1a1a1a',borderBottom:tab===id?'2px solid #f97316':'2px solid transparent',whiteSpace:'nowrap' as const})
  const ibtn=(bg:string,color:string,border:string)=>({width:'28px',height:'28px',background:bg,color,border:`1px solid ${border}`,borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'inline-flex' as const,alignItems:'center' as const,justifyContent:'center' as const})

  if(loading) return <div style={{padding:'40px',textAlign:'center' as const,color:'#666'}}>Caricamento...</div>


  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Gestione Zone</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 16px',overflowX:'auto' as const}}>
          {corrieri.map(c=><button key={c.id} style={tbtn(c.id)} onClick={()=>setTab(c.id)}>{c.nome_contratto}</button>)}
        </div>
        {tab && (
          <div style={{padding:'16px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px'}}>
              <div style={{width:'60px',height:'36px',background:'#f97316',borderRadius:'4px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'#fff'}}>{corrTab?.tipo?.toUpperCase()||'CORR'}</div>
              <span style={{fontSize:'16px',fontWeight:'700',color:'#1a1a1a'}}>{corrTab?.nome_contratto}</span>
            </div>
            <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
              <button onClick={()=>setModalNuova(true)} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>+Aggiungi zona</button>
              <button onClick={load} style={{padding:'6px 14px',background:'#fff',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>🔄 Sync Zones</button>
            </div>
            {!zoneTab.length ? (
              <div style={{padding:'40px',textAlign:'center' as const,color:'#666',fontSize:'13px'}}>Nessuna zona configurata</div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
                <thead><tr>
                  {['Nome','Opzioni','Paese (Pr) CAP Città','Modifica/Esporta/Importa/Sposta',''].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {zoneTab.map((z:any)=>(
                    <tr key={z.id} style={{borderBottom:'1px solid #e5e7eb'}}>
                      <td style={{padding:'10px 12px',fontWeight:'600',color:'#f97316'}}>{z.nome}</td>
                      <td style={{padding:'10px 12px'}}>
                        {z.con_fuel&&<span style={{background:'#f97316',color:'#fff',padding:'2px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'700'}}>Fuel</span>}
                      </td>
                      <td style={{padding:'10px 12px',color:'#1a1a1a',fontSize:'12px',maxWidth:'500px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{z.descrizione||'—'}</td>
                      <td style={{padding:'10px 12px'}}>
                        <div style={{display:'flex',gap:'4px'}}>
                          <button onClick={()=>{setModalModifica(z);setFormMod({nome:z.nome,descrizione:z.descrizione||'',con_fuel:z.con_fuel||false})}} style={ibtn('#16a34a','#fff','#86efac')}>✏️</button>
                          <button onClick={()=>esporta(z)} style={ibtn('#fff','#1a1a1a','#d1d5db')}>⬇</button>
                          <label style={{...ibtn('#fff','#1a1a1a','#d1d5db'),cursor:'pointer'}}>
                            ⬆<input type="file" accept=".csv" style={{display:'none'}} onChange={async e=>{
                              const f=e.target.files?.[0];if(!f)return
                              const t=await f.text();const l=t.split('\n')[1]
                              if(l){const cols=l.split(',');await fetch('/api/zone/'+z.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({descrizione:cols[1]?.replace(/"/g,'')})});load()}
                            }}/>
                          </label>
                          <button onClick={()=>setModalSposta(z)} style={ibtn('#fff','#1a1a1a','#d1d5db')}>↪</button>
                        </div>
                      </td>
                      <td style={{padding:'10px 8px'}}>
                        <button onClick={()=>elimina(z.id,z.nome)} style={{background:'none',border:'none',color:'#dc2626',fontSize:'16px',cursor:'pointer'}}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {modalNuova&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModalNuova(false)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'500px'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Aggiungi Zona</span>
              <button onClick={()=>setModalNuova(false)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome</label><input value={formNuova.nome} onChange={e=>setFormNuova(f=>({...f,nome:e.target.value}))} style={inp} placeholder="es. SARDEGNA"/></div>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Descrizione</label><textarea value={formNuova.descrizione} onChange={e=>setFormNuova(f=>({...f,descrizione:e.target.value}))} rows={4} style={{...inp,resize:'vertical' as const}} placeholder="es. IT (CA) ** · IT (CI) ** ..."/></div>
              <div style={{marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}><input type="checkbox" checked={formNuova.con_fuel} onChange={e=>setFormNuova(f=>({...f,con_fuel:e.target.checked}))} id="fn"/><label htmlFor="fn" style={{fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>Applica supplemento Fuel</label></div>
              <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                <button onClick={()=>setModalNuova(false)} style={{padding:'8px 16px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a'}}>Annulla</button>
                <button onClick={salvaZona} disabled={saving} style={{padding:'8px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>Aggiungi</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalModifica&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModalModifica(null)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'600px'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Modifica — {modalModifica.nome}</span>
              <button onClick={()=>setModalModifica(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome</label><input value={formMod.nome} onChange={e=>setFormMod(f=>({...f,nome:e.target.value}))} style={inp}/></div>
              <div style={{marginBottom:'12px'}}><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Descrizione</label><textarea value={formMod.descrizione} onChange={e=>setFormMod(f=>({...f,descrizione:e.target.value}))} rows={5} style={{...inp,resize:'vertical' as const}}/></div>
              <div style={{marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}><input type="checkbox" checked={formMod.con_fuel} onChange={e=>setFormMod(f=>({...f,con_fuel:e.target.checked}))} id="fm"/><label htmlFor="fm" style={{fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>Applica supplemento Fuel</label></div>
              <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                <button onClick={()=>setModalModifica(null)} style={{padding:'8px 16px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a'}}>Annulla</button>
                <button onClick={salvaMod} disabled={saving} style={{padding:'8px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>Salva</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalSposta&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModalSposta(null)}>
          <div style={{background:'#fff',borderRadius:'8px',width:'400px'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a'}}>Sposta — {modalSposta.nome}</span>
              <button onClick={()=>setModalSposta(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{display:'flex',flexDirection:'column' as const,gap:'8px'}}>
                {corrieri.filter(c=>c.id!==tab).map(c=>(
                  <button key={c.id} onClick={()=>sposta(modalSposta.id,c.id)} style={{padding:'10px 14px',background:'#f9fafb',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a',textAlign:'left' as const}}>{c.nome_contratto}</button>
                ))}
              </div>
              <button onClick={()=>setModalSposta(null)} style={{marginTop:'12px',padding:'8px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a',width:'100%'}}>Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}