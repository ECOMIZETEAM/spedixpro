'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const sec = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px',maxWidth:'560px'}
const sech = {padding:'12px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a'}
const secb = {padding:'16px',display:'flex' as const,flexDirection:'column' as const,gap:'12px'}

export default function ModificaStaffPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [msg, setMsg] = useState('')
  const [nome, setNome] = useState('')
  const [cognome, setCognome] = useState('')
  const [telefono, setTelefono] = useState('')
  const [ruolo, setRuolo] = useState('operatore')
  const [emailOrig, setEmailOrig] = useState('')
  const [email, setEmail] = useState('')
  const [resetPassword, setResetPassword] = useState(false)
  const [passwordMostrata, setPasswordMostrata] = useState('')
  const [listinoAgente, setListinoAgente] = useState('')
  const [listini, setListini] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/staff').then(r => r.json()).then((arr: any[]) => {
      const s = (Array.isArray(arr) ? arr : []).find(u => u.id === id)
      if (!s) { setErrore('Collaboratore non trovato'); setLoading(false); return }
      setNome(s.nome || ''); setCognome(s.cognome || ''); setTelefono(s.telefono || '')
      setRuolo((s.ruolo || 'operatore').toLowerCase()); setEmailOrig(s.email || ''); setEmail(s.email || '')
      setListinoAgente(s.listino_agente_id || '')
      setLoading(false)
    }).catch(() => { setErrore('Errore caricamento'); setLoading(false) })
    fetch('/api/listini/lista').then(r => r.json()).then((arr: any[]) => setListini(Array.isArray(arr) ? arr : [])).catch(() => {})
  }, [id])

  async function salva() {
    setSaving(true); setErrore(''); setMsg(''); setPasswordMostrata('')
    const body: any = { id, nome, cognome, telefono, ruolo, listino_agente_id: ruolo === 'agente' ? (listinoAgente || null) : null }
    if (email.trim() && email.trim().toLowerCase() !== emailOrig.trim().toLowerCase()) body.nuova_email = email.trim()
    if (resetPassword) body.resetPassword = true
    const res = await fetch('/api/staff', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json(); setSaving(false)
    if (d.error) { setErrore(d.error); return }
    setMsg(d.emailInviata ? 'Modifiche salvate — credenziali inviate via email' : 'Modifiche salvate')
    if (d.password) setPasswordMostrata(d.password)
    if (body.nuova_email) setEmailOrig(email.trim())
    setResetPassword(false)
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div>

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <a href="/dashboard/impostazioni/staff" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>← Staff</a>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:'4px 0 0'}}>Modifica collaboratore</h1>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>{errore}</div>}
      {msg && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>{msg}</div>}

      {/* Dati */}
      <div style={sec}>
        <div style={sech}>Dati collaboratore</div>
        <div style={secb}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={lbl}>Nome</label><input style={inp} value={nome} onChange={e=>setNome(e.target.value)}/></div>
            <div><label style={lbl}>Cognome</label><input style={inp} value={cognome} onChange={e=>setCognome(e.target.value)}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div><label style={lbl}>Telefono</label><input style={inp} value={telefono} onChange={e=>setTelefono(e.target.value)}/></div>
            <div><label style={lbl}>Ruolo</label>
              <select style={inp} value={ruolo} onChange={e=>setRuolo(e.target.value)}>
                <option value="admin">Admin</option>
                <option value="operatore">Operatore</option>
                <option value="agente">Agente</option>
              </select></div>
          </div>
          {ruolo === 'agente' && (
            <div>
              <label style={lbl}>Listino agente (il suo costo)</label>
              <select style={inp} value={listinoAgente} onChange={e=>setListinoAgente(e.target.value)}>
                <option value="">— nessuno —</option>
                {listini.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
              <div style={{fontSize:'11px',color:'#8a8a8a',marginTop:'4px'}}>L&apos;agente lo vede in sola lettura in &quot;Il mio listino&quot;. Il suo margine = prezzo cliente − questo costo.</div>
            </div>
          )}
        </div>
      </div>

      {/* Reset password — come cliente/master */}
      <div style={sec}>
        <div style={sech}>Reset password</div>
        <div style={secb}>
          <input style={inp} type="email" placeholder="email@esempio.it" value={email} onChange={e=>setEmail(e.target.value)}/>
          <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
            <input type="checkbox" checked={resetPassword} onChange={e=>setResetPassword(e.target.checked)} style={{width:'15px',height:'15px',accentColor:'#f97316'}}/>
            Resetta e invia nuova password
          </label>
          {email.trim() && email.trim().toLowerCase() !== emailOrig.trim().toLowerCase() && (
            <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px 12px',fontSize:'12px',color:'#ea580c',lineHeight:1.5}}>
              Cambierai l&apos;email di accesso: il collaboratore dovrà usare <b>{email}</b> per entrare.
            </div>
          )}
          {passwordMostrata && (
            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',padding:'12px'}}>
              <div style={{fontSize:'12px',fontWeight:700,color:'#16a34a',marginBottom:'6px'}}>Password impostata — copiala e condividila</div>
              <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                <code style={{flex:1,fontFamily:'monospace',fontSize:'15px',fontWeight:700,color:'#f97316'}}>{passwordMostrata}</code>
                <button onClick={()=>navigator.clipboard?.writeText(passwordMostrata)} style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>Copia</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{display:'flex',gap:'8px',maxWidth:'560px'}}>
        <button onClick={salva} disabled={saving}
          style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'10px 20px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:saving?0.6:1}}>
          {saving?'Salvo...':'Salva modifiche'}</button>
        <button onClick={()=>router.push('/dashboard/impostazioni/staff')}
          style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'6px',padding:'10px 20px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Indietro</button>
      </div>
    </div>
  )
}
