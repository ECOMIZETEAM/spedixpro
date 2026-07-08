'use client'
import { useEffect, useState } from 'react'
import { popFlash } from '@/lib/flash'

// Mostra in alto un banner verde di conferma quando la pagina precedente
// ha impostato un flash (es. dopo un salvataggio). Si auto-nasconde dopo 5s.
export default function FlashBanner() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const m = popFlash()
    if (!m) return
    setMsg(m)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const t = setTimeout(() => setMsg(null), 5000)
    return () => clearTimeout(t)
  }, [])

  if (!msg) return null

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 2000, marginBottom: '16px',
      background: '#16a34a', color: '#fff', padding: '12px 18px', borderRadius: '8px',
      fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px',
      boxShadow: '0 2px 10px rgba(22,163,74,0.30)',
    }}>
      <span>{msg}</span>
      <button onClick={() => setMsg(null)} aria-label="Chiudi" style={{
        marginLeft: 'auto', background: 'transparent', border: 'none', color: '#fff',
        fontSize: '18px', lineHeight: 1, cursor: 'pointer', opacity: 0.85,
      }}>×</button>
    </div>
  )
}
