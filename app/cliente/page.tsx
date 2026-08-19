'use client'
import { useState, useEffect } from 'react'
import CampoPassword from '../components/CampoPassword'
import PuliziaSessione from '../components/PuliziaSessione'

// Dopo l'accesso si DEVE ricaricare la pagina per intero, non navigare con router.push:
// /cliente (questo modulo) e /cliente/dashboard stanno sotto lo STESSO app/cliente/layout.tsx,
// ed e' quel layout a decidere se mostrare la sidebar. Con una navigazione client il layout
// condiviso non viene rieseguito sul server: resta quello reso qui SENZA sessione, cioe' senza
// sidebar, finche' l'utente non ricarica a mano. E' il "primo accesso senza sidebar" segnalato.
function vaiA(url: string) { window.location.href = url }

export default function ClienteLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errore, setErrore] = useState('')
  const [loading, setLoading] = useState(false)

  // Se un collegamento Shopify è fallito, i vari rami rimandano qui con ?error=... . Prima la pagina
  // NON lo leggeva: il reviewer vedeva solo il form di login, muto, senza sapere cosa fosse andato
  // storto né come proseguire — un vicolo cieco. Ora mostriamo un messaggio chiaro.
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (!err) return
    const MSG: Record<string, string> = {
      firma: 'Collegamento Shopify non riuscito: la richiesta non è stata riconosciuta. Riprova ad aprire l\'app dal tuo negozio Shopify.',
      login_shopify: 'Il negozio è stato collegato, ma non siamo riusciti ad aprire il tuo portale in automatico. Accedi qui sotto (o riprova il collegamento dal negozio).',
      collegamento_scaduto: 'La richiesta di collegamento è scaduta o è già stata completata. Se il negozio non risulta collegato, riprova dal tuo negozio Shopify.',
      collegamento_token: 'Non siamo riusciti a completare il collegamento con Shopify (scambio credenziali). Riprova tra poco dal tuo negozio Shopify.',
    }
    setErrore(MSG[err] || 'Si è verificato un problema durante il collegamento Shopify. Riprova dal tuo negozio; se il problema persiste contatta l\'assistenza.')
  }, [])

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
      vaiA('/cliente/integrazioni?connected=' + encodeURIComponent(pending))
      return
    }
    // 'vai' arriva dal server: il cliente va al suo portale, lo staff che ha sbagliato modulo
    // (agente/master/operatore) viene portato direttamente nell'area master, senza rifare l'accesso.
    vaiA(data.vai || '/cliente/dashboard')
  }

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#f5f5f5',fontFamily:'var(--font-geist-sans),system-ui,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:'12px',padding:'40px',width:'380px',boxShadow:'0 2px 16px rgba(0,0,0,.08)'}}>
        <div style={{textAlign:'center' as const,marginBottom:'32px'}}>
          <div style={{fontSize:'22px',fontWeight:'800',color:'#1a1a1a'}}>Moov<span style={{color:'#f97316'}}>Express</span></div>
          <div style={{fontSize:'13px',color:'#999',marginTop:'4px'}}>Portale Cliente</div>
        </div>
        <PuliziaSessione />
        {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
        <form onSubmit={accedi} style={{display:'flex',flexDirection:'column' as const,gap:'14px'}}>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="Inserisci la tua email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box' as const}}/>
          </div>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}}>Password</label>
            <CampoPassword value={password} onChange={setPassword} />
          </div>
          <button type="submit" disabled={loading}
            style={{background:'#f97316',color:'#fff',border:'none',padding:'11px',borderRadius:'6px',fontSize:'14px',fontWeight:'700' as const,cursor:'pointer',opacity:loading?0.7:1}}>
            {loading?'Accesso in corso...':'Accedi'}
          </button>
          {/* Senza questa via il cliente che non ha (o ha sbagliato) la password resta fuori. */}
          <a href="/recupera-password" style={{textAlign:'center' as const,color:'#888',fontSize:'12.5px',textDecoration:'none'}}>Password dimenticata?</a>
        </form>
      </div>
    </div>
  )
}
