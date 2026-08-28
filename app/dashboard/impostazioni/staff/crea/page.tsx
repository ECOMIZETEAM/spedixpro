'use client'
import { useEffect, useState } from 'react'
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
  // Compenso agente (uno dei 4 metodi), assegnabile gia' alla creazione.
  const [metodo, setMetodo] = useState('listino')
  const [valore, setValore] = useState('')
  const [listinoAgente, setListinoAgente] = useState('')
  const [listini, setListini] = useState<any[]>([])
  useEffect(() => { fetch('/api/listini/lista').then(r => r.json()).then((a: any[]) => setListini(Array.isArray(a) ? a : [])).catch(() => {}) }, [])

  async function salva() {
    if (!nome.trim()) { setMsg('Inserisci il nome'); return }
    if (!email.trim()) { setMsg('Inserisci l\'email'); return }
    if (email.trim() !== confEmail.trim()) { setMsg('Le email non coincidono'); return }
    setSalvando(true); setMsg('')
    const r = await fetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, ruolo, email,
        ...(ruolo === 'agente' ? {
          agente_metodo: metodo,
          agente_valore: metodo !== 'listino' ? (Number(valore) || 0) : 0,
          listino_agente_id: metodo === 'listino' ? (listinoAgente || null) : null,
        } : {}),
      })
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

          <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom: ruolo==='agente' ? '14px' : '22px' }}>
            <label style={lbl}>Ruolo</label>
            <select value={ruolo} onChange={e=>setRuolo(e.target.value)} style={{ ...inp, cursor:'pointer' }}>
              <option value="admin">admin</option>
              <option value="operatore">operatore</option>
              <option value="agente">agente</option>
              <option value="autista">autista</option>
            </select>
          </div>

          {ruolo === 'agente' && (
            <div style={{ border:'1px solid #e8e8e8', borderRadius:'8px', padding:'14px', marginBottom:'22px', background:'#fafafa' }}>
              <div style={{ fontSize:'13px', fontWeight:700, color:'#1a1a1a', marginBottom:'10px' }}>Compenso agente</div>
              <div style={{ marginBottom:'10px' }}>
                <label style={{ fontSize:'12px', fontWeight:600, color:'#1a1a1a', display:'block', marginBottom:'4px' }}>Come lo paghi</label>
                <select value={metodo} onChange={e=>setMetodo(e.target.value)} style={{ ...inp, width:'100%', flex:'none', cursor:'pointer' }}>
                  <option value="listino">Listino personale (margine sul suo listino)</option>
                  <option value="perc_lordo">Percentuale sul lordo (prezzo cliente)</option>
                  <option value="perc_netto">Percentuale sul netto (tuo margine)</option>
                  <option value="fisso">Fisso a spedizione</option>
                </select>
              </div>
              {metodo === 'listino' && (
                <div>
                  <label style={{ fontSize:'12px', fontWeight:600, color:'#1a1a1a', display:'block', marginBottom:'4px' }}>Listino agente (il suo costo)</label>
                  <select value={listinoAgente} onChange={e=>setListinoAgente(e.target.value)} style={{ ...inp, width:'100%', flex:'none', cursor:'pointer' }}>
                    <option value="">— nessuno (lo assegni dopo) —</option>
                    {listini.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                  <div style={{ fontSize:'11px', color:'#8a8a8a', marginTop:'4px' }}>Il suo margine = prezzo cliente − questo costo. Lo vede in sola lettura in &quot;Il mio listino&quot;.</div>
                </div>
              )}
              {(metodo === 'perc_lordo' || metodo === 'perc_netto') && (
                <div>
                  <label style={{ fontSize:'12px', fontWeight:600, color:'#1a1a1a', display:'block', marginBottom:'4px' }}>Percentuale {metodo === 'perc_lordo' ? 'sul lordo (prezzo cliente)' : 'sul netto (tuo margine)'}</label>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <input type="number" step="0.1" min="0" max="100" value={valore} onChange={e=>setValore(e.target.value)} placeholder="es. 10" style={{ ...inp, maxWidth:'130px', flex:'none' }} />
                    <span style={{ color:'#666' }}>%</span>
                  </div>
                </div>
              )}
              {metodo === 'fisso' && (
                <div>
                  <label style={{ fontSize:'12px', fontWeight:600, color:'#1a1a1a', display:'block', marginBottom:'4px' }}>Euro per ogni spedizione</label>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <span style={{ color:'#666' }}>€</span>
                    <input type="number" step="0.01" min="0" value={valore} onChange={e=>setValore(e.target.value)} placeholder="es. 0,50" style={{ ...inp, maxWidth:'130px', flex:'none' }} />
                    <span style={{ color:'#666' }}>a spedizione</span>
                  </div>
                </div>
              )}
            </div>
          )}

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