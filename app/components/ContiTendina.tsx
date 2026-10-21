'use client'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// I CONTI DEL MASTER IN INTESTAZIONE, quando sono piu' d'uno. Una tendina sola invece di una pillola per
// conto (Lorenzo, 21/10: "gia' a 2 scatta la tendina"): Wave ne ha sei, QUICK venti. Dentro ci sono gli
// stessi conti della Lista Movimenti, divisi fra quelli da ricaricare (se finiscono, le spedizioni su quei
// contratti si fermano) e quelli dei contratti propri (il costo del corriere, che il master paga da se').
// Ogni riga apre la sua sezione in Lista Movimenti. Stesso modello di MenuProfilo: pannello disegnato
// fuori dall'intestazione, che altrimenti lo ritaglierebbe.

type Sezione = {
  id: string; tipo: 'rete' | 'fornitore' | 'proprio' | 'commissioni'
  etichetta: string; titolo: string; sottotitolo: string; saldo: number; movimenti: number | null
}

const eur = (n: number) => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ContiTendina({ conti, compatto = false }: { conti: number; compatto?: boolean }) {
  const [aperto, setAperto] = useState(false)
  const [sezioni, setSezioni] = useState<Sezione[] | null>(null)
  const [errore, setErrore] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pannello = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [montato, setMontato] = useState(false)
  useEffect(() => { setMontato(true) }, [])

  // I saldi si leggono a ogni apertura: sono soldi, devono essere quelli di adesso.
  useEffect(() => {
    if (!aperto) return
    let annulla = false
    setErrore(false)
    fetch('/api/master/credito?dettaglio=1').then(r => r.json())
      .then(d => { if (!annulla) { if (Array.isArray(d?.sezioni)) setSezioni(d.sezioni); else setErrore(true) } })
      .catch(() => { if (!annulla) setErrore(true) })
    return () => { annulla = true }
  }, [aperto])

  useEffect(() => {
    if (!aperto) return
    const fuori = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || pannello.current?.contains(t)) return
      setAperto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAperto(false) }
    document.addEventListener('mousedown', fuori)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuori); document.removeEventListener('keydown', esc) }
  }, [aperto])

  useLayoutEffect(() => {
    if (!aperto) { setPos(null); return }
    const misura = () => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }
    misura()
    window.addEventListener('scroll', misura, true)
    window.addEventListener('resize', misura)
    return () => { window.removeEventListener('scroll', misura, true); window.removeEventListener('resize', misura) }
  }, [aperto])

  const gruppi: { titolo: string; nota?: string; righe: Sezione[] }[] = sezioni ? [
    { titolo: 'Da ricaricare', righe: sezioni.filter(s => s.tipo === 'rete' || s.tipo === 'fornitore') },
    { titolo: 'Contratti tuoi', nota: 'li paghi tu al corriere', righe: sezioni.filter(s => s.tipo === 'proprio') },
    { titolo: 'MoovExpress', righe: sezioni.filter(s => s.tipo === 'commissioni') },
  ].filter(g => g.righe.length) : []

  const colore = (s: Sezione) => s.saldo < 0 ? (s.tipo === 'commissioni' ? '#b45309' : '#dc2626') : '#16a34a'

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button onClick={() => setAperto(a => !a)} aria-haspopup="menu" aria-expanded={aperto}
        title="I tuoi conti: saldi e movimenti"
        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: aperto ? '#faf7f4' : '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '5px 10px' }}>
        <span style={{ fontSize: '13px' }}>💳</span>
        {!compatto && <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: '#6b7280' }}>I tuoi conti</span>}
        <span style={{ fontSize: '12px', fontWeight: 800, color: '#1a1a1a' }}>{conti}</span>
        <span style={{ fontSize: '10px', color: '#bbb', transition: 'transform .15s', transform: aperto ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {aperto && montato && pos && createPortal(
        <div ref={pannello} role="menu" style={{
          position: 'fixed', top: pos.top, right: pos.right, width: 'min(360px, calc(100vw - 16px))', maxHeight: '70vh', overflowY: 'auto',
          background: '#fff', border: '1px solid #eee', borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 1000000,
        }}>
          {!sezioni && !errore && <div style={{ padding: '16px', fontSize: '13px', color: '#999' }}>Caricamento…</div>}
          {errore && <div style={{ padding: '16px', fontSize: '13px', color: '#b91c1c' }}>Saldi non caricati, riprova.</div>}
          {gruppi.map(g => (
            <div key={g.titolo} style={{ borderBottom: '1px solid #f2f2f2', padding: '6px 0' }}>
              <div style={{ padding: '6px 14px 4px', fontSize: '10.5px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {g.titolo}{g.nota ? <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}> · {g.nota}</span> : null}
              </div>
              {g.righe.map(s => (
                <a key={s.id} href={`/dashboard/movimenti?sezione=${encodeURIComponent(s.id)}`} role="menuitem"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '7px 14px', textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f7')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1a1a1a', overflowWrap: 'anywhere' }}>{s.titolo}</span>
                    {s.tipo === 'fornitore' && <span style={{ display: 'block', fontSize: '11.5px', color: '#999' }}>{s.sottotitolo}</span>}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: colore(s), whiteSpace: 'nowrap' }}>{eur(s.saldo)}</span>
                </a>
              ))}
            </div>
          ))}
          <a href="/dashboard/movimenti" role="menuitem" style={{ display: 'block', padding: '10px 14px', fontSize: '12.5px', fontWeight: 600, color: '#ea580c', textDecoration: 'none', textAlign: 'right' }}>
            Apri Lista Movimenti →
          </a>
        </div>, document.body)}
    </div>
  )
}
