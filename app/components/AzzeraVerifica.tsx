'use client'
import { useState } from 'react'

// Il pulsante «Azzera la verifica» delle schede cliente, collaboratore e sotto-master: uno solo, cosi'
// le tre schede dicono le stesse cose. Due clic, perche' toglie una protezione all'account. Chi puo'
// farlo lo decide la rotta (`url`), non il pulsante.
// `chi` e' come la scheda chiama la persona: "il cliente", "il collaboratore", "il master".
export default function AzzeraVerifica({ url, chi }: { url: string; chi: string }) {
  const [stato, setStato] = useState<'pronto' | 'conferma' | 'invio'>('pronto')
  const [msg, setMsg] = useState('')
  const Chi = chi.charAt(0).toUpperCase() + chi.slice(1)

  async function azzera() {
    setStato('invio'); setMsg('')
    try {
      const r = await fetch(url, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      setMsg(r.ok
        ? (d.tolti ? `✓ Verifica azzerata: al prossimo accesso ${chi} la riattiva inquadrando un codice nuovo.` : `${Chi} non aveva la verifica attiva: non c'era niente da azzerare.`)
        : (d.error || 'Azzeramento non riuscito, riprova'))
    } catch { setMsg('Azzeramento non riuscito, riprova') }
    setStato('pronto')
  }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '12.5px', color: '#555', lineHeight: 1.5 }}>
        Se {chi} ha cambiato o perso il telefono, o l&apos;app non gli dà più il codice giusto, azzera la verifica: al prossimo accesso la riattiva inquadrando un codice nuovo.
        Prima di inquadrarlo deve cancellare dall&apos;app la vecchia voce MoovExpress, altrimenti continuerà a leggere quella.
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {stato === 'conferma' ? (
          <>
            <button type="button" onClick={azzera} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Sì, azzera</button>
            <button type="button" onClick={() => setStato('pronto')} style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer' }}>Annulla</button>
          </>
        ) : (
          <button type="button" disabled={stato === 'invio'} onClick={() => { setMsg(''); setStato('conferma') }} style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: stato === 'invio' ? 0.6 : 1 }}>
            {stato === 'invio' ? 'Azzero…' : 'Azzera la verifica'}
          </button>
        )}
      </div>
      {msg && <div style={{ fontSize: '12.5px', color: msg.startsWith('✓') ? '#16a34a' : '#555' }}>{msg}</div>}
    </div>
  )
}
