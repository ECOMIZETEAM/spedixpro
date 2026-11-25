'use client'
// «RICORDAMELO» dal dettaglio di una spedizione (Lorenzo 25/11): un promemoria attaccato al pacco. Quando arriva,
// dal calendario si riapre la spedizione con un clic. La finestra va in fondo alla pagina (portale su body): il
// dettaglio, nella grafica nuova, è una tendina che entra con una trasformazione, e dentro una trasformazione un
// elemento «fixed» resterebbe chiuso nella tendina invece di coprire la pagina.
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { GraficaNuova } from '../grafica/contesto'
import { salvaMio } from './deposito'
import { componi, valoreData, valoreOra, piuGiorni, quandoRelativo, ora, giornoSettimana } from './date'
import Ic from './icone'
import './calendario.css'

type Scelta = { k: string; l: string; d: Date }

function scelte(adesso: Date): Scelta[] {
  const a = (g: number, h: number) => { const d = piuGiorni(adesso, g); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0) }
  const out: Scelta[] = []
  if (adesso.getHours() < 16) out.push({ k: 'oggi', l: 'Oggi alle 17', d: a(0, 17) })
  out.push({ k: 'domani', l: 'Domani alle 9', d: a(1, 9) })
  // lunedì prossimo (se oggi è lunedì, quello della settimana dopo)
  const alLunedi = 7 - giornoSettimana(adesso)
  if (alLunedi > 1) out.push({ k: 'lunedi', l: 'Lunedì alle 9', d: a(alLunedi, 9) })
  out.push({ k: 'settimana', l: 'Fra una settimana', d: a(7, 9) })
  return out
}

export default function Ricordamelo({ s, stile, classe, nuova }: { s: any; stile?: React.CSSProperties; classe?: string; nuova?: boolean }) {
  const [aperta, setAperta] = useState(false)
  return (
    <>
      <button className={classe} style={stile} onClick={() => setAperta(true)} title="Aggiungi un promemoria su questa spedizione nel calendario">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'inline-block', verticalAlign: '-3px', marginRight: nuova ? 0 : 6 }}>
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2.2 2.2 0 0 0 4 0" />
        </svg>
        Ricordamelo
      </button>
      {aperta && <FinestraRicordamelo s={s} onChiudi={() => setAperta(false)} />}
    </>
  )
}

