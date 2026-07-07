'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'20px',maxWidth:'560px',marginBottom:'16px'}

export default function ModificaMasterPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [m, setM] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [msg, setMsg] = useState('')
  const [nuovaEmail, setNuovaEmail] = useState('')
  const [nuovaPassword, setNuovaPassword] = useState('')
  const [passwordMostrata, setPasswordMostrata] = useState('')

  useEffect(() => {
    fetch(`/api/master/${id}`).then(r=>r.json()).then(d=>{
      if (d.error) { setErrore(d.error); setLoading(false); return }
      setM(d); setLoading(false)
    }).catch(()=>{ setErrore('Errore caricamento'); setLoading(false) })
  }, [id])

  async function salva() {
    setSaving(true); setErrore(''); setMsg(''); setPasswordMostrata('')
    const body: any = {
      nome: m.nome, telefono: m.telefono, piva: m.piva, tipo_contratto: m.tipo_contratto,
    }
    if (nuovaEmail.trim()) body.nuova_email = nuovaEmail.trim()
    if (nuovaPassword.trim()) body.nuova_password = nuovaPassword.trim()
    const res = await fetch(`/api/master/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    const d = await res.json(); setSaving(false)
    if (d.error) { setErrore(d.error); return }
    setMsg('✓ Modifiche salvate')
    if (d.password) setPasswordMostrata(d.password)
    if (nuovaEmail.trim()) { setM({...m, login_email: nuovaEmail.trim(), email: nuovaEmail.trim()}); setNuovaEmail('') }
    setNuovaPassword('')
  }

  function generaPwd() {
    const c='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    setNuovaPassword('Mv'+Array.from({length:8},()=>c[Math.floor(Math.random()*c.length)]).join(''))
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#666'}}>Caricamento...</div>
  if (!m) return <div style={{padding:'40px'}}><div style={{...card,color:'#dc2626'}}>{errore||'Master non trovato'}</div></div>

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Modifica Master — {m.nome}</h1>
      </div>
      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
      {msg && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>{msg}</div>}

      {/* Anagrafica */}
      <div style={card}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'14px'}}>Anagrafica</div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>Nome / Ragione sociale</label>
          <input style={inp} value={m.nome||''} onChange={e=>setM({...m,nome:e.target.value})}/></div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>Telefono</label>
          <input style={inp} value={m.telefono||''} onChange={e=>setM({...m,telefono:e.target.value})}/></div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>P.IVA</label>
          <input style={inp} value={m.piva||''} onChange={e=>setM({...m,piva:e.target.value})}/></div>
        <div><label style={lbl}>Tipo contratto</label>
          <select style={inp} value={m.tipo_contratto||'credito_scalare'} onChange={e=>setM({...m,tipo_contratto:e.target.value})}>
            <option value="credito_scalare">Credito a scalare</option>
            <option value="fattura_mensile">Fattura mensile</option>
          </select></div>
      </div>

      {/* Accesso */}
      <div style={card}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'14px'}}>Accesso</div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>Email di login attuale</label>
          <input style={{...inp,background:'#f9fafb',color:'#666'}} value={m.login_email||''} disabled/></div>
        <div style={{marginBottom:'16px'}}><label style={lbl}>Nuova email (lascia vuoto per non cambiare)</label>
          <input style={inp} type="email" placeholder="nuova@email.it" value={nuovaEmail} onChange={e=>setNuovaEmail(e.target.value)}/></div>
        <div><label style={lbl}>Nuova password (lascia vuoto per non cambiare)</label>
          <div style={{display:'flex',gap:'8px'}}>
            <input style={inp} value={nuovaPassword} onChange={e=>setNuovaPassword(e.target.value)} placeholder="min 8 caratteri"/>
            <button onClick={generaPwd} type="button" style={{background:'#fff7ed',color:'#f97316',border:'1px solid #fed7aa',borderRadius:'6px',padding:'0 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Genera</button>
          </div>
        </div>
        {passwordMostrata && (
          <div style={{marginTop:'12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',padding:'12px'}}>
            <div style={{fontSize:'12px',fontWeight:700,color:'#16a34a',marginBottom:'6px'}}>✓ Password impostata — copiala e condividila</div>
            <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
              <code style={{flex:1,fontFamily:'monospace',fontSize:'15px',fontWeight:700,color:'#f97316'}}>{passwordMostrata}</code>
              <button onClick={()=>navigator.clipboard?.writeText(passwordMostrata)} style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>Copia</button>
            </div>
          </div>
        )}
      </div>

      <div style={{display:'flex',gap:'8px',maxWidth:'560px'}}>
        <button onClick={salva} disabled={saving}
          style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'10px 20px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:saving?0.6:1}}>
          {saving?'Salvo...':'Salva modifiche'}</button>
        <button onClick={()=>router.push('/dashboard/clienti/master')}
          style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'6px',padding:'10px 20px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Indietro</button>
      </div>
    </div>
  )
}
