'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CreaAccount() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [ruolo, setRuolo] = useState('admin')
  const [email, setEmail] = useState('')
  const [confEmail, setConfEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [cred, setCred] = useState<any>(null)

  async function salva() {
    if (!nome.trim()) { setMsg('Inserisci il nome'); return }
    if (!email.trim()) { setMsg('Inserisci l\'email'); return }
    if (email.trim() !== confEmail.trim()) { setMsg('Le email non coincidono'); return }
    setSalvando(true); setMsg('')
    const r = await fetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, ruolo, email })
    })
    const j = await r.json()
    setSalvando(false)
    if (j.success) { setCred({ email: j.email, password: j.password }) }
    else { setMsg('Errore: ' + (j.error || 'creazione fallita')) }
  }

  if (cred) return (
    <div style={{maxWidth:'560px',margin:'40px auto'}}>
      <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'24px'}}>
        <div style={{fontSize:'16px',fontWeight:800,color:'#16a34a',marginBottom:'6px'}}>✓ Collaboratore creato</div>
        <p style={{fontSize:'13px',color:'#555',margin:'0 0 16px'}}>Condividi queste credenziali con il collaboratore (le email automatiche partiranno quando il dominio sarà verificato). Potrà accedere insieme a te, con il suo login.</p>
        <div style={{background:'#fff',border:'1px solid #d1fae5',borderRadius:'8px',padding:'14px'}}>
          <div style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Email</div>
          <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px',fontFamily:'monospace'}}>{cred.email}</div>
          <div style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Password</div>
          <div style={{fontSize:'16px',fontWeight:700,color:'#f97316',fontFamily:'monospace'}}>{cred.password}</div>
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
          <button onClick={()=>navigator.clipboard?.writeText(`Email: ${cred.email}\nPassword: ${cred.password}\nPortale: https://moovexpress.com`)}
            style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Copia credenziali</button>
          <button onClick={()=>router.push('/dashboard/impostazioni/staff')}
            style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Vai allo staff</button>
        </div>
      </div>
    </div>
  )

  const lbl = { fontWeight:'700', color:'#1a1a1a', fontSize:'14px', width:'80px', flexShrink:0 } as const
  const inp = { flex:1, padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:'6px', fontSize:'14px', color:'#1a1a1a' } as const

  return (
    <div style={{ maxWidth:'620px', margin:'0 auto' }}>
      <div style={{ borderTop:'3px solid #f97316', background:'#fff', borderRadius:'8px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', padding:'28px' }}>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:'20px' }}>
          <div style={{ width:'90px', height:'90px', borderRadius:'50%', background:'#e0f2fe', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'44px' }}>👤</div>
        </div>
        <div style={{ borderTop:'1px solid #eee', paddingTop:'22px' }}>
          {msg && <div style={{ marginBottom:'16px', padding:'10px 14px', borderRadius:'6px', fontSize:'13px', background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca' }}>{msg}</div>}

          <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'18px' }}>
            <label style={lbl}>Nome</label>
            <input value={nome} onChange={e=>setNome(e.target.value)} style={inp} />
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'22px' }}>
            <label style={lbl}>Ruolo</label>
            <select value={ruolo} onChange={e=>setRuolo(e.target.value)} style={{ ...inp, cursor:'pointer' }}>
              <option value="admin">admin</option>
              <option value="operatore">operatore</option>
              <option value="agente">agente</option>
            </select>
          </div>

          <p style={{ color:'#15803d', fontSize:'13px', marginBottom:'14px' }}>Dopo il salvataggio vedrai a schermo email e password del collaboratore, da condividere con lui. Potrà accedere con il suo login insieme a te (senza espellervi a vicenda).</p>

          <div style={{ display:'flex', gap:'12px', marginBottom:'8px' }}>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={inp} />
            <input value={confEmail} onChange={e=>setConfEmail(e.target.value)} placeholder="Conferma Email" style={inp} />
          </div>
        </div>
      </div>
      <button onClick={salva} disabled={salvando} style={{ width:'100%', marginTop:'16px', padding:'12px', background:'#3b82c4', color:'#fff', border:'none', borderRadius:'6px', fontSize:'15px', fontWeight:'700', cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvataggio...' : 'Salva'}</button>
    </div>
  )
}