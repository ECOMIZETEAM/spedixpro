'use client'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Menu del profilo: il blocco col nome in alto a destra ora APRE una tendina con le voci
// utili (impostazioni, abbonamento, password, esci). Prima era un <div> muto con una freccetta
// che non faceva niente.
const RUOLI: Record<string, string> = {
  master: 'Amministratore', admin: 'Amministratore', operatore: 'Operatore',
  agente: 'Agente', cliente: 'Cliente',
}

type Voce = { label: string; href: string; icona: string }

export default function MenuProfilo({ nome, ruolo, voci, compatto = false }: { nome?: string; ruolo?: string; voci: Voce[]; compatto?: boolean }) {
  const [aperto, setAperto] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pannello = useRef<HTMLDivElement>(null)
  // IL PANNELLO SI DISEGNA FUORI DAL RIQUADRO.
  // La topbar e le card ritagliano cio' che esce dai bordi (overflow hidden), e questa tendina
  // aperta dentro una di quelle veniva TAGLIATA. Disegnandola in fondo alla pagina e posizionandola
  // sul pulsante, nessun contenitore antenato la puo' piu' ritagliare. Stesso modello di SelectCercabile.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [montato, setMontato] = useState(false)
  useEffect(() => { setMontato(true) }, [])

  // Chiude cliccando fuori o con Esc: è un menu, non deve restare aperto sopra la pagina.
  // Il pannello ora è portato fuori dal box: il click al suo interno va escluso a parte, altrimenti
  // cliccare una voce chiuderebbe il menu prima di seguire il link.
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

  // La posizione si ricalcola all'apertura e mentre si scorre/ridimensiona: senza, il pannello
  // resterebbe fermo dov'era mentre la pagina scivola sotto. Resta ancorato a destra come prima
  // (il vecchio right:0 rispetto al pulsante).
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

  const iniziali = (nome || 'DA').substring(0, 2).toUpperCase()
  const r = (ruolo || '').toLowerCase()
  const ruoloBello = RUOLI[r] || 'Utente'

  const vociStile: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px',
    fontSize: '13px', color: '#333', textDecoration: 'none', whiteSpace: 'nowrap',
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        onClick={() => setAperto(a => !a)}
        aria-haspopup="menu" aria-expanded={aperto}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '4px 10px',
          borderRadius: '6px', border: '1px solid #e8e8e8', background: aperto ? '#faf7f4' : '#fff',
        }}
      >
        <span style={{ width: '26px', height: '26px', background: '#f97316', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '11px', color: '#fff' }}>
          {iniziali}
        </span>
        {!compatto && <span style={{ fontSize: '13px', fontWeight: 500, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>{nome || 'Admin'}</span>}
        <span style={{ fontSize: '10px', color: '#bbb', transition: 'transform .15s', transform: aperto ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {aperto && montato && pos && createPortal(
        <div ref={pannello} role="menu" style={{
          position: 'fixed', top: pos.top, right: pos.right, minWidth: '210px',
          background: '#fff', border: '1px solid #eee', borderRadius: '10px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 1000000,
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f2f2f2' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>{nome || 'Admin'}</div>
            <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{ruoloBello}</div>
          </div>
          {voci.map(v => (
            <a key={v.href} href={v.href} role="menuitem" style={vociStile}
              onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f7')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ width: '16px', textAlign: 'center', opacity: 0.7 }}>{v.icona}</span>
              {v.label}
            </a>
          ))}
          <div style={{ borderTop: '1px solid #f2f2f2' }}>
            <a href="/api/auth/logout" role="menuitem" style={{ ...vociStile, color: '#dc2626', fontWeight: 600 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ width: '16px', textAlign: 'center' }}>→</span>
              Esci
            </a>
          </div>
        </div>, document.body)}
    </div>
  )
}
