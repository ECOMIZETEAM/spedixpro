'use client'
import { useEffect, useRef, useState } from 'react'

// Le migliori stazioni (stream diretti mp3/aac, riproducibili in <audio>)
const STAZIONI = [
  { nome: 'RTL 102.5', url: 'https://streamingv2.shoutcast.com/rtl-1025' },
  { nome: 'Radio 105', url: 'https://icecast.unitedradio.it/Radio105.mp3' },
  { nome: 'Virgin Radio', url: 'https://icecast.unitedradio.it/Virgin.mp3' },
  { nome: 'R101', url: 'https://icecast.unitedradio.it/R101.mp3' },
  { nome: 'Radio Monte Carlo', url: 'https://icecast.unitedradio.it/RMC.mp3' },
  { nome: 'RDS', url: 'https://icstream.rds.radio/rds' },
  { nome: 'Radio Kiss Kiss', url: 'https://ice07.fluidstream.net/KissKiss.mp3' },
]

const K_VIS = 'spx_radio_visibile'
const K_STAZ = 'spx_radio_stazione'

export default function RadioWidget() {
  const [pronto, setPronto] = useState(false)   // evita mismatch SSR/localStorage
  const [visibile, setVisibile] = useState(true)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(false)
  const [vol, setVol] = useState(0.8)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    try {
      setVisibile(localStorage.getItem(K_VIS) !== '0')
      const s = parseInt(localStorage.getItem(K_STAZ) || '0', 10)
      if (!isNaN(s) && s >= 0 && s < STAZIONI.length) setIdx(s)
    } catch {}
    setPronto(true)
  }, [])

  function chiudi() {
    const a = audioRef.current; if (a) { a.pause() }
    setPlaying(false); setVisibile(false)
    try { localStorage.setItem(K_VIS, '0') } catch {}
  }
  function apri() {
    setVisibile(true)
    try { localStorage.setItem(K_VIS, '1') } catch {}
  }

  async function togglePlay() {
    const a = audioRef.current; if (!a) return
    if (playing) { a.pause(); setPlaying(false); return }
    setErrore(false); setLoading(true)
    a.src = STAZIONI[idx].url
    a.volume = vol
    try { await a.play(); setPlaying(true) } catch { setErrore(true); setPlaying(false); setLoading(false) }
  }

  function cambiaStazione(i: number) {
    setIdx(i)
    try { localStorage.setItem(K_STAZ, String(i)) } catch {}
    const a = audioRef.current
    if (a && playing) {
      setErrore(false); setLoading(true)
      a.src = STAZIONI[i].url; a.volume = vol
      a.play().then(() => setPlaying(true)).catch(() => { setErrore(true); setPlaying(false); setLoading(false) })
    }
  }

  if (!pronto) return null

  // Pillola per riaprire quando chiusa
  if (!visibile) {
    return (
      <button onClick={apri} title="Apri radio" style={{
        position: 'fixed', top: '58px', right: '18px', zIndex: 60,
        display: 'flex', alignItems: 'center', gap: '6px',
        background: '#1a1a1a', color: '#f97316', border: '1px solid rgba(249,115,22,0.4)',
        borderRadius: '20px', padding: '6px 12px', fontSize: '12px', fontWeight: 700,
        cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      }}>📻 Radio</button>
    )
  }

  const barre = [0, 1, 2, 3, 4]
  return (
    <div style={{
      position: 'fixed', top: '58px', right: '18px', zIndex: 60, width: '250px',
      background: 'linear-gradient(160deg,#1f2937 0%,#111827 100%)', color: '#fff',
      borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 30px rgba(0,0,0,0.35)', overflow: 'hidden',
      fontFamily: 'var(--font-geist-sans),system-ui,sans-serif',
    }}>
      <style>{`
        @keyframes spxbar { 0%,100%{transform:scaleY(0.35)} 50%{transform:scaleY(1)} }
        .spx-bar{ width:3px;height:16px;background:#f97316;border-radius:2px;transform-origin:bottom;
          animation:spxbar 0.9s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>📻</span>
          <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '.3px' }}>Radio</span>
        </div>
        <button onClick={chiudi} title="Nascondi radio" style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '16px', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>✕</button>
      </div>

      {/* Now playing + equalizzatore */}
      <div style={{ padding: '14px 12px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '46px', height: '46px', borderRadius: '10px', background: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '18px' }}>
            {barre.map(b => (
              <div key={b} className="spx-bar" style={{ animationDelay: `${b * 0.12}s`, animationPlayState: playing ? 'running' : 'paused', opacity: playing ? 1 : 0.4, background: '#fff' }} />
            ))}
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{STAZIONI[idx].nome}</div>
          <div style={{ fontSize: '11px', color: errore ? '#f87171' : '#9ca3af', marginTop: '2px' }}>
            {errore ? 'Stazione non disponibile' : loading ? 'Connessione…' : playing ? 'In riproduzione' : 'In pausa'}
          </div>
        </div>
        <button onClick={togglePlay} title={playing ? 'Pausa' : 'Riproduci'} style={{
          width: '40px', height: '40px', borderRadius: '50%', background: '#f97316', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{playing ? '❚❚' : '▶'}</button>
      </div>

      {/* Stazioni */}
      <div style={{ padding: '0 12px 10px' }}>
        <select value={idx} onChange={e => cambiaStazione(Number(e.target.value))}
          style={{ width: '100%', padding: '7px 9px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: '#0b1220', color: '#fff', fontSize: '12.5px', cursor: 'pointer' }}>
          {STAZIONI.map((s, i) => <option key={s.nome} value={i} style={{ color: '#111' }}>{s.nome}</option>)}
        </select>
      </div>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px 14px' }}>
        <span style={{ fontSize: '13px' }}>🔉</span>
        <input type="range" min={0} max={1} step={0.05} value={vol}
          onChange={e => { const v = Number(e.target.value); setVol(v); if (audioRef.current) audioRef.current.volume = v }}
          style={{ flex: 1, accentColor: '#f97316', cursor: 'pointer' }} />
      </div>

      <audio ref={audioRef} preload="none"
        onPlaying={() => { setLoading(false); setPlaying(true) }}
        onPause={() => setPlaying(false)}
        onError={() => { if (playing || loading) { setErrore(true); setLoading(false); setPlaying(false) } }} />
    </div>
  )
}
