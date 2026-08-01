'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'

// ACCOUNT SOSPESO PER CANONE NON PAGATO.
//
// Blocca il portale a CHI NON HA PAGATO, e solo a lui. I suoi clienti e i suoi sotto-master
// continuano a lavorare normalmente: spediscono, i conteggi e i movimenti proseguono, il flusso
// non si ferma. E' una questione fra noi e lui, e non ha senso farla pagare a chi ha pagato.
//
// Da qui si puo' fare una cosa sola: pagare. Non c'e' modo di chiudere la finestra, perche' non
// e' un avviso — e' il blocco.
export default function CongelatoGate() {
  const [s, setS] = useState<any>(null)
  const [attesa, setAttesa] = useState(false)
  const [msg, setMsg] = useState('')

  async function carica() {
    try {
      const d = await (await fetch('/api/piano/stato')).json()
      setS(d?.motivo === 'pagamento' && d?.bloccatoDaMe ? d : null)
    } catch { }
  }
  useEffect(() => {
    carica()
    // Se paga da un'altra scheda il blocco deve cadere da solo, senza dover ricaricare a mano.
    const t = setInterval(carica, 60000)
    return () => clearInterval(t)
  }, [])

  if (!s) return null

  async function paga() {
    setAttesa(true); setMsg('')
    try {
      const d = await (await fetch('/api/stripe/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pianoId: s.piano }),
      })).json()
      if (d?.url) { window.location.href = d.url; return }
      setMsg(d?.error || 'Pagamento non disponibile in questo momento.')
    } catch { setMsg('Pagamento non disponibile in questo momento.') }
    setAttesa(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.82)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '560px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.45)', overflow: 'hidden' }}>
        <div style={{ background: '#b91c1c', padding: '18px 28px' }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>Account sospeso</div>
        </div>
        <div style={{ padding: '26px 28px' }}>
          <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.65, margin: '0 0 14px' }}>
            Il canone dell'abbonamento non risulta pagato, quindi il tuo accesso al portale è sospeso.
            {s.piano ? <> Il tuo piano è <strong>{String(s.piano).replace('enterprise_', 'Enterprise ').toUpperCase()}</strong>{s.prezzo ? <> — € {s.prezzo} al mese</> : null}.</> : null}
          </p>
          <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.65, margin: '0 0 18px' }}>
            <strong>I tuoi clienti e i tuoi sotto-master continuano a spedire normalmente</strong>: il
            blocco riguarda solo il tuo accesso. Appena il pagamento va a buon fine si riattiva tutto,
            senza dover chiedere niente a nessuno.
          </p>
          {msg && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px', marginBottom: '14px', fontSize: '13px', color: '#b91c1c' }}>{msg}</div>}
          <button onClick={paga} disabled={attesa || !s.piano}
            style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 22px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', opacity: attesa ? .6 : 1 }}>
            {attesa ? 'Attendere…' : 'Paga e riattiva subito'}
          </button>
          <p style={{ fontSize: '12.5px', color: '#777', margin: '16px 0 0' }}>
            Per assistenza scrivi a <a href="mailto:info@moovexpress.com" style={{ color: ACCENT }}>info@moovexpress.com</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
