'use client'
// Il voto sulla nuova versione (Lorenzo 19/11: «un sondaggio per chi approva e chi no… voto più commento»). Un voto da
// 1 a 5 e, se si vuole, cosa cambiare. Uno per persona: si può cambiare, l'ultimo vale. Si apre da «Lascia il tuo voto»
// o da «Torna alla versione attuale»: in quel caso, votato o no, si torna poi alla pagina di oggi (senza «?nuova=1»).
import { useEffect, useRef, useState } from 'react'

const DICITURE = ['', 'Per niente', 'Poco', 'Così così', 'Mi piace', 'Moltissimo']

export default function Sondaggio({ pagina, uscita, chiudi }: { pagina: string; uscita: boolean; chiudi: () => void }) {
  const [voto, setVoto] = useState(0)
  const [commento, setCommento] = useState('')
  const [stato, setStato] = useState<'' | 'invio' | 'fatto' | 'errore'>('')
  const [giaVotato, setGiaVotato] = useState(false)

  const torna = () => { window.location.href = window.location.pathname }
  // chiudi arriva nuovo a ogni disegno della cornice: tenuto in un riferimento, il voto salvato si legge UNA volta sola
  // (altrimenti a ogni aggiornamento dei conteggi si cancellava la scelta appena fatta)
  const chiudiRif = useRef(chiudi); chiudiRif.current = chiudi
  const fine = () => (uscita ? torna() : chiudi())

  useEffect(() => {
    let vivo = true
    fetch('/api/grafica/voto', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
      if (!vivo || !d?.voto) return
      setVoto(d.voto); setCommento(d.commento || ''); setGiaVotato(true)
    }).catch(() => {})
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudiRif.current() }
    window.addEventListener('keydown', esc)
    return () => { vivo = false; window.removeEventListener('keydown', esc) }
  }, [])

  const invia = async () => {
    if (!voto || stato === 'invio') return
    setStato('invio')
    try {
      const r = await fetch('/api/grafica/voto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voto, commento, pagina }) })
      if (!r.ok) throw new Error()
      setStato('fatto')
      setTimeout(fine, uscita ? 900 : 1400)
    } catch { setStato('errore') }
  }

  return (
    <div className="sv-velo" onClick={chiudi}>
      <div className="sv" role="dialog" aria-modal="true" aria-labelledby="sv-titolo" onClick={e => e.stopPropagation()}>
        {stato === 'fatto' ? (
          <div className="sv-grazie">
            <b>Grazie!</b>
            <span>Il tuo voto è salvato. Puoi cambiarlo quando vuoi.</span>
          </div>
        ) : <>
          <h2 id="sv-titolo">{uscita ? 'Prima di tornare: ti è piaciuta?' : 'Ti piace la nuova MoovExpress?'}</h2>
          <p>Un voto da 1 a 5 e, se vuoi, cosa cambieresti. Ci aiuta a decidere cosa sistemare prima di passare tutti alla nuova versione.{giaVotato && ' Hai già votato: puoi cambiare il tuo voto.'}</p>
          <div className="sv-voti" role="radiogroup" aria-label="Voto da 1 a 5">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={voto === n} className={voto === n ? 'sv-su' : voto > n ? 'sv-prima' : undefined} onClick={() => setVoto(n)}>
                <b>{n}</b><span>{DICITURE[n]}</span>
              </button>
            ))}
          </div>
          <label className="sv-campo">
            <span>Cosa manca o cosa cambieresti? <em>facoltativo</em></span>
            <textarea value={commento} maxLength={2000} rows={3} onChange={e => setCommento(e.target.value)} placeholder="Per esempio: mi manca…, non trovo…, mi piacerebbe…" />
          </label>
          {stato === 'errore' && <div className="sv-errore">Non sono riuscito a salvare il voto. Riprova fra un attimo.</div>}
          <div className="sv-piede">
            <button type="button" className="sv-secondario" onClick={uscita ? torna : chiudi}>{uscita ? 'Torna senza votare' : 'Chiudi'}</button>
            <button type="button" className="sv-primario" disabled={!voto || stato === 'invio'} onClick={invia}>
              {stato === 'invio' ? 'Salvo…' : uscita ? 'Vota e torna' : 'Invia il voto'}
            </button>
          </div>
        </>}
      </div>
    </div>
  )
}
