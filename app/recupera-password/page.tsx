'use client'
import { useState } from 'react'

// Recupero password self-service. Prima non esisteva: le credenziali le imposta il master a
// mano e nessuna email parte da sola, quindi chi non le aveva mai ricevute o le aveva perse
// restava fuori e doveva farsele risettare da qualcuno.
export default function RecuperaPassword() {
  const [email, setEmail] = useState('')
  const [inviato, setInviato] = useState(false)
  const [invio, setInvio] = useState(false)

  async function invia(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setInvio(true)
    // La risposta è sempre la stessa, esista o no l'indirizzo: non si rivela chi è registrato.
    await fetch('/api/auth/recupera', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {})
    setInvio(false); setInviato(true)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' as const }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '40px', width: '400px', maxWidth: '100%', boxShadow: '0 2px 16px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a' }}>Moov<span style={{ color: '#f97316' }}>Express</span></div>
          <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Recupero password</div>
        </div>

        {inviato ? (
          <div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '16px', fontSize: '13px', color: '#166534', lineHeight: 1.6 }}>
              Se l'indirizzo è registrato, ti abbiamo inviato una email con il collegamento per scegliere una nuova password. Vale un'ora e una volta sola.
              <div style={{ marginTop: '10px', color: '#15803d', fontSize: '12px' }}>Non la trovi? Controlla la posta indesiderata.</div>
            </div>
            <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: '20px', color: '#f97316', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>← Torna all'accesso</a>
          </div>
        ) : (
          <form onSubmit={invia} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ color: '#666', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>Inserisci l'email con cui accedi al portale: ti mandiamo un collegamento per impostare una nuova password.</p>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" required autoFocus placeholder="La tua email" style={inp} />
            </div>
            <button type="submit" disabled={invio} style={{ background: '#f97316', color: '#fff', border: 'none', padding: '11px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, cursor: invio ? 'default' : 'pointer', opacity: invio ? .7 : 1 }}>
              {invio ? 'Invio…' : 'Inviami il collegamento'}
            </button>
            <a href="/" style={{ textAlign: 'center', color: '#888', fontSize: '12.5px', textDecoration: 'none' }}>← Torna all'accesso</a>
          </form>
        )}
      </div>
    </div>
  )
}
