'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}

export default function NuovoMasterPage() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [piva, setPiva] = useState('')
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [successo, setSuccesso] = useState('')

  async function crea() {
    if (!nome.trim() || !email.trim()) { setErrore('Nome e email sono obbligatori'); return }
    setSaving(true); setErrore(''); setSuccesso('')

    const res = await fetch('/api/master/crea', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, telefono, piva })
    })
    const data = await res.json()
    setSaving(false)

    if (data.error) { setErrore(data.error); return }
    setSuccesso(`Master "${nome}" creato con successo! Le credenziali sono state inviate a ${email}.`)
    setTimeout(() => router.push('/dashboard/clienti/master'), 2000)
  }

  return (
    <div>
      <div style={{marginBottom: '20px'}}>
        <h1 style={{fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0}}>Nuovo Master</h1>
        <p style={{color: '#666', fontSize: '13px', marginTop: '4px'}}>
          Crea un nuovo master sotto di te — potrà gestire i propri clienti e listini in autonomia
        </p>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
      {successo && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>✓ {successo}</div>}

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'24px',maxWidth:'520px'}}>
        <div style={{marginBottom:'16px'}}>
          <label style={lbl}>Nome / Ragione Sociale *</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Franco Logistics" style={inp} />
        </div>
        <div style={{marginBottom:'16px'}}>
          <label style={lbl}>Email *</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="franco@email.com" style={inp} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'20px'}}>
          <div>
            <label style={lbl}>Telefono</label>
            <input value={telefono} onChange={e => setTelefono(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>P.IVA</label>
            <input value={piva} onChange={e => setPiva(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'6px',padding:'10px 14px',marginBottom:'20px',fontSize:'12px',color:'#1d4ed8'}}>
          💡 Il nuovo master avrà accesso al dashboard completo, ma potrà gestire solo i propri clienti, corrieri e listini — non potrà vedere o modificare i tuoi.
        </div>

        <button onClick={crea} disabled={saving}
          style={{background:'#f97316',color:'#fff',border:'none',padding:'10px 28px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
          {saving ? 'Creazione...' : '+ Crea Master'}
        </button>
      </div>
    </div>
  )
}
