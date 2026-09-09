'use client'

import { useEffect, useState } from 'react'

// Pagina RICARICA CREDITO del cliente. Sceglie un importo, paga con carta su Stripe (Checkout) e
// torna qui: il credito NON si aggiorna a schermo subito, si accredita nel webhook quando il
// circuito conferma il pagamento. Per questo, al rientro (stato=ok), interroghiamo il saldo
// qualche volta finché non sale — senza promettere un numero che ancora non c'è.

const ACCENT = '#f97316'
const MIN = 10
const MAX = 5000
const TAGLI = [25, 50, 100, 250, 500]

const card: React.CSSProperties = {
  background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', padding: '24px',
}

export default function RicaricaCredito() {
  const [importo, setImporto] = useState(50)
  const [credito, setCredito] = useState<number | null>(null)
  const [invio, setInvio] = useState(false)
  const [errore, setErrore] = useState('')
  // 'ok' / 'annullata' arriva da Stripe nell'URL di ritorno.
  const [stato, setStato] = useState<'ok' | 'annullata' | null>(null)
  const [accreditato, setAccreditato] = useState(false)

  // Carico il saldo attuale (dà contesto: quanto ho ora, quanto avrò dopo).
  const leggiCredito = async () => {
    try {
      const r = await fetch('/api/cliente/dashboard')
      const d = await r.json()
      if (typeof d?.credito === 'number') { setCredito(d.credito); return d.credito as number }
    } catch {}
    return null
  }

  useEffect(() => { leggiCredito() }, [])

  // Al rientro dal pagamento riconosco l'esito e, se è andato bene, aspetto che il webhook accrediti.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const s = q.get('stato')
    if (s !== 'ok' && s !== 'annullata') return
    setStato(s)
    // Pulisco l'URL: un refresh non deve rimostrare il banner all'infinito.
    window.history.replaceState(null, '', '/cliente/ricarica')
    if (s !== 'ok') return
    // Il credito si muove nel webhook, non all'istante: sondo qualche volta finché non sale.
    let saldoIniziale: number | null = null
    let tentativi = 0
    const t = setInterval(async () => {
      const c = await leggiCredito()
      if (saldoIniziale === null) saldoIniziale = c
      tentativi++
      if ((c !== null && saldoIniziale !== null && c > saldoIniziale) || tentativi >= 8) {
        if (c !== null && saldoIniziale !== null && c > saldoIniziale) setAccreditato(true)
        clearInterval(t)
      }
    }, 1800)
    return () => clearInterval(t)
  }, [])

  const importoValido = importo >= MIN && importo <= MAX

  async function paga() {
    if (!importoValido || invio) return
    setInvio(true); setErrore('')
    try {
      const r = await fetch('/api/cliente/ricarica', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importo }),
      })
      const d = await r.json()
      if (!r.ok || !d?.url) { setErrore(d?.error || 'Non è stato possibile aprire il pagamento.'); setInvio(false); return }
      window.location.href = d.url   // vado alla cassa Stripe
    } catch {
      setErrore('Errore di rete. Riprova.'); setInvio(false)
    }
  }

  // SOSPESE (decisione super master): niente ricarica self-service. Deve combaciare col blocco lato
  // rotta in app/api/cliente/ricarica. Per riattivare: rimettere a false qui e nella rotta.
  const SOSPESE = true
  if (SOSPESE) {
    // RICARICA CON BONIFICO.
    //
    // Con la carta sospesa questa pagina diceva soltanto "contatta il tuo referente": un vicolo
    // cieco. Chi si e' appena iscritto non puo' spedire finche' non ha credito, e non trovava
    // scritto da nessuna parte DOVE versarlo — nemmeno la voce di menu, che era nascosta.
    // Chi incassa e' il MASTER del cliente, non noi: i dati bancari sono i suoi, e la causale porta
    // il codice cliente cosi' l'accredito si riconosce da solo.
    return <RicaricaBonifico card={card} />
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', margin: '4px 0 4px' }}>Ricarica credito</h1>
      <p style={{ color: '#777', fontSize: 14, margin: '0 0 20px' }}>
        Aggiungi credito con carta. Paghi le spedizioni al volo e non resti mai a secco.
      </p>

      {stato === 'ok' && (
        <div style={{ ...card, background: '#f0fdf4', borderColor: '#bbf7d0', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#15803d', fontSize: 15 }}>
            {accreditato ? '✓ Credito aggiornato' : '✓ Pagamento ricevuto'}
          </div>
          <div style={{ color: '#166534', fontSize: 13, marginTop: 4 }}>
            {accreditato
              ? 'La ricarica è sul tuo conto. La carta resta salvata per gli addebiti futuri.'
              : 'Stiamo accreditando il credito: ci vogliono pochi secondi. Puoi restare qui, si aggiorna da solo.'}
          </div>
        </div>
      )}
      {stato === 'annullata' && (
        <div style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 15 }}>Pagamento annullato</div>
          <div style={{ color: '#9a3412', fontSize: 13, marginTop: 4 }}>Nessun addebito. Quando vuoi ricarichi da qui.</div>
        </div>
      )}

      <div style={card}>
        {credito !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ color: '#888', fontSize: 13 }}>Credito attuale</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: credito > 0 ? '#16a34a' : '#dc2626' }}>€ {credito.toFixed(2)}</span>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 10 }}>Scegli l’importo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: 10, marginBottom: 16 }}>
          {TAGLI.map(t => {
            const sel = importo === t
            return (
              <button key={t} onClick={() => setImporto(t)} type="button"
                style={{
                  padding: '14px 0', borderRadius: 10, cursor: 'pointer', fontSize: 16, fontWeight: 700,
                  border: sel ? `2px solid ${ACCENT}` : '1px solid #e0e0e0',
                  background: sel ? '#fff7ed' : '#fff', color: sel ? ACCENT : '#333',
                  transition: 'all .12s',
                }}>
                € {t}
              </button>
            )
          })}
        </div>

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>Oppure un importo personalizzato</label>
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#999', fontSize: 16, fontWeight: 600 }}>€</span>
          <input
            type="number" inputMode="numeric" min={MIN} max={MAX} value={importo}
            onChange={e => setImporto(Math.floor(Number(e.target.value) || 0))}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 14px 12px 34px', fontSize: 16,
              border: '1px solid #e0e0e0', borderRadius: 10, outline: 'none', fontWeight: 600, color: '#1a1a1a',
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: importoValido ? '#aaa' : '#dc2626', minHeight: 18, marginBottom: 18 }}>
          {importo < MIN ? `Ricarica minima € ${MIN}.` : importo > MAX ? `Per importi oltre € ${MAX} scrivici: te la gestiamo su misura.` : `Minimo € ${MIN} · massimo € ${MAX}.`}
        </div>

        {errore && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{errore}</div>}

        <button onClick={paga} disabled={!importoValido || invio}
          style={{
            width: '100%', padding: '15px 0', borderRadius: 10, border: 'none',
            background: (!importoValido || invio) ? '#f0a875' : ACCENT, color: '#fff',
            fontSize: 16, fontWeight: 700, cursor: (!importoValido || invio) ? 'default' : 'pointer',
          }}>
          {invio ? 'Apro il pagamento…' : `Ricarica € ${importoValido ? importo : ''} con carta`}
        </button>

        <div style={{ fontSize: 12, color: '#999', marginTop: 12, textAlign: 'center', lineHeight: 1.5 }}>
          Pagamento sicuro con Stripe. La carta resta salvata per gli addebiti futuri<br />(ripesature, resi) — così non li rincorri a mano.
        </div>
      </div>
    </div>
  )
}

