'use client'
// Il voto sulla nuova versione (Lorenzo 19/11: «un sondaggio per chi approva e chi no… voto più commento»). Un voto da
// 1 a 5 e, se si vuole, cosa cambiare. Uno per persona e per argomento: si può cambiare, l'ultimo vale. Si apre da
// «Lascia il tuo voto» o da «Torna alla versione attuale»: in quel caso, votato o no, si torna poi alla pagina di oggi.
//
// LE DUE DOMANDE INSIEME (21/11). Prima la finestra chiedeva UN voto, e quale dipendeva dalla pagina: dalla Nuova
// spedizione si votava solo quella pagina, da tutte le altre solo la versione nuova. Niente lo diceva: Lorenzo ha
// votato una volta dalla Nuova spedizione convinto di aver votato tutto («pensavo di avere votato tutto.. funziona
// abbastanza male»). Ora una finestra sola con tutti gli argomenti (argomenti.ts), ognuno col suo voto e il suo
// commento, e un invio solo. Il voto della versione serve per inviare; gli altri si possono lasciare (chi non ha
// ancora aperto la Nuova spedizione non la vota). La domanda obbligatoria, sulla versione, è sempre la prima.
import { useEffect, useRef, useState } from 'react'
import { ARGOMENTI, type Argomento } from './argomenti'

const DICITURE = ['', 'Per niente', 'Poco', 'Così così', 'Mi piace', 'Moltissimo']
const TUTTI = Object.keys(ARGOMENTI) as Argomento[]
type Risposta = { voto: number; commento: string; gia: boolean }

export default function Sondaggio({ pagina, uscita, chiudi }: { pagina: string; uscita: boolean; chiudi: () => void }) {
  // la versione per prima (obbligatoria), poi le pagine (facoltative): l'ordine di argomenti.ts
  const ordine = TUTTI
  const [risposte, setRisposte] = useState<Record<string, Risposta>>(() => Object.fromEntries(TUTTI.map(a => [a, { voto: 0, commento: '', gia: false }])))
  const [stato, setStato] = useState<'' | 'invio' | 'fatto' | 'errore'>('')

  const torna = () => { window.location.href = window.location.pathname }
  // chiudi arriva nuovo a ogni disegno della cornice: tenuto in un riferimento, i voti salvati si leggono UNA volta sola
  // (altrimenti a ogni aggiornamento dei conteggi si cancellava la scelta appena fatta)
  const chiudiRif = useRef(chiudi); chiudiRif.current = chiudi
  const fine = () => (uscita ? torna() : chiudi())

  useEffect(() => {
    let vivo = true
    for (const a of TUTTI) {
      fetch('/api/grafica/voto?argomento=' + a, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
        if (!vivo || !d?.voto) return
        setRisposte(r => ({ ...r, [a]: { voto: d.voto, commento: d.commento || '', gia: true } }))
      }).catch(() => {})
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudiRif.current() }
    window.addEventListener('keydown', esc)
    return () => { vivo = false; window.removeEventListener('keydown', esc) }
  }, [])

  const metti = (a: Argomento, x: Partial<Risposta>) => setRisposte(r => ({ ...r, [a]: { ...r[a], ...x } }))
  const daInviare = TUTTI.filter(a => risposte[a].voto > 0)
  const pronto = risposte.versione.voto > 0
  const giaVotato = TUTTI.some(a => risposte[a].gia)

  const invia = async () => {
    if (!pronto || stato === 'invio') return
    setStato('invio')
    try {
      // un argomento alla volta: se uno non passa lo si dice, e quelli già salvati restano
      for (const a of daInviare) {
        const r = await fetch('/api/grafica/voto', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voto: risposte[a].voto, commento: risposte[a].commento, pagina, argomento: a }) })
        if (!r.ok) throw new Error()
      }
      setStato('fatto')
      setTimeout(fine, uscita ? 1100 : 1600)
    } catch { setStato('errore') }
  }

  return (
    <div className="sv-velo" onClick={chiudi}>
      <div className="sv" role="dialog" aria-modal="true" aria-labelledby="sv-titolo" onClick={e => e.stopPropagation()}>
        {stato === 'fatto' ? (
          <div className="sv-grazie">
            <b>Grazie!</b>
            <span>{daInviare.length > 1 ? 'I tuoi voti sono salvati.' : 'Il tuo voto è salvato.'} Puoi cambiarli quando vuoi.</span>
          </div>
        ) : <>
          <h2 id="sv-titolo">{uscita ? 'Prima di tornare: ti è piaciuta?' : 'La tua opinione'}</h2>
          <p>{TUTTI.length} domande, un voto da 1 a 5 per ciascuna e, se vuoi, cosa cambieresti. Ci aiuta a decidere cosa
            sistemare prima di passare tutti alla nuova versione.{giaVotato && ' Hai già votato: puoi cambiare i tuoi voti.'}</p>
          {ordine.map((a, i) => (
            <fieldset key={a} className="sv-domanda">
              <legend><span className="sv-n">{i + 1}</span>{ARGOMENTI[a].domanda}{a !== 'versione' && <em> facoltativa</em>}</legend>
              <div className="sv-voti" role="radiogroup" aria-label={`${ARGOMENTI[a].nome}: voto da 1 a 5`}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" role="radio" aria-checked={risposte[a].voto === n}
                    className={risposte[a].voto === n ? 'sv-su' : risposte[a].voto > n ? 'sv-prima' : undefined} onClick={() => metti(a, { voto: n })}>
                    <b>{n}</b><span>{DICITURE[n]}</span>
                  </button>
                ))}
              </div>
              <label className="sv-campo">
                <span>Cosa manca o cosa cambieresti? <em>facoltativo</em></span>
                <textarea value={risposte[a].commento} maxLength={2000} rows={2} onChange={e => metti(a, { commento: e.target.value })}
                  placeholder="Per esempio: mi manca…, non trovo…, mi piacerebbe…" />
              </label>
            </fieldset>
          ))}
          {!pronto && <div className="sv-manca">Per inviare serve almeno il voto alla domanda {ordine.indexOf('versione') + 1}, sulla nuova MoovExpress.</div>}
          {stato === 'errore' && <div className="sv-errore">Non sono riuscito a salvare tutti i voti. Riprova fra un attimo.</div>}
          <div className="sv-piede">
            <button type="button" className="sv-secondario" onClick={uscita ? torna : chiudi}>{uscita ? 'Torna senza votare' : 'Chiudi'}</button>
            <button type="button" className="sv-primario" disabled={!pronto || stato === 'invio'} onClick={invia}>
              {stato === 'invio' ? 'Salvo…' : uscita ? 'Vota e torna' : daInviare.length > 1 ? 'Invia i voti' : 'Invia il voto'}
            </button>
          </div>
        </>}
      </div>
    </div>
  )
}
