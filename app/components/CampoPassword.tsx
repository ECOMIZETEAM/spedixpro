'use client'
import { useState } from 'react'

// Campo password con occhio per MOSTRARE quello che si è digitato.
// Serve davvero: le credenziali arrivano per email e vengono ricopiate a mano, quindi un
// carattere sbagliato è la causa più comune di "non riesco ad accedere" — e senza vedere il
// testo l'utente non ha modo di accorgersene.
export default function CampoPassword({
  name = 'password', value, onChange, placeholder = '••••••••', autoFocus = false, required = true,
}: {
  name?: string
  value?: string
  onChange?: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  required?: boolean
}) {
  const [visibile, setVisibile] = useState(false)
  const controllato = typeof value === 'string' && typeof onChange === 'function'

  return (
    <div style={{ position: 'relative' }}>
      <input
        name={name}
        type={visibile ? 'text' : 'password'}
        required={required}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...(controllato ? { value, onChange: (e: any) => onChange!(e.target.value) } : {})}
        style={{ width: '100%', padding: '9px 40px 9px 12px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }}
      />
      <button
        type="button"
        onClick={() => setVisibile(v => !v)}
        aria-label={visibile ? 'Nascondi password' : 'Mostra password'}
        title={visibile ? 'Nascondi password' : 'Mostra password'}
        style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', padding: '6px 8px', fontSize: '15px', lineHeight: 1, color: '#888' }}
      >
        {visibile ? '🙈' : '👁'}
      </button>
    </div>
  )
}
