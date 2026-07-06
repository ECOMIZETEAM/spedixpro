'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'

// Cambio password self-service per l'utente loggato (master / staff / cliente).
// Cambia la password dell'account della sessione corrente: stessa email, nuova password.
export default function CambioPassword({ titolo = 'Cambio Password' }: { titolo?: string }) {
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err', testo: string } | null>(null)

  async function salva() {
    if (password.length < 8) { setMsg({ tipo: 'err', testo: 'La password deve avere almeno 8 caratteri' }); return }
    if (password !== conferma) { setMsg({ tipo: 'err', testo: 'Le password non coincidono' }); return }
    setSalvando(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'err', testo: error.message || 'Errore durante il salvataggio' }); return }
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
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" style={inp} />
          </div>
          <div>
            <label style={lbl}>Conferma Password:</label>
            <input type="password" value={conferma} onChange={e => setConferma(e.target.value)} placeholder="Conferma Password" style={inp} />
          </div>
        </div>
        <button onClick={salva} disabled={salvando} style={{ marginTop: '22px', padding: '9px 22px', background: salvando ? '#7fa8e0' : '#3b82c4', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '14px', fontWeight: 600, cursor: salvando ? 'default' : 'pointer' }}>
          {salvando ? 'Salvataggio...' : 'Salva'}
        </button>
      </div>
    </div>
  )
}