// ── Istruzioni per il bonifico ────────────────────────────────────────────────
function RicaricaBonifico({ card }: { card: React.CSSProperties }) {
  const [d, setD] = useState<any>(null)
  const [caricato, setCaricato] = useState(false)
  const [copiato, setCopiato] = useState('')
  useEffect(() => {
    fetch('/api/cliente/ricarica-bonifico').then(r => r.json())
      .then(j => setD(j?.error ? null : j)).catch(() => setD(null))
      .finally(() => setCaricato(true))
  }, [])
  const copia = (v: string, k: string) => {
    try { navigator.clipboard.writeText(v); setCopiato(k); setTimeout(() => setCopiato(''), 1500) } catch { }
  }
  const riga = (etichetta: string, valore: string, k?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f2f2f2' }}>
      <span style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 600 }}>{etichetta}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 600, fontFamily: k === 'iban' ? 'monospace' : undefined }}>{valore}</span>
        {k ? <button onClick={() => copia(valore, k)} style={{ fontSize: 11, padding: '3px 9px', border: '1px solid #e5e5e5', background: '#fff', borderRadius: 5, cursor: 'pointer', fontWeight: 700, color: '#555' }}>{copiato === k ? '✓' : 'copia'}</button> : null}
      </span>
    </div>
  )

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', margin: '4px 0 4px' }}>Ricarica credito</h1>
      <p style={{ color: '#666', fontSize: 13.5, margin: '0 0 14px', lineHeight: 1.6 }}>
        Le spedizioni si pagano con il credito: si ricarica con <strong>bonifico bancario</strong>.
        Appena il bonifico arriva, il credito viene accreditato e puoi spedire.
      </p>

      {!caricato ? <div style={{ ...card }}>Caricamento…</div>
        : d?.pronto ? (
          <>
            <div style={{ ...card }}>
              {riga('Intestatario', d.intestatario || '—')}
              {riga('IBAN', d.iban, 'iban')}
              {d.banca ? riga('Banca', d.banca) : null}
              {riga('Causale', d.causale, 'causale')}
            </div>
            <div style={{ ...card, marginTop: 12, background: '#fff7ed', borderColor: '#fed7aa' }}>
              <div style={{ fontSize: 13, color: '#7c2d12', lineHeight: 1.6 }}>
                <strong>Metti la causale esatta</strong>: contiene il tuo codice cliente ed è quello che
                fa riconoscere il versamento. Senza, l'accredito richiede più tempo.
                {d.contatto ? <> Per qualsiasi cosa: <strong>{d.contatto}</strong>.</> : null}
              </div>
            </div>
          </>
        ) : (
          // Il master non ha ancora inserito i suoi dati bancari: si dice com'e', con un contatto
          // vero, invece di mostrare campi vuoti che sembrano un guasto.
          <div style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa' }}>
            <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 15 }}>Dati per il bonifico non ancora disponibili</div>
            <div style={{ color: '#9a3412', fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
              {d?.master ? <>{d.master} non ha ancora pubblicato le coordinate bancarie. </> : null}
              Scrivi a <strong>{d?.contatto || 'assistenza'}</strong> per ricaricare il credito: ti rispondono con le istruzioni.
            </div>
          </div>
        )}
    </div>
  )
}
