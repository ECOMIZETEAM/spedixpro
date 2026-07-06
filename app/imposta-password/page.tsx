'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'

export default function ImpostaPassword() {
  const supabase = createClient()
  const [ready, setReady] = useState(false)      // client ha finito di controllare la sessione dell'invito
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err', testo: string } | null>(null)

  useEffect(() => {
    // Il client browser (@supabase/ssr) scambia automaticamente il token dell'invito
    // presente nell'URL e crea la sessione: la intercetto qui.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) { setHasSession(true); setReady(true) }
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true)
      setReady(true)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  async function salva() {
    if (password.length < 8) { setMsg({ tipo: 'err', testo: 'La password deve avere almeno 8 caratteri' }); return }
    if (password !== conferma) { setMsg({ tipo: 'err', testo: 'Le password non coincidono' }); return }
    setSalvando(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'err', testo: error.message || 'Errore durante il salvataggio' }); return }
    setMsg({ tipo: 'ok', testo: 'Password impostata! Accesso in corso...' })
    setTimeout(() => { window.location.href = '/dashboard' }, 800)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' as const }
  const lbl = { fontSize: '11.5px', fontWeight: 600 as const, color: '#666', display: 'block' as const, marginBottom: '4px' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '40px', width: '400px', boxShadow: '0 2px 16px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a' }}>Moov<span style={{ color: '#f97316' }}>Express</span></div>
          <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Imposta la tua password</div>
        </div>

        {msg && (
          <div style={{ padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: '13px', color: '#fff', background: msg.tipo === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.testo}</div>
        )}

        {!ready ? (
          <div style={{ textAlign: 'center', color: '#888', fontSize: '13px', padding: '20px 0' }}>Verifica dell'invito in corso...</div>
        ) : !hasSession ? (
          <div style={{ textAlign: 'center', color: '#dc2626', fontSize: '13px', padding: '10px 0' }}>
            Link non valido o scaduto.<br />Chiedi all'amministratore un nuovo invito.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={lbl}>Nuova password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inp} />
            </div>
            <div>
              <label style={lbl}>Conferma password</label>
              <input type="password" value={conferma} onChange={e => setConferma(e.target.value)} placeholder="••••••••" style={inp} />
            </div>
            <button onClick={salva} disabled={salvando} style={{ background: salvando ? '#fbbf24' : '#f97316', color: '#fff', border: 'none', padding: '11px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, cursor: salvando ? 'default' : 'pointer' }}>
              {salvando ? 'Salvataggio...' : 'Imposta password ed entra'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
