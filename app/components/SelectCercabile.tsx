'use client'
import { Children, isValidElement, useEffect, useMemo, useRef, useState } from 'react'

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
  [altro: string]: any
}

export default function SelectCercabile({ value, onChange, children, style, disabled, className, ...resto }: Props) {
  const opzioni = useMemo(() => raccogli(children), [children])
  const [aperto, setAperto] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aperto) return
    const fuori = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setAperto(false); setQ('') } }
    document.addEventListener('mousedown', fuori)
    return () => document.removeEventListener('mousedown', fuori)
  }, [aperto])

  // Poche voci: si resta sulla tendina di sempre. Nessuna differenza, nessun rischio.
  if (opzioni.length < SOGLIA) {
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

  return (
    <div ref={box} style={{ position: 'relative', ...(style?.width ? { width: style.width } : {}) }}>
      <button type="button" disabled={disabled} onClick={() => { if (!disabled) { setAperto(a => !a); setQ('') } }}
        style={{ ...style, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: disabled ? 0.6 : 1 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: scelta?.value ? '#1a1a1a' : '#9ca3af' }}>
          {scelta?.label || opzioni[0]?.label || ''}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '10px', flexShrink: 0 }}>▼</span>
      </button>

      {aperto && (
        <div style={{ position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', left: 0, minWidth: '100%', width: 'max-content', maxWidth: '420px', background: '#fff', border: '1px solid #d5d5d5', borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca…"
            onKeyDown={e => {
              if (e.key === 'Escape') { setAperto(false); setQ('') }
              // Invio con un solo risultato: si sceglie quello. E' il gesto piu' rapido —
              // tre lettere e via, senza toccare il mouse.
              if (e.key === 'Enter' && filtrate.length === 1) scegli(filtrate[0].value)
            }}
            style={{ width: '100%', padding: '9px 11px', fontSize: '13px', border: 'none', borderBottom: '1px solid #f0f0f0', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {filtrate.map((o, i) => {
              const sel = String(o.value) === String(value ?? '')
              return (
                <div key={`${o.value}-${i}`} onClick={() => !o.disabled && scegli(o.value)}
                  style={{ padding: '8px 11px', fontSize: '13px', cursor: o.disabled ? 'default' : 'pointer',
                    background: sel ? '#fff7ed' : undefined, color: o.disabled ? '#9ca3af' : '#1a1a1a',
                    fontWeight: sel ? 700 : 400, whiteSpace: 'nowrap' }}
                  onMouseEnter={e => { if (!sel && !o.disabled) (e.currentTarget as HTMLDivElement).style.background = '#f7f7f7' }}
                  onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLDivElement).style.background = '' }}>
                  {o.label}
                </div>
              )
            })}
            {!filtrate.length && <div style={{ padding: '14px', fontSize: '12.5px', color: '#9ca3af', textAlign: 'center' }}>Nessun risultato.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