function FinestraRicordamelo({ s, onChiudi }: { s: any; onChiudi: () => void }) {
  const grafica = useContext(GraficaNuova)
  const notte = grafica.attiva && grafica.luce === 'notte'
  const percorso = usePathname() || ''
  const hrefCalendario = percorso.startsWith('/cliente') ? '/cliente/calendario' : '/dashboard/calendario'
  const adesso = useMemo(() => new Date(), [])
  const opzioni = useMemo(() => scelte(adesso), [adesso])
  const numero = String(s?.numero || s?.tracking_number || '').trim()
  const etichetta = [numero, s?.dest_nome].filter(Boolean).join(' · ') || 'Spedizione'
  const [scelta, setScelta] = useState<string>(opzioni[0].k)
  const [data, setData] = useState(valoreData(piuGiorni(adesso, 1)))
  const [oraT, setOraT] = useState('09:00')
  const [titolo, setTitolo] = useState(`Ricontrolla ${numero || 'la spedizione'}${s?.dest_nome ? ' · ' + s.dest_nome : ''}`)
  const [note, setNote] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState('')
  const [fatto, setFatto] = useState<Date | null>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const tasto = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onChiudi() } }
    window.addEventListener('keydown', tasto, true)
    return () => window.removeEventListener('keydown', tasto, true)
  }, [onChiudi])

  const quando = scelta === 'altro' ? componi(data, oraT) : opzioni.find(o => o.k === scelta)!.d

  async function salva() {
    if (!s?.id) { setErrore('Spedizione non ancora caricata'); return }
    if (!titolo.trim()) { setErrore('Scrivi cosa ricordare'); return }
    if (quando.getTime() < Date.now() - 60000) { setErrore('Questo momento è già passato'); return }
    setSalvando(true); setErrore('')
    try {
      await salvaMio({
        tipo: 'promemoria', titolo: titolo.trim(), inizio: quando.toISOString(), fine: null, tutto_il_giorno: false,
        luogo: null, note: note.trim() || null, avviso_minuti: 0,
        collegamento: { tipo: 'spedizione', id: String(s.id), etichetta },
      })
      setFatto(quando)
    } catch (e: any) { setErrore(e?.message || 'Salvataggio non riuscito'); setSalvando(false) }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="cal" data-notte={notte ? '1' : undefined} onClick={e => e.stopPropagation()}>
      <div className="cal-velo" style={{ zIndex: 2000 }} onClick={onChiudi} />
      <div className="cal-finestra" style={{ zIndex: 2001, width: 'min(480px, calc(100vw - 24px))' }} role="dialog" aria-modal="true" aria-labelledby="cal-ric-titolo">
        <div className="cal-finestra-testa">
          <h2 id="cal-ric-titolo">{fatto ? 'Fatto' : 'Ricordamelo'}</h2>
          <button className="cal-tondo" onClick={onChiudi} aria-label="Chiudi"><Ic n="x" /></button>
        </div>
        {fatto ? (
          <>
            <div className="cal-finestra-corpo">
              <div className="cal-legame cal-t--promemoria" style={{ cursor: 'default' }}>
                <i><Ic n="campanella" /></i>
                <div><b>Te lo ricordo {quandoRelativo(fatto)} alle {ora(fatto)}</b><span>{titolo.trim()}</span></div>
              </div>
            </div>
            <div className="cal-finestra-piede">
              <span className="cal-spazio" />
              <a className="cal-tasto cal-tasto--chiaro" href={hrefCalendario}><Ic n="calendario" />Apri il calendario</a>
              <button className="cal-tasto cal-tasto--nero" onClick={onChiudi}>Chiudi</button>
            </div>
          </>
        ) : (
          <>
            <div className="cal-finestra-corpo">
              <div className="cal-legame" style={{ cursor: 'default' }}>
                <i><Ic n="pacco" /></i>
                <div><b>{etichetta}</b><span>Il promemoria resta attaccato a questa spedizione</span></div>
              </div>
              <div className="cal-campo">
                <span>Quando</span>
                <div className="cal-scelte" role="group" aria-label="Quando">
                  {opzioni.map(o => <button key={o.k} aria-pressed={scelta === o.k} onClick={() => setScelta(o.k)}>{o.l}</button>)}
                  <button aria-pressed={scelta === 'altro'} onClick={() => setScelta('altro')}>Scegli…</button>
                </div>
              </div>
              {scelta === 'altro' && (
                <div className="cal-campi cal-campi--due">
                  <label className="cal-campo"><span>Giorno</span><input type="date" value={data} min={valoreData(adesso)} onChange={e => setData(e.target.value)} /></label>
                  <label className="cal-campo"><span>Alle</span><input type="time" value={oraT} step={300} onChange={e => setOraT(e.target.value)} /></label>
                </div>
              )}
              <label className="cal-campo"><span>Cosa ricordare</span>
                <input value={titolo} maxLength={200} onChange={e => setTitolo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salva() } }} />
              </label>
              <label className="cal-campo"><span>Note</span>
                <textarea ref={campo} value={note} maxLength={4000} placeholder="Facoltative, es. «il destinatario richiama dopo le 15»" onChange={e => setNote(e.target.value)} />
              </label>
              {errore && <div className="cal-msg" role="alert">{errore}</div>}
            </div>
            <div className="cal-finestra-piede">
              <small>{quandoRelativo(quando)} alle {valoreOra(quando)}</small>
              <span className="cal-spazio" />
              <button className="cal-tasto cal-tasto--chiaro" onClick={onChiudi}>Annulla</button>
              <button className="cal-tasto cal-tasto--nero" onClick={salva} disabled={salvando}><Ic n="campanella" />{salvando ? 'Salvo…' : 'Ricordamelo'}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
