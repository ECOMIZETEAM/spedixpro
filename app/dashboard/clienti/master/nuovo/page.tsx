'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}

export default function NuovoMasterPage() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [piva, setPiva] = useState('')
  const [parentListinoId, setParentListinoId] = useState('')
  const [tipoContratto, setTipoContratto] = useState('credito_scalare')
  const [listini, setListini] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [successo, setSuccesso] = useState('')
  const [credenziali, setCredenziali] = useState<any>(null)

  useEffect(() => {
    fetch('/api/listini/lista').then(r => r.json()).then(d => setListini(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  async function crea() {
    if (!nome.trim() || !email.trim()) { setErrore('Nome e email sono obbligatori'); return }
    setSaving(true); setErrore(''); setSuccesso('')

    const res = await fetch('/api/master/crea', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, telefono, piva, parent_listino_id: parentListinoId || null, tipo_contratto: tipoContratto })
    })
    const data = await res.json()
    setSaving(false)

    if (data.error) { setErrore(data.error); return }
    setCredenziali({ email: data.email || email, password: data.password })
  }

  if (credenziali) return (
    <div style={{maxWidth:'560px',margin:'40px auto'}}>
      <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'24px'}}>
        <div style={{fontSize:'16px',fontWeight:800,color:'#16a34a',marginBottom:'6px'}}>✓ Master creato</div>
        <p style={{fontSize:'13px',color:'#555',margin:'0 0 16px'}}>Condividi queste credenziali con il master (le email automatiche partiranno quando il dominio sarà verificato).</p>
        <div style={{background:'#fff',border:'1px solid #d1fae5',borderRadius:'8px',padding:'14px'}}>
          <div style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Email</div>
          <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px',fontFamily:'monospace'}}>{credenziali.email}</div>
          <div style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Password</div>
          <div style={{fontSize:'16px',fontWeight:700,color:'#f97316',fontFamily:'monospace'}}>{credenziali.password}</div>
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
          <button onClick={()=>{navigator.clipboard?.writeText(`Email: ${credenziali.email}\nPassword: ${credenziali.password}\nPortale: https://moovexpress.com`)}}
            style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Copia credenziali</button>
          <button onClick={()=>router.push('/dashboard/clienti/master')}
            style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'6px',padding:'9px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Vai ai master</button>
        </div>
      </div>
    </div>
  )

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
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div>
            <label style={lbl}>Telefono</label>
            <input value={telefono} onChange={e => setTelefono(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>P.IVA</label>
            <input value={piva} onChange={e => setPiva(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'20px'}}>
          <div>
            <label style={lbl}>Listino assegnato</label>
            <select value={parentListinoId} onChange={e => setParentListinoId(e.target.value)} style={inp}>
              <option value="">— nessuno (userà corrieri propri) —</option>
              {listini.map((l:any) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Tipo Contratto</label>
            <select value={tipoContratto} onChange={e => setTipoContratto(e.target.value)} style={inp}>
              <option value="credito_scalare">Credito a scalare</option>
              <option value="fattura_mensile">Fattura mensile</option>
            </select>
          </div>
        </div>

        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px 14px',marginBottom:'20px',fontSize:'12px',color:'#ea580c',lineHeight:1.5}}>
          💡 Il nuovo master avrà accesso al dashboard completo, ma potrà gestire solo i propri clienti, corrieri e listini — non potrà vedere o modificare i tuoi.<br/>
          Il <strong>Listino assegnato</strong> è il prezzo che <strong>tu</strong> applichi a questo master quando spedisce col tuo contratto. Lascialo vuoto se il master userà solo corrieri propri (API sue).
        </div>

        <button onClick={crea} disabled={saving}
          style={{background:'#f97316',color:'#fff',border:'none',padding:'10px 28px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
          {saving ? 'Creazione...' : '+ Crea Master'}
        </button>
      </div>
    </div>
  )
}
