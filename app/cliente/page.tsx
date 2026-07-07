'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ClienteLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errore, setErrore] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function accedi(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setErrore('')
    const res = await fetch('/api/auth/cliente-login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    })
    const data = await res.json()
    setLoading(false)
    if (data.error) { setErrore(data.error); return }
    // Se l'utente arriva da un'installazione Shopify (OAuth partito da Shopify),
    // collega ora il negozio in attesa al suo account, poi vai alle integrazioni.
    const pending = new URLSearchParams(window.location.search).get('shopify_pending')
    if (pending) {
      try {
        await fetch('/api/integrazioni/shopify/rivendica', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ shop: pending })
        })
      } catch {}
      router.push('/cliente/integrazioni?connected=' + encodeURIComponent(pending))
      return
    }
    router.push('/cliente/dashboard')
  }

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#f5f5f5',fontFamily:'var(--font-geist-sans),system-ui,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:'12px',padding:'40px',width:'380px',boxShadow:'0 2px 16px rgba(0,0,0,.08)'}}>
        <div style={{textAlign:'center' as const,marginBottom:'32px'}}>
          <div style={{fontSize:'22px',fontWeight:'800',color:'#1a1a1a'}}>Moov<span style={{color:'#f97316'}}>Express</span></div>
          <div style={{fontSize:'13px',color:'#999',marginTop:'4px'}}>Portale Cliente</div>
        </div>
        {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
        <form onSubmit={accedi} style={{display:'flex',flexDirection:'column' as const,gap:'14px'}}>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="Inserisci la tua email"
              style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box' as const}}/>
          </div>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••"
              style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box' as const}}/>
          </div>
          <button type="submit" disabled={loading}
            style={{background:'#f97316',color:'#fff',border:'none',padding:'11px',borderRadius:'6px',fontSize:'14px',fontWeight:'700' as const,cursor:'pointer',opacity:loading?0.7:1}}>
            {loading?'Accesso in corso...':'Accedi'}
          </button>
        </form>
      </div>
    </div>
  )
}
