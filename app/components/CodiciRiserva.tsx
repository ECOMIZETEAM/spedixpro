'use client'
import { useState } from 'react'

// I 10 CODICI DI RISERVA appena generati (lib/verifica-metodi): si vedono solo adesso, nel database resta
// solo l'impronta. Per questo si copiano, si scaricano o si stampano, e si prosegue solo dopo aver detto
// di averli messi da parte. Lo usano la pagina del codice (prima attivazione) e le impostazioni.
export default function CodiciRiserva({ codici, onFatto, testoFatto = 'Continua' }: { codici: string[]; onFatto: () => void; testoFatto?: string }) {
  const [salvati, setSalvati] = useState(false)
  const [copiati, setCopiati] = useState(false)
  const testo = `Codici di riserva MoovExpress\nOgnuno vale una volta sola, al posto del codice dell'app o della mail.\n\n${codici.join('\n')}\n`

  function scarica() {
    const url = URL.createObjectURL(new Blob([testo], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'codici-riserva-moovexpress.txt'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const piccolo = { background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '6px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }
  return (
    <div>
      <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.5, margin: '0 0 10px' }}>
        <b>Metti da parte questi codici di riserva.</b> Se un giorno non hai il telefono o non ti arriva la mail, entri con uno di questi: ognuno vale una volta sola. Non li vedrai più.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', background: '#f9fafb', border: '1px solid #eee', borderRadius: '8px', padding: '14px', fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, color: '#1a1a1a', textAlign: 'center' }}>
        {codici.map(c => <span key={c}>{c}</span>)}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0' }}>
        <button type="button" style={piccolo} onClick={() => { navigator.clipboard?.writeText(testo); setCopiati(true) }}>{copiati ? '✓ Copiati' : 'Copia'}</button>
        <button type="button" style={piccolo} onClick={scarica}>Scarica</button>
        <button type="button" style={piccolo} onClick={() => window.print()}>Stampa</button>
      </div>
      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: '#333', cursor: 'pointer', margin: '6px 0 0' }}>
        <input type="checkbox" checked={salvati} onChange={e => setSalvati(e.target.checked)} style={{ width: '15px', height: '15px', accentColor: '#f97316' }} />
        Li ho messi in un posto sicuro
      </label>
      <button type="button" disabled={!salvati} onClick={onFatto}
        style={{ width: '100%', padding: '12px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700, cursor: salvati ? 'pointer' : 'default', marginTop: '14px', opacity: salvati ? 1 : 0.5 }}>
        {testoFatto}
      </button>
    </div>
  )
}
