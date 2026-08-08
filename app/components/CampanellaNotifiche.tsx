'use client'
import { useState, useEffect, useRef } from 'react'

// La campanella ora PORTA alle notifiche davvero: legge /api/notifiche/mie (gli annunci destinati
// al gruppo dell'utente), mostra un pallino con il numero di NON lette, e aprendola le elenca.
// Prima era un'icona muta con un pallino finto disegnato a mano.
type Notifica = { id: string; oggetto: string; messaggio: string; created_at: string; link?: string | null }

const VISTE_KEY = 'spx_notifiche_viste'   // ricorda l'ultima notifica vista (per contare le nuove)

function quando(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function CampanellaNotifiche() {
  const [aperto, setAperto] = useState(false)
  const [lista, setLista] = useState<Notifica[]>([])
  const [vistoAl, setVistoAl] = useState<string>('')   // created_at dell'ultima vista
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { try { setVistoAl(localStorage.getItem(VISTE_KEY) || '') } catch {} }, [])

  const carica = () => {
    fetch('/api/notifiche/mie').then(r => r.json())
      .then(d => setLista(Array.isArray(d) ? d : []))
      .catch(() => {})
  }
  // Carico all'avvio e ogni tanto, solo a scheda visibile (come il badge assistenza).
  useEffect(() => {
    carica()
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica() }, 60000)
    return () => clearInterval(t)
  }, [])

  // Chiude cliccando fuori / con Esc.
  useEffect(() => {
    if (!aperto) return
    const fuori = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setAperto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAperto(false) }
    document.addEventListener('mousedown', fuori)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuori); document.removeEventListener('keydown', esc) }
  }, [aperto])

  const nonLette = lista.filter(n => !vistoAl || n.created_at > vistoAl).length

  const apri = () => {
    setAperto(a => {
      const prossimo = !a
      // All'apertura segno viste (l'ultima in cima è la più recente): il pallino sparisce.
      if (prossimo && lista[0]) { try { localStorage.setItem(VISTE_KEY, lista[0].created_at) } catch {}; setVistoAl(lista[0].created_at) }
      return prossimo
    })
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button onClick={apri} aria-label="Notifiche" aria-expanded={aperto} title="Notifiche"
        style={{ position: 'relative', background: aperto ? '#faf7f4' : 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: '8px', lineHeight: 1 }}>
        <span style={{ fontSize: '18px' }}>🔔</span>
        {nonLette > 0 && (
          <span style={{
            position: 'absolute', top: '-1px', right: '-1px', minWidth: '16px', height: '16px', padding: '0 3px',
            background: '#f97316', color: '#fff', fontSize: '10px', fontWeight: 700, borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', boxSizing: 'content-box',
          }}>{nonLette > 9 ? '9+' : nonLette}</span>
        )}
      </button>

      {aperto && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: '340px', maxWidth: '90vw',
          background: '#fff', border: '1px solid #eee', borderRadius: '12px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 50,
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f2f2f2', fontWeight: 700, fontSize: '14px', color: '#1a1a1a' }}>
            Notifiche
          </div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {lista.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
                Nessuna notifica.
              </div>
            ) : lista.map(n => {
              const contenuto = (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a1a1a' }}>{n.oggetto}</div>
                    <div style={{ fontSize: '11px', color: '#bbb', whiteSpace: 'nowrap' }}>{quando(n.created_at)}</div>
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#666', marginTop: '4px', lineHeight: 1.45 }}
                    dangerouslySetInnerHTML={{ __html: n.messaggio || '' }} />
                </>
              )
              const base: React.CSSProperties = { display: 'block', padding: '12px 16px', borderBottom: '1px solid #f5f5f5', textDecoration: 'none' }
              // Se la notifica ha un link (es. la spedizione, la giacenza) la card ci porta.
              return n.link
                ? <a key={n.id} href={n.link} onClick={() => setAperto(false)} style={{ ...base, cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#faf7f4')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{contenuto}</a>
                : <div key={n.id} style={base}>{contenuto}</div>
            })}
          </div>
        </div>
      )}
    </div>
  )
}
