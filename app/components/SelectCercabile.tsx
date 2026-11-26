'use client'
import { Children, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GraficaNuova } from './grafica/contesto'
import { createPortal } from 'react-dom'

// UNA TENDINA CHE SI PUO' CERCARE.
//
// Con seicento clienti la tendina nativa e' inservibile: si scorre per venti secondi cercando un
// nome che si sa gia'. Questo componente si usa ESATTAMENTE come un <select> — stesse proprieta',
// stesse <option> dentro — cosi' sostituirlo nelle pagine e' un cambio di nome del tag e non una
// riscrittura. Trentuno pagine hanno una tendina clienti: riscriverle a mano una per una avrebbe
// significato trentuno occasioni di sbagliare.
//
// SOTTO UNA CERTA SOGLIA RESTA UNA TENDINA NORMALE, identica a prima. La ricerca serve dove c'e'
// da cercare: su cinque voci sarebbe solo un ostacolo in piu', e per quelle pagine il rischio di
// questo cambio e' esattamente zero.

type Opzione = { value: string; label: string; disabled?: boolean }

const SOGLIA = 8   // sotto questo numero di voci la tendina nativa va benissimo

function raccogli(children: any): Opzione[] {
  const out: Opzione[] = []
  const visita = (nodi: any) => {
    Children.forEach(nodi, (n: any) => {
      if (!isValidElement(n)) return
      const p: any = (n as any).props || {}
      if ((n as any).type === 'option') {
        const testo = typeof p.children === 'string' ? p.children
          : Array.isArray(p.children) ? p.children.filter((c: any) => typeof c === 'string' || typeof c === 'number').join('')
          : String(p.children ?? '')
        out.push({ value: String(p.value ?? testo), label: testo, disabled: !!p.disabled })
      } else if (p.children) visita(p.children)   // <optgroup> e simili
    })
  }
  visita(children)
  return out
}

// L'onChange e' TIPIZZATO come quello di un <select>: senza, nelle pagine il parametro `e` resta
// senza tipo e il compilatore si lamenta in ognuna delle ventinove. Il tipo e' la parte piu' utile
// del contratto: e' quello che rende la sostituzione davvero meccanica.
type Props = {
  value?: string | number | null
  onChange?: (e: { target: { value: string } }) => void
  children?: React.ReactNode
  style?: React.CSSProperties
  disabled?: boolean
  className?: string
  cercaSempre?: boolean   // forza la ricerca anche sotto la soglia di voci
  [altro: string]: any
}

export default function SelectCercabile({ value, onChange, children, style, disabled, className, cercaSempre, ...resto }: Props) {
  // sulle pagine col vestito comune la tendina si veste da sola (classe sc-tasto, colorata da vestito.css): senza, il
  // tasto restava bianco col bordo in mezzo ai campi grigi e il pannello bianco anche di notte
  const sulVestito = !!useContext(GraficaNuova).vestito
  const classe = className || (sulVestito ? 'sc-tasto' : undefined)
  const opzioni = useMemo(() => raccogli(children), [children])
  const [aperto, setAperto] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const pannello = useRef<HTMLDivElement>(null)
  // IL PANNELLO SI DISEGNA FUORI DAL RIQUADRO.
  // Le schede del portale nascondono cio' che esce dai bordi (overflow hidden), e una tendina
  // aperta dentro una di quelle veniva TAGLIATA a meta': si vedeva la casella di ricerca e un
  // nome, il resto no. Disegnandolo in fondo alla pagina e posizionandolo sul campo, nessun
  // contenitore lo puo' piu' ritagliare.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [montato, setMontato] = useState(false)
  useEffect(() => { setMontato(true) }, [])

  useEffect(() => {
    if (!aperto) return
    const fuori = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || pannello.current?.contains(t)) return
      setAperto(false); setQ('')
    }
    document.addEventListener('mousedown', fuori)
    return () => document.removeEventListener('mousedown', fuori)
  }, [aperto])

  // La posizione si ricalcola all'apertura e mentre si scorre: senza, il pannello resterebbe
  // fermo dov'era mentre la pagina scivola sotto.
  useLayoutEffect(() => {
    if (!aperto) { setPos(null); return }
    const misura = () => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      // Se sotto non c'e' spazio si apre VERSO L'ALTO: su uno schermo corto, o con il campo in
      // fondo alla pagina, altrimenti il pannello finisce fuori dallo schermo.
      const spazioSotto = window.innerHeight - r.bottom
      const alto = Math.min(320, Math.max(180, spazioSotto - 12))
      const versoAlto = spazioSotto < 220 && r.top > spazioSotto
      setPos({ top: versoAlto ? Math.max(8, r.top - alto - 4) : r.bottom + 4, left: r.left, width: r.width })
    }
    misura()
    window.addEventListener('scroll', misura, true)
    window.addEventListener('resize', misura)
    return () => { window.removeEventListener('scroll', misura, true); window.removeEventListener('resize', misura) }
  }, [aperto])

  // Poche voci: si resta sulla tendina di sempre. Nessuna differenza, nessun rischio.
  // `cercaSempre` forza la ricerca anche con poche voci (es. tendina agenti nei report: la si vuole
  // uguale a quella clienti anche se gli agenti sono 3).
  if (opzioni.length < SOGLIA && !cercaSempre) {
    // `null` non e' un valore ammesso da <select>: diventa stringa vuota, che e' il modo in cui
    // una tendina rappresenta "niente scelto".
    return <select value={value ?? ''} onChange={onChange} style={style} disabled={disabled} className={className} {...resto}>{children}</select>
  }

  const scelta = opzioni.find(o => String(o.value) === String(value ?? ''))
  const s = q.trim().toLowerCase()
  const filtrate = s ? opzioni.filter(o => o.label.toLowerCase().includes(s)) : opzioni

  function scegli(v: string) {
    setAperto(false); setQ('')
    // Si finge un evento di <select> perche' le pagine scrivono `e => setX(e.target.value)`:
    // cosi' la sostituzione non tocca i gestori.
    onChange?.({ target: { value: v } } as any)
  }

  // CON IL VESTITO (className) I COLORI LI DECIDE IL CSS, non lo stile in linea. Il 20/11 di notte la voce sotto il
  // mouse prendeva in linea lo sfondo chiaro #f7f7f7 mentre il vestito notte rendeva bianco il testo: bianco su bianco,
  // illeggibile (Lorenzo, «Spedisci per»). Uno stile in linea batte qualunque regola che non sia !important, e indovinarlo
  // dal CSS col selettore sull'attributo style e' fragile: cosi' la tendina vestita porta solo classi (sc-voce,
  // sc-voce--su, …) e il CSS le colora di giorno e di notte. Senza className il ramo di sotto e' quello di sempre.
  const vestita = !!classe

  return (
    <div ref={box} style={{ position: 'relative', ...(style?.width ? { width: style.width } : {}) }}>
      {/* className arriva solo dalla grafica nuova (Nuova spedizione su una pagina): veste il tasto e il pannello; senza,
          la tendina resta identica a oggi */}
      <button type="button" disabled={disabled} className={classe} onClick={() => { if (!disabled) { setAperto(a => !a); setQ('') } }}
        aria-haspopup="listbox" aria-expanded={aperto}
        style={{ ...style, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: disabled ? 0.6 : 1 }}>
        {vestita ? <>
          <span className={'sc-testo' + (scelta?.value ? '' : ' sc-testo--vuoto')}>{scelta?.label || opzioni[0]?.label || ''}</span>
          <span className="sc-freccia" aria-hidden="true">▼</span>
        </> : <>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: scelta?.value ? '#1a1a1a' : '#9ca3af' }}>
            {scelta?.label || opzioni[0]?.label || ''}
          </span>
          <span style={{ color: '#9ca3af', fontSize: '10px', flexShrink: 0 }}>▼</span>
        </>}
      </button>

      {aperto && montato && pos && createPortal(
        <div ref={pannello} className={vestita ? 'sc-pannello' : undefined}
          style={vestita
            ? { position: 'fixed', zIndex: 1000000, top: pos.top, left: pos.left, width: Math.max(pos.width, 240), maxWidth: 'calc(100vw - 16px)' }
            : { position: 'fixed', zIndex: 1000000, top: pos.top, left: pos.left, width: Math.max(pos.width, 240), maxWidth: 'calc(100vw - 16px)', background: '#fff', border: '1px solid #d5d5d5', borderRadius: '6px', boxShadow: '0 10px 30px rgba(0,0,0,.16)' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca…" className={vestita ? 'sc-cerca' : undefined}
            onKeyDown={e => {
              if (e.key === 'Escape') { setAperto(false); setQ('') }
              // Invio con un solo risultato: si sceglie quello. E' il gesto piu' rapido —
              // tre lettere e via, senza toccare il mouse.
              if (e.key === 'Enter' && filtrate.length === 1) scegli(filtrate[0].value)
            }}
            style={vestita ? undefined : { width: '100%', padding: '9px 11px', fontSize: '13px', border: 'none', borderBottom: '1px solid #f0f0f0', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
          <div role={vestita ? 'listbox' : undefined} className={vestita ? 'sc-voci' : undefined} style={vestita ? undefined : { maxHeight: '260px', overflowY: 'auto' }}>
            {filtrate.map((o, i) => {
              const sel = String(o.value) === String(value ?? '')
              if (vestita) return (
                <div key={`${o.value}-${i}`} role="option" aria-selected={sel} aria-disabled={o.disabled || undefined}
                  onClick={() => !o.disabled && scegli(o.value)}
                  className={'sc-voce' + (sel ? ' sc-voce--su' : '') + (o.disabled ? ' sc-voce--spenta' : '')}>
                  {o.label}
                </div>
              )
              return (
                <div key={`${o.value}-${i}`} onClick={() => !o.disabled && scegli(o.value)}
                  style={{ padding: '8px 11px', fontSize: '13px', cursor: o.disabled ? 'default' : 'pointer',
                    background: sel ? '#fff7ed' : undefined, color: o.disabled ? '#9ca3af' : '#1a1a1a',
                    fontWeight: sel ? 700 : 400, wordBreak: 'break-word' }}
                  onMouseEnter={e => { if (!sel && !o.disabled) (e.currentTarget as HTMLDivElement).style.background = '#f7f7f7' }}
                  onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLDivElement).style.background = '' }}>
                  {o.label}
                </div>
              )
            })}
            {!filtrate.length && (vestita
              ? <div className="sc-vuoto">Nessun risultato.</div>
              : <div style={{ padding: '14px', fontSize: '12.5px', color: '#9ca3af', textAlign: 'center' }}>Nessun risultato.</div>)}
          </div>
        </div>, document.body)}
    </div>
  )
}
