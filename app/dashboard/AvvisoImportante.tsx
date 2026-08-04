'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'

// AVVISO CHE NON SI PUO' NON LEGGERE.
//
// Una mail si perde, finisce nello spam, o la legge chi non decide. Per una cosa che ha una
// scadenza — "dal 6 agosto non spedisci piu' se non hai pagato" — non basta. Questa finestra si
// apre sopra il portale e si chiude solo premendo "Ho capito", e da quel momento non torna piu'.
export default function AvvisoImportante() {
  const [a, setA] = useState<any>(null)
  const [chiudendo, setChiudendo] = useState(false)

  useEffect(() => {
    fetch('/api/avvisi').then(r => r.json()).then(d => { if (d?.avviso) setA(d) }).catch(() => {})
  }, [])

  if (!a) return null

  async function hoCapito() {
    setChiudendo(true)
    try { await fetch('/api/avvisi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avviso: a.avviso }) }) } catch { }
    setA(null)
  }

  const riga = { fontSize: '14px', color: '#333', lineHeight: 1.65, margin: '0 0 14px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.72)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '620px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
        <div style={{ background: '#1a1a1a', padding: '18px 28px' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#fff' }}>Moov<span style={{ color: ACCENT }}>Express</span></div>
        </div>

        <div style={{ padding: '26px 28px' }}>
          <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a1a', marginBottom: '14px' }}>
            Il canone passa al pagamento con carta
          </div>

          <p style={riga}>
            Da agosto il canone del tuo abbonamento si paga <strong>con carta</strong>, con rinnovo automatico
            il primo di ogni mese. Non viene più scalato dal credito che usi per le spedizioni: i due conti
            restano separati, e per il canone ricevi una fattura a ogni pagamento.
          </p>

          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '14px 16px', margin: '0 0 14px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#9a3412' }}>Cosa devi fare</div>
            <div style={{ fontSize: '14px', color: '#9a3412', lineHeight: 1.6, marginTop: '6px' }}>
              Apri <strong>Abbonamento</strong> e attiva il pagamento con carta. Ci vogliono due minuti.
              {a.piano ? <> Il tuo piano resta <strong>{String(a.piano).replace('enterprise_', 'Enterprise ').toUpperCase()}</strong>{a.prezzo ? <> — € {a.prezzo} al mese</> : null}.</> : null}
            </div>
          </div>

          <p style={riga}>
            <strong>Da domenica 3 agosto</strong> chi non ha ancora attivato la carta avrà <strong>3 giorni</strong> per
            farlo. Passati quelli il portale si chiude e non potrai più operare — ma{' '}
            <strong>i tuoi clienti e i tuoi sotto-master continuano a spedire normalmente</strong>: il canone
            è tuo, non loro. Appena il pagamento va a buon fine riparte tutto da solo.
          </p>

          <p style={{ ...riga, marginBottom: '22px' }}>
            Da Abbonamento puoi anche cambiare piano quando vuoi: uno superiore vale subito e paghi la differenza
            di piano; uno inferiore parte dal primo del mese successivo, così non perdi quello che hai già pagato.
          </p>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <a href="/dashboard/abbonamento" onClick={hoCapito}
              style={{ background: ACCENT, color: '#fff', textDecoration: 'none', borderRadius: '8px', padding: '11px 20px', fontSize: '14px', fontWeight: 700 }}>
              Attiva il pagamento
            </a>
            <button onClick={hoCapito} disabled={chiudendo}
              style={{ background: '#fff', color: '#555', border: '1px solid #d1d5db', borderRadius: '8px', padding: '11px 18px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              {chiudendo ? '…' : 'Ho capito'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
