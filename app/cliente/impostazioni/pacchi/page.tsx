'use client'
import { useState, useEffect } from 'react'
export default function PacchiCliente() {
  const [pacchi, setPacchi] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [edit, setEdit] = useState<any>(null)
  const [nome, setNome] = useState('')
  const [peso, setPeso] = useState('')
  const [lung, setLung] = useState('')
  const [larg, setLarg] = useState('')
  const [alt, setAlt] = useState('')
  const [pred, setPred] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { carica() }, [])
  function carica() {
    setLoading(true)
    fetch('/api/cliente/pacchi').then(r=>r.json()).then(d=>{setPacchi(Array.isArray(d)?d:[]);setLoading(false)}).catch(()=>setLoading(false))
  }
  function apri(p:any) {
    if (p) { setEdit(p); setNome(p.nome); setPeso(String(p.peso)); setLung(String(p.lunghezza)); setLarg(String(p.larghezza)); setAlt(String(p.altezza)); setPred(p.predefinito) }
    else { setEdit(null); setNome(''); setPeso(''); setLung(''); setLarg(''); setAlt(''); setPred(false) }
    setModal(true)
  }
  async function salva() {
    if (!nome) { alert('Inserisci un nome'); return }
    setSaving(true)
    const body:any = { nome, peso, lunghezza:lung, larghezza:larg, altezza:alt, predefinito:pred }
    if (edit) body.id = edit.id
    const res = await fetch('/api/cliente/pacchi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
    const d = await res.json()
    setSaving(false)
    if (d.error) { alert('Errore: '+d.error); return }
    setModal(false); carica()
  }
  async function elimina(id:string) {
    if (!confirm('Eliminare questo pacco?')) return
    await fetch('/api/cliente/pacchi?id='+id, { method:'DELETE' })
    carica()
  }
  const th = {textAlign:'left' as const,padding:'12px 14px',fontSize:'12px',fontWeight:'700' as const,color:'#1a1a1a',borderBottom:'1px solid #e8e8e8'}
  const td = {padding:'12px 14px',fontSize:'13px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5'}
  return (
    <div>
      <h1 style={{fontSize:'22px',fontWeight:'400',color:'#1a1a1a',margin:'0 0 20px'}}>Lista pacchi predefiniti</h1>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'16px',display:'flex',justifyContent:'flex-end'}}>
          <button onClick={()=>apri(null)} style={{background:'#2563eb',color:'#fff',border:'none',padding:'9px 16px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>🔗 Aggiungi pacco (peso/misure)</button>
        </div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento...</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={th}>Nome</th><th style={th}>Peso (Kg)</th><th style={th}>Misure (cm)</th><th style={th}>Predefinito</th><th style={th}>Menu</th>
              </tr>
            </thead>
            <tbody>
              {!pacchi.length ? (
                <tr><td colSpan={5} style={{padding:'30px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessun pacco predefinito. Aggiungine uno.</td></tr>
              ) : pacchi.map(p=>(
                <tr key={p.id}>
                  <td style={{...td,color:'#2563eb'}}>{p.nome}</td>
                  <td style={{...td,color:'#2563eb'}}>{Number(p.peso).toFixed(2)}</td>
                  <td style={{...td,color:'#2563eb'}}>{p.lunghezza} X {p.larghezza} X {p.altezza}</td>
                  <td style={td}>{p.predefinito ? '★' : '☆'}</td>
                  <td style={td}>
                    <button onClick={()=>elimina(p.id)} style={{background:'#dc2626',color:'#fff',border:'none',padding:'6px 10px',borderRadius:'6px',cursor:'pointer',marginRight:'8px'}}>🗑</button>
                    <button onClick={()=>apri(p)} style={{background:'transparent',color:'#2563eb',border:'none',cursor:'pointer',fontSize:'13px'}}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>setModal(false)}>
          <div style={{background:'#fff',borderRadius:'10px',padding:'24px',width:'420px',maxWidth:'90%'}} onClick={e=>e.stopPropagation()}>
            <h2 style={{fontSize:'17px',fontWeight:'700',color:'#1a1a1a',margin:'0 0 16px'}}>{edit?'Modifica pacco':'Aggiungi pacco'}</h2>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              <div><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Nome</label><input value={nome} onChange={e=>setNome(e.target.value)} style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/></div>
              <div><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Peso (Kg)</label><input type="number" step="0.01" value={peso} onChange={e=>setPeso(e.target.value)} style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
                <div><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Lungh. (cm)</label><input type="number" value={lung} onChange={e=>setLung(e.target.value)} style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/></div>
                <div><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Largh. (cm)</label><input type="number" value={larg} onChange={e=>setLarg(e.target.value)} style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/></div>
                <div><label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Alt. (cm)</label><input type="number" value={alt} onChange={e=>setAlt(e.target.value)} style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/></div>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
                <input type="checkbox" checked={pred} onChange={e=>setPred(e.target.checked)}/> Imposta come predefinito
              </label>
            </div>
            <div style={{display:'flex',gap:'10px',marginTop:'20px',justifyContent:'flex-end'}}>
              <button onClick={()=>setModal(false)} style={{padding:'9px 18px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',cursor:'pointer',fontSize:'13px',color:'#1a1a1a'}}>Annulla</button>
              <button onClick={salva} disabled={saving} style={{padding:'9px 18px',border:'none',borderRadius:'6px',background:'#2563eb',color:'#fff',cursor:'pointer',fontSize:'13px',fontWeight:'600',opacity:saving?0.6:1}}>{saving?'Salvataggio...':'Salva'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}