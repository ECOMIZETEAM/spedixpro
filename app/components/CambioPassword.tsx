'use client'
import { useState } from 'react'
import { REGOLE_PASSWORD_DURATA, REGOLE_PASSWORD_TESTO, erroreRegolePassword } from '@/lib/password-regole'
import CampoPassword from './CampoPassword'

// Cambio password self-service per l'utente loggato (master / staff / cliente).
// Cambia la password dell'account della sessione corrente: stessa email, nuova password.
// Passa dalla rotta /api/auth/password, che controlla anche riuso, nome ed eta' minima.
export default function CambioPassword({ titolo = 'Cambio Password' }: { titolo?: string }) {
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err', testo: string } | null>(null)

  async function salva() {
    const erroreRegole = erroreRegolePassword(password)
    if (erroreRegole) { setMsg({ tipo: 'err', testo: erroreRegole }); return }
    if (password !== conferma) { setMsg({ tipo: 'err', testo: 'Le password non coincidono' }); return }
    setSalvando(true); setMsg(null)
    const r = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setSalvando(false)
    if (!r || !r.ok) { setMsg({ tipo: 'err', testo: j?.error || 'Password non salvata, riprova.' }); return }
    setPassword(''); setConferma('')
    setMsg({ tipo: 'ok', testo: 'Password aggiornata con successo. Al prossimo accesso usa la nuova password.' })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const lbl = { display: 'block' as const, fontSize: '13px', fontWeight: 600 as const, color: '#b5651d', marginBottom: '6px' }
  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#1a1a1a', boxSizing: 'border-box' as const }

  return (
    <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden', maxWidth: '900px' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 500, color: '#3a3a3a', margin: 0 }}>{titolo}</h2>
      </div>
      <div style={{ padding: '20px' }}>
        {msg && (
          <div style={{ padding: '10px 14px', borderRadius: 6, marginBottom: 18, fontSize: '13px', color: '#fff', background: msg.tipo === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.testo}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '760px' }}>
          <div>
            <label style={lbl}>Nuova Password:</label>
            <CampoPassword value={password} onChange={setPassword} placeholder="Almeno 12 caratteri, con simbolo" required={false} />
          </div>
          <div>
            <label style={lbl}>Conferma Password:</label>
            <CampoPassword value={conferma} onChange={setConferma} placeholder="Ripeti la password" required={false} />
          </div>
        </div>
        <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#666' }}>
          {REGOLE_PASSWORD_TESTO} {REGOLE_PASSWORD_DURATA} Da qui scegli tu la password: quella che hai ricevuto per email smette di valere.
        </div>
        <button onClick={salva} disabled={salvando} style={{ marginTop: '22px', padding: '9px 22px', background: salvando ? '#7fa8e0' : '#3b82c4', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '14px', fontWeight: 600, cursor: salvando ? 'default' : 'pointer' }}>
          {salvando ? 'Salvataggio...' : 'Salva'}
        </button>
      </div>
    </div>
  )
}
