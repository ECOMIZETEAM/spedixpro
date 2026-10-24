'use client'
import { useState } from 'react'
import { RICARICHE_CARTA_SOSPESE } from '@/lib/ricarica-carta'
import DatiBonifico from './DatiBonifico'

type Props = { mancante: number; costo: number; credito: number; onPagato: () => void }

// Riquadro "credito insufficiente" di Nuova spedizione, Ordini e Import: compare quando il credito a
// scalare non copre la spedizione o il lotto.
//
// Con la carta sospesa (lib/ricarica-carta) non c'e' nessun pulsante di pagamento. Fino al 21/10/2026 il
// riquadro non guardava l'interruttore: mostrava a tutti "Paga con la carta e spedisci" e la rotta
// rispondeva sempre "sospeso", quindi l'unica azione offerta non funzionava mai. Ora dice quanto manca
// e mostra gia' qui i dati per il bonifico del master del cliente, gli stessi della pagina Ricarica
// (DatiBonifico). onPagato resta nella firma, cosi' i tre chiamanti non cambiano, ma serve solo alla
// carta: col bonifico il credito lo carica il master quando il versamento arriva, e la spedizione la
// rilancia il cliente.
export default function PagaConCarta(props: Props) {
  if (RICARICHE_CARTA_SOSPESE) {
    return <RiquadroBonifico mancante={props.mancante} costo={props.costo} credito={props.credito} />
  }
  return <RiquadroCarta {...props} />
}

function RiquadroBonifico({ mancante, costo, credito }: Omit<Props, 'onPagato'>) {
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 14 }}>Credito insufficiente</div>
      <div style={{ color: '#9a3412', fontSize: 13, marginTop: 3 }}>
        Spedizione € {costo.toFixed(2)} · credito € {credito.toFixed(2)} — mancano <b>€ {mancante.toFixed(2)}</b>.
      </div>
      <DatiBonifico variante="riquadro" />
    </div>
  )
}

// La scorciatoia della carta: addebita la carta salvata per l'esatto mancante e, appena il credito
// sale, RIPROVA la spedizione da solo — nessun redirect, nessuna cassa. Se non c'è carta salvata o la
// banca chiede il 3DS, manda alla Ricarica (che la cassa Stripe sa gestire, e la prima volta la carta
// la salva).
function RiquadroCarta({ mancante, costo, credito, onPagato }: Props) {
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
