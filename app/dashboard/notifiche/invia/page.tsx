'use client'
import { useState, useRef } from 'react'

const GRUPPI = ['Cliente', 'Amministratore', 'Operatore', 'Agente']

export default function InviaNotifica() {
  const [oggetto, setOggetto] = useState('')
  const [gruppi, setGruppi] = useState<string[]>([])
  const [inviando, setInviando] = useState(false)
  const [msg, setMsg] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)

  function toggleGruppo(g: string) {
    setGruppi(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  function format(cmd: string, val?: string) {
    document.execCommand(cmd, false, val)
    editorRef.current?.focus()
  }

  async function invia() {
    const messaggio = editorRef.current?.innerHTML || ''
    if (!oggetto.trim()) { setMsg('Inserisci un oggetto'); return }
    if (!gruppi.length) { setMsg('Seleziona almeno un gruppo di utenti'); return }
    setInviando(true); setMsg('')
    const r = await fetch('/api/notifiche', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oggetto, messaggio, gruppi })
    })
    const j = await r.json()
    setInviando(false)
    if (j.success) {
      setMsg('Notifica inviata con successo')
      setOggetto(''); setGruppi([]); if (editorRef.current) editorRef.current.innerHTML = ''
    } else {
      setMsg('Errore: ' + (j.error || 'invio fallito'))
    }
  }

  const btnTool = { padding:'6px 12px', border:'1px solid #d1d5db', background:'#f9fafb', borderRadius:'5px', fontSize:'13px', cursor:'pointer', color:'#1a1a1a' } as const

  return (
    <div style={{ maxWidth:'900px' }}>
      <div style={{ borderTop:'3px solid #2563eb', background:'#fff', borderRadius:'8px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', overflow:'hidden' }}>
        <div style={{ padding:'16px 22px', borderBottom:'1px solid #eee', fontSize:'18px', color:'#374151' }}>Notifica</div>
        <div style={{ padding:'22px' }}>
          {msg && <div style={{ marginBottom:'16px', padding:'10px 14px', borderRadius:'6px', fontSize:'13px', background: msg.startsWith('Notifica inviata') ? '#f0fdf4' : '#fef2f2', color: msg.startsWith('Notifica inviata') ? '#15803d' : '#dc2626', border: '1px solid ' + (msg.startsWith('Notifica inviata') ? '#86efac' : '#fecaca') }}>{msg}</div>}

          <label style={{ display:'block', fontWeight:'700', color:'#1a1a1a', marginBottom:'6px', fontSize:'14px' }}>Oggetto:</label>
          <input value={oggetto} onChange={e=>setOggetto(e.target.value)} style={{ width:'100%', padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:'6px', fontSize:'14px', color:'#1a1a1a', boxSizing:'border-box', marginBottom:'20px' }} />

          <div style={{ fontWeight:'700', color:'#1a1a1a', marginBottom:'10px', fontSize:'14px' }}>Gruppo di utenti</div>
          <div style={{ marginBottom:'20px' }}>
            {GRUPPI.map(g => (
              <label key={g} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px', fontSize:'14px', color:'#1a1a1a', cursor:'pointer' }}>
                <input type="checkbox" checked={gruppi.includes(g)} onChange={()=>toggleGruppo(g)} />
                {g}
              </label>
            ))}
          </div>

          <div style={{ fontWeight:'700', color:'#1a1a1a', marginBottom:'10px', fontSize:'14px' }}>Messaggio</div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
            <select onChange={e=>{ format('formatBlock', e.target.value); e.target.selectedIndex=0 }} style={{ ...btnTool, cursor:'pointer' }}>
              <option value="">Normal text</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
              <option value="h5">Heading 5</option>
              <option value="h6">Heading 6</option>
              <option value="p">Paragrafo</option>
            </select>
            <button onClick={()=>format('bold')} style={{ ...btnTool, fontWeight:'700' }}>Bold</button>
            <button onClick={()=>format('italic')} style={{ ...btnTool, fontStyle:'italic' }}>Italic</button>
            <button onClick={()=>format('underline')} style={{ ...btnTool, textDecoration:'underline' }}>Underline</button>
            <button onClick={()=>format('insertUnorderedList')} style={btnTool}>&bull; Lista</button>
            <button onClick={()=>format('insertOrderedList')} style={btnTool}>1. Lista</button>
            <button onClick={()=>format('justifyLeft')} style={btnTool}>&larr;</button>
            <button onClick={()=>format('justifyCenter')} style={btnTool}>&harr;</button>
            <button onClick={()=>{ const url = prompt('URL immagine:'); if (url) format('insertImage', url) }} style={btnTool}>Img</button>
          </div>
          <div ref={editorRef} contentEditable suppressContentEditableWarning style={{ minHeight:'180px', border:'1px solid #d1d5db', borderRadius:'6px', padding:'12px', fontSize:'14px', color:'#1a1a1a', outline:'none' }} />

          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'18px' }}>
            <button onClick={invia} disabled={inviando} style={{ padding:'9px 28px', background:'#2563eb', color:'#fff', border:'none', borderRadius:'6px', fontSize:'14px', fontWeight:'700', cursor: inviando ? 'default' : 'pointer', opacity: inviando ? 0.6 : 1 }}>{inviando ? 'Invio...' : 'Invia'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}