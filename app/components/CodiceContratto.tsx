'use client'
import { useState } from 'react'

// Il codice del contratto (CT-7K3Q9X) accanto al nome: distingue due contratti che si chiamano uguale.
// Un clic lo copia, per dettarlo o incollarlo in un messaggio. Le pagine lo ricevono solo per lo staff del
// master (lib/codice-contratto): se non c'e', non si mostra niente.
export default function CodiceContratto({ codice, piccolo }: { codice?: string | null; piccolo?: boolean }) {
  const [copiato, setCopiato] = useState(false)
  if (!codice) return null
  const copia = (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault()
    navigator.clipboard?.writeText(codice).then(() => { setCopiato(true); setTimeout(() => setCopiato(false), 1400) }).catch(() => {})
  }
  return (
    <span
      role="button" tabIndex={0} onClick={copia}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') copia(e as any) }}
      title={copiato ? 'Copiato' : 'Codice del contratto: clicca per copiarlo'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'all',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: piccolo ? 10.5 : 11, fontWeight: 600,
        letterSpacing: .3, lineHeight: 1, color: copiato ? '#166534' : '#57534e',
        background: copiato ? '#f0fdf4' : '#f5f5f4', border: `1px solid ${copiato ? '#bbf7d0' : '#e7e5e4'}`,
        borderRadius: 6, padding: piccolo ? '3px 6px' : '4px 7px', whiteSpace: 'nowrap', transition: 'all .15s',
      }}
    >
      {copiato ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>
      )}
      {copiato ? 'Copiato' : codice}
    </span>
  )
}
