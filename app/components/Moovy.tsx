'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

// MOOVY — assistente AI di MoovExpress. Widget fluttuante presente in entrambi i
// portali (master e cliente). L'API /api/moovy determina ruolo e contesto dalla
// sessione: qui gestiamo solo la chat e lo streaming della risposta.

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGERIMENTI = [
  'Come creo una nuova spedizione?',
  'Come scarico l\'etichetta?',
  'Come funziona il credito?',
  'Come importo gli ordini dal negozio?',
]

const ARANCIO = '#f97316'

// Formattazione leggera: **grassetto** e a capo. Niente HTML esterno (sicuro).
function renderTesto(t: string) {
  const parti = t.split(/(\*\*[^*]+\*\*)/g)
  return parti.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

export default function Moovy() {
  const [open, setOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Ciao! Sono **MOOVY**, il tuo assistente. Chiedimi come funziona qualsiasi cosa dell\'app e ti guido passo passo. 🚚' },
  ])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Modalità VOCE (Fase 1) ──
  const [inCall, setInCall] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [pending, setPending] = useState<any>(null)     // azione in attesa di conferma
  const [voceMsg, setVoceMsg] = useState<Msg[]>([])
  const [supportata, setSupportata] = useState(true)
  const recRef = useRef<any>(null)
  const inCallRef = useRef(false)
  const pendingRef = useRef<any>(null)
  const voceMsgRef = useRef<Msg[]>([])
  useEffect(() => { pendingRef.current = pending }, [pending])
  useEffect(() => { voceMsgRef.current = voceMsg }, [voceMsg])

  useEffect(() => {
    const SR = (typeof window !== 'undefined') && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    if (!SR) setSupportata(false)
  }, [])

  const parla = useCallback((testo: string, poi?: () => void) => {
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(testo.replace(/\*\*/g, ''))
      u.lang = 'it-IT'; u.rate = 1.05
      u.onstart = () => setSpeaking(true)
      u.onend = () => { setSpeaking(false); poi?.() }
      u.onerror = () => { setSpeaking(false); poi?.() }
      window.speechSynthesis.speak(u)
    } catch { poi?.() }
  }, [])

  const ascolta = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR || !inCallRef.current) return
    try {
      const rec = new SR(); recRef.current = rec
      rec.lang = 'it-IT'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false
      rec.onstart = () => setListening(true)
      rec.onend = () => setListening(false)
      rec.onerror = () => setListening(false)
      rec.onresult = (e: any) => {
        const t = e.results?.[0]?.[0]?.transcript?.trim()
        setListening(false)
        if (t) gestisciVoce(t)
      }
      rec.start()
    } catch { setListening(false) }
  }, [])  // eslint-disable-line

  const eseguiConferma = useCallback(async (az: any) => {
    setPending(null)
    try {
      const res = await fetch('/api/moovy/esegui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingAction: az }) })
      const d = await res.json().catch(() => ({}))
      const reply = d.reply || (d.ok ? 'Fatto.' : 'Non sono riuscito.')
      setVoceMsg(prev => [...prev, { role: 'assistant', content: reply }])
      parla(reply, () => ascolta())
    } catch { parla('Ho avuto un problema eseguendo l\'azione.', () => ascolta()) }
  }, [parla, ascolta])

  const gestisciVoce = useCallback(async (testo: string) => {
    setVoceMsg(prev => [...prev, { role: 'user', content: testo }])
    // Se c'è un'azione in attesa: interpreto sì/no vocale
    const pa = pendingRef.current
    if (pa) {
      const s = testo.toLowerCase()
      if (/\b(s[iì]|certo|conferm|ok|va bene|procedi|esegui)\b/.test(s)) { eseguiConferma(pa); return }
      if (/\b(no|annull|lascia|ferma|niente)\b/.test(s)) { setPending(null); const r = 'Ok, annullato.'; setVoceMsg(prev => [...prev, { role: 'assistant', content: r }]); parla(r, () => ascolta()); return }
      // non chiaro: ripeto la domanda
      parla('Non ho capito. Confermi? Dì sì oppure no.', () => ascolta()); return
    }
    try {
      const res = await fetch('/api/moovy/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...voceMsgRef.current, { role: 'user', content: testo }].filter(m => m.content) }) })
      const d = await res.json().catch(() => ({}))
      const reply = d.reply || 'Non ho capito.'
      setVoceMsg(prev => [...prev, { role: 'assistant', content: reply }])
      if (d.pendingAction) { setPending(d.pendingAction); parla(reply) }   // aspetta conferma (vocale o pulsante)
      else parla(reply, () => ascolta())
    } catch { parla('Ho avuto un problema. Riprova.', () => ascolta()) }
  }, [eseguiConferma, parla, ascolta])

  const avviaCall = useCallback(() => {
    if (!supportata) return
    setInCall(true); inCallRef.current = true; setPending(null)
    setVoceMsg([{ role: 'assistant', content: 'Ciao, sono Moovy. Dimmi pure.' }])
    parla('Ciao, sono Moovy. Dimmi pure.', () => ascolta())
  }, [supportata, parla, ascolta])

  const chiudiCall = useCallback(() => {
    inCallRef.current = false; setInCall(false); setListening(false); setPending(null)
    try { window.speechSynthesis.cancel() } catch {}
    try { recRef.current?.stop() } catch {}
  }, [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  useEffect(() => { if (open && !isMobile) inputRef.current?.focus() }, [open, isMobile])

  const invia = useCallback(async (testo: string) => {
    const t = testo.trim()
    if (!t || loading) return
    setInput('')
    const nuova: Msg[] = [...messages, { role: 'user', content: t }, { role: 'assistant', content: '' }]
    setMessages(nuova)
    setLoading(true)
    try {
      const res = await fetch('/api/moovy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nuova.slice(0, -1).filter(m => m.content) }),
      })
      if (!res.ok || !res.body) throw new Error('no body')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += dec.decode(value, { stream: true })
        setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: acc }; return c })
      }
      if (!acc) throw new Error('empty')
    } catch {
      setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: 'Mi dispiace, non sono riuscito a rispondere. Riprova tra poco.' }; return c }) }
    finally { setLoading(false) }
  }, [messages, loading])

  const panelStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', inset: 0, width: '100%', height: '100%', borderRadius: 0, zIndex: 1300 }
    : { position: 'fixed', bottom: '90px', right: '24px', width: '370px', height: '560px', maxHeight: 'calc(100vh - 120px)', borderRadius: '16px', zIndex: 1300 }

  return (
    <>
      {/* Pulsante fluttuante */}
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Apri MOOVY"
          style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 1250, width: '58px', height: '58px', borderRadius: '50%', border: 'none', background: ARANCIO, color: '#fff', cursor: 'pointer', boxShadow: '0 8px 24px rgba(249,115,22,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', transition: 'transform .15s' }}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.94)')}
          onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
          💬
        </button>
      )}

      {open && (
        <div style={{ ...panelStyle, background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #eee' }}>
          {/* Header */}
          <div style={{ background: '#1a1a1a', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: ARANCIO, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🤖</div>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: '15px', lineHeight: 1 }}>MOOVY</div>
                <div style={{ color: '#9ca3af', fontSize: '10.5px', marginTop: '3px' }}>Assistente MoovExpress</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {supportata && !inCall && (
                <button onClick={avviaCall} aria-label="Chiama Moovy" title="Parla con Moovy"
                  style={{ background: ARANCIO, border: 'none', color: '#fff', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📞</button>
              )}
              <button onClick={() => { chiudiCall(); setOpen(false) }} aria-label="Chiudi" style={{ background: 'none', border: 'none', color: '#fff', fontSize: '22px', cursor: 'pointer', lineHeight: 1, padding: '2px 6px' }}>×</button>
            </div>
          </div>

          {/* Overlay CHIAMATA vocale */}
          {inCall && (
            <div style={{ position: 'absolute', inset: 0, top: '62px', background: '#0f0f10', zIndex: 5, display: 'flex', flexDirection: 'column', color: '#fff' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {voceMsg.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '9px 12px', borderRadius: '12px', fontSize: '13.5px', lineHeight: 1.45, background: m.role === 'user' ? ARANCIO : '#26262b', color: '#fff' }}>{m.content}</div>
                ))}
              </div>
              {/* Stato + mic */}
              <div style={{ padding: '18px', textAlign: 'center', borderTop: '1px solid #26262b' }}>
                <div style={{ fontSize: '12.5px', color: '#9ca3af', marginBottom: '12px' }}>
                  {speaking ? 'Moovy sta parlando…' : listening ? 'Ti ascolto…' : pending ? 'In attesa di conferma' : 'In pausa'}
                </div>
                {pending ? (
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button onClick={() => eseguiConferma(pending)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', padding: '11px 22px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>✓ Conferma</button>
                    <button onClick={() => { setPending(null); const r = 'Ok, annullato.'; setVoceMsg(prev => [...prev, { role: 'assistant', content: r }]); parla(r, () => ascolta()) }} style={{ background: '#3f3f46', color: '#fff', border: 'none', borderRadius: '10px', padding: '11px 22px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>✕ Annulla</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', alignItems: 'center' }}>
                    <button onClick={() => (listening ? recRef.current?.stop() : ascolta())} disabled={speaking}
                      style={{ width: '64px', height: '64px', borderRadius: '50%', border: 'none', background: listening ? '#dc2626' : ARANCIO, color: '#fff', fontSize: '26px', cursor: speaking ? 'default' : 'pointer', boxShadow: listening ? '0 0 0 6px rgba(220,38,38,0.25)' : '0 0 0 6px rgba(249,115,22,0.2)', transition: 'all .2s' }}>🎤</button>
                    <button onClick={chiudiCall} style={{ width: '52px', height: '52px', borderRadius: '50%', border: 'none', background: '#3f3f46', color: '#fff', fontSize: '20px', cursor: 'pointer' }} title="Termina">📵</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Messaggi */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', background: '#f7f7f8', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <div style={{
                  padding: '10px 13px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: m.role === 'user' ? ARANCIO : '#fff', color: m.role === 'user' ? '#fff' : '#1a1a1a',
                  fontSize: '13.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  border: m.role === 'user' ? 'none' : '1px solid #ececec', boxShadow: m.role === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
                }}>
                  {m.content ? renderTesto(m.content) : <span style={{ color: '#bbb' }}>MOOVY sta scrivendo…</span>}
                </div>
              </div>
            ))}
            {messages.length <= 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                {SUGGERIMENTI.map((s, i) => (
                  <button key={i} onClick={() => invia(s)} disabled={loading}
                    style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '16px', padding: '7px 12px', fontSize: '12px', color: '#1a1a1a', cursor: 'pointer', textAlign: 'left' }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid #eee', background: '#fff', display: 'flex', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invia(input) } }}
              placeholder="Scrivi la tua domanda…" rows={1}
              style={{ flex: 1, resize: 'none', maxHeight: '96px', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: '10px', fontSize: '13.5px', color: '#1a1a1a', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }} />
            <button onClick={() => invia(input)} disabled={loading || !input.trim()} aria-label="Invia"
              style={{ width: '38px', height: '38px', borderRadius: '10px', border: 'none', background: loading || !input.trim() ? '#e5e7eb' : ARANCIO, color: '#fff', cursor: loading || !input.trim() ? 'default' : 'pointer', fontSize: '17px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  )
}
