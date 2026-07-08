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
  const [listini, setListini] = useState<any[]>([])
  // Credito del sotto-master (gestito come un cliente, via API m:)
  const [saldo, setSaldo] = useState(0)
  const [impCredito, setImpCredito] = useState('')
  const [descCredito, setDescCredito] = useState('Ricarica credito')
  const [savingCredito, setSavingCredito] = useState(false)
  const [msgCredito, setMsgCredito] = useState('')
  const [errCredito, setErrCredito] = useState('')

  function caricaCredito() {
    fetch(`/api/movimenti/lista?clienteId=m:${id}`).then(r=>r.json()).then(d=>{
      if (d && !d.error) setSaldo(Number(d.saldo||0))
    }).catch(()=>{})
  }

  useEffect(() => {
    fetch(`/api/master/${id}`).then(r=>r.json()).then(d=>{
      if (d.error) { setErrore(d.error); setLoading(false); return }
      setM(d); setLoading(false)
    }).catch(()=>{ setErrore('Errore caricamento'); setLoading(false) })
    fetch('/api/listini/lista').then(r=>r.json()).then(d=>setListini(Array.isArray(d)?d:[])).catch(()=>{})
    caricaCredito()
  }, [id])

  async function salvaCredito() {
    setErrCredito(''); setMsgCredito('')
    const imp = parseFloat(String(impCredito).replace(',','.'))
    if (!isFinite(imp) || imp === 0) { setErrCredito('Inserisci un importo diverso da 0 (usa il − per togliere)'); return }
    if (!descCredito.trim()) { setErrCredito('Inserisci una descrizione'); return }
    setSavingCredito(true)
    try {
      const res = await fetch('/api/movimenti/crea', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ clienteId: `m:${id}`, tipo: imp>0?'ricarica':'rettifica', descrizione: descCredito.trim(), importo: imp })
      })
      const d = await res.json(); setSavingCredito(false)
      if (d.error) { setErrCredito(d.error); return }
      setSaldo(Number(d.saldo ?? saldo)); setImpCredito(''); setMsgCredito('✓ Credito aggiornato')
    } catch { setErrCredito('Errore di rete'); setSavingCredito(false) }
  }

  async function salva() {
    setSaving(true); setErrore(''); setMsg(''); setPasswordMostrata('')
    const body: any = {
      nome: m.nome, telefono: m.telefono, piva: m.piva, tipo_contratto: m.tipo_contratto,
      parent_listino_id: m.parent_listino_id || null,
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
        <div style={{marginBottom:'12px'}}><label style={lbl}>Listino assegnato</label>
          <select style={inp} value={m.parent_listino_id||''} onChange={e=>setM({...m,parent_listino_id:e.target.value})}>
            <option value="">— nessuno (userà corrieri propri) —</option>
            {listini.map((l:any)=><option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <div style={{fontSize:'11px',color:'#999',marginTop:'4px'}}>Il prezzo che TU applichi a questo master quando spedisce col tuo contratto.</div>
        </div>
        <div><label style={lbl}>Tipo contratto</label>
          <select style={inp} value={m.tipo_contratto||'credito_scalare'} onChange={e=>setM({...m,tipo_contratto:e.target.value})}>
            <option value="credito_scalare">Credito a scalare</option>
            <option value="fattura_mensile">Fattura mensile</option>
          </select></div>
      </div>

      {/* Credito */}
      <div style={card}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'14px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span>Credito</span>
          <span style={{fontSize:'16px',fontWeight:800,color:saldo<0?'#dc2626':'#16a34a'}}>€ {saldo.toFixed(2)}</span>
        </div>
        {errCredito && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'8px 12px',marginBottom:'10px',fontSize:'12.5px',color:'#dc2626'}}>{errCredito}</div>}
        {msgCredito && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'8px 12px',marginBottom:'10px',fontSize:'12.5px',color:'#16a34a'}}>{msgCredito}</div>}
        <div style={{display:'grid',gridTemplateColumns:'150px 1fr',gap:'10px',alignItems:'end'}}>
          <div><label style={lbl}>Importo (€)</label>
            <input style={inp} inputMode="decimal" value={impCredito} onChange={e=>setImpCredito(e.target.value)} placeholder="es. 200 o -50"/></div>
          <div><label style={lbl}>Descrizione</label>
            <input style={inp} value={descCredito} onChange={e=>setDescCredito(e.target.value)}/></div>
        </div>
        <div style={{fontSize:'11px',color:'#999',margin:'6px 0 12px'}}>Scrivi <b>200</b> per aggiungere, <b>-50</b> per togliere credito.</div>
        <button onClick={salvaCredito} disabled={savingCredito}
          style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'9px 18px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:savingCredito?0.6:1}}>
          {savingCredito?'Salvo...':'Applica al credito'}</button>
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
