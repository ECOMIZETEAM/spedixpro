'use client'
import { useState } from 'react'

// Riquadro "credito insufficiente" con la scorciatoia di pagamento: addebita la carta salvata per
// l'esatto mancante e, appena il credito sale, RIPROVA la spedizione da solo — nessun redirect,
// nessuna cassa. Se non c'è carta salvata o la banca chiede il 3DS, manda alla Ricarica (che la
// cassa Stripe sa gestire, e la prima volta la carta la salva).
export default function PagaConCarta({ mancante, costo, credito, onPagato }: {
  mancante: number; costo: number; credito: number; onPagato: () => void
}) {
  const [invio, setInvio] = useState(false)
  const [msg, setMsg] = useState('')

  async function paga() {
    if (invio) return
    setInvio(true); setMsg('')
    try {
      const r = await fetch('/api/cliente/paga-carta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importo: mancante }),
      })
      const d = await r.json().catch(() => ({} as any))
      if (r.ok && d?.ok) { onPagato(); return }   // credito salito: riprova la spedizione
      if (d?.serve_ricarica || d?.serve_autenticazione) {
        setMsg((d?.error || 'Completa dalla Ricarica.') + ' Ti porto alla Ricarica…')
        setTimeout(() => { window.location.href = '/cliente/ricarica' }, 1500)
        return   // resta in "invio" fino al redirect: niente doppio click
      }
      setMsg(d?.error || 'Pagamento non riuscito. Riprova o usa la Ricarica.')
      setInvio(false)
    } catch {
      setMsg('Errore di rete. Riprova.'); setInvio(false)
    }
  }

  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 14 }}>Credito insufficiente</div>
      <div style={{ color: '#9a3412', fontSize: 13, marginTop: 3 }}>
        Spedizione € {costo.toFixed(2)} · credito € {credito.toFixed(2)} — mancano <b>€ {mancante.toFixed(2)}</b>.
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={paga} disabled={invio}
          style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: invio ? 'default' : 'pointer', opacity: invio ? 0.75 : 1 }}>
          {invio ? 'Addebito in corso…' : `Paga € ${mancante.toFixed(2)} con la carta e spedisci`}
        </button>
        <a href="/cliente/ricarica"
          style={{ background: '#fff', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Ricarica credito
        </a>
      </div>
      {msg && <div style={{ color: '#9a3412', fontSize: 12, marginTop: 10 }}>{msg}</div>}
    </div>
  )
}
