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
    if (j.success) { router.push('/dashboard/impostazioni/staff') }
    else { setMsg('Errore: ' + (j.error || 'creazione fallita')) }
  }

  const lbl = { fontWeight:'700', color:'#1a1a1a', fontSize:'14px', width:'80px', flexShrink:0 } as const
  const inp = { flex:1, padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:'6px', fontSize:'14px', color:'#1a1a1a' } as const

  return (
    <div style={{ maxWidth:'620px', margin:'0 auto' }}>
      <div style={{ borderTop:'3px solid #2563eb', background:'#fff', borderRadius:'8px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', padding:'28px' }}>
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

          <p style={{ color:'#15803d', fontSize:'13px', marginBottom:'14px' }}>L&apos;email deve essere un indirizzo e-mail valido, indirizzo al quale verrà inviata una e-mail per impostare la propria password.</p>

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