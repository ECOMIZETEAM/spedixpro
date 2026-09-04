'use client'
import { useState, useRef, useEffect } from 'react'

const GRUPPI = ['Cliente', 'Amministratore', 'Operatore', 'Agente']

import { useDialog } from '@/app/components/DialogProvider'
export default function InviaNotifica() {
  const dialog = useDialog()
  const [oggetto, setOggetto] = useState('')
  const [gruppi, setGruppi] = useState<string[]>([])
  const [inviando, setInviando] = useState(false)
  const [msg, setMsg] = useState('')
  const [allegati, setAllegati] = useState<{ nome: string; tipo: string; dati: string }[]>([])
  const editorRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [lista, setLista] = useState<any[]>([])
  async function caricaLista() { const r = await fetch('/api/notifiche'); const j = await r.json(); setLista(Array.isArray(j)?j:[]) }
  useEffect(() => { caricaLista() }, [])
  async function eliminaNotifica(id: string) {
    if (!await dialog.confirm({ title: 'Eliminare la notifica?', message: 'Non sarà più visibile.', danger: true, confirmText: 'Elimina' })) return
    await fetch('/api/notifiche?id=' + id, { method: 'DELETE' })
    caricaLista()
  }

  function toggleGruppo(g: string) {
    setGruppi(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  const MAX_FILE = 8 * 1024 * 1024   // 8 MB a file: oltre, il payload base64 diventa troppo grande
  async function aggiungiFile(files: FileList | null) {
    if (!files) return
    const nuovi: { nome: string; tipo: string; dati: string }[] = []
    for (const f of Array.from(files)) {
      if (allegati.length + nuovi.length >= 10) { setMsg('Massimo 10 allegati per notifica'); break }
      if (f.size > MAX_FILE) { setMsg(`"${f.name}" supera 8 MB e non è stato allegato`); continue }
      const dati: string = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsDataURL(f)
      })
      nuovi.push({ nome: f.name, tipo: f.type || 'application/octet-stream', dati })
    }
    if (nuovi.length) setAllegati(prev => [...prev, ...nuovi])
    if (fileRef.current) fileRef.current.value = ''
  }
  function rimuoviFile(i: number) { setAllegati(prev => prev.filter((_, idx) => idx !== i)) }

  function format(cmd: string, val?: string) {
    editorRef.current?.focus()
    if (cmd === 'formatBlock' && val) {
      document.execCommand('formatBlock', false, '<' + val + '>')
    } else {
      document.execCommand(cmd, false, val)
    }
  }

  async function invia() {
    const messaggio = editorRef.current?.innerHTML || ''
    if (!oggetto.trim()) { setMsg('Inserisci un oggetto'); return }
    if (!gruppi.length) { setMsg('Seleziona almeno un gruppo di utenti'); return }
    setInviando(true); setMsg('')
    const r = await fetch('/api/notifiche', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oggetto, messaggio, gruppi, allegati })
    })
    const j = await r.json()
    setInviando(false)
    if (j.success) {
      setMsg('Notifica inviata con successo')
      caricaLista()
      setOggetto(''); setGruppi([]); setAllegati([]); if (editorRef.current) editorRef.current.innerHTML = ''
    } else {
      setMsg('Errore: ' + (j.error || 'invio fallito'))
    }
  }

  const btnTool = { padding:'6px 12px', border:'1px solid #d1d5db', background:'#f9fafb', borderRadius:'5px', fontSize:'13px', cursor:'pointer', color:'#1a1a1a' } as const

  return (
    <div style={{ maxWidth:'900px' }}>
      <div style={{ borderTop:'3px solid #f97316', background:'#fff', borderRadius:'8px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', overflow:'hidden' }}>
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
            <select onChange={e=>{ const v = e.target.value; e.target.selectedIndex=0; if(v) format('formatBlock', v) }} style={{ ...btnTool, cursor:'pointer' }}>
              <option value="">Normal text</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
              <option value="h5">Heading 5</option>
              <option value="h6">Heading 6</option>
              <option value="p">Paragrafo</option>
            </select>
            <button onMouseDown={(e)=>{e.preventDefault();format('bold')}} style={{ ...btnTool, fontWeight:'700' }}>Bold</button>
            <button onMouseDown={(e)=>{e.preventDefault();format('italic')}} style={{ ...btnTool, fontStyle:'italic' }}>Italic</button>
            <button onMouseDown={(e)=>{e.preventDefault();format('underline')}} style={{ ...btnTool, textDecoration:'underline' }}>Underline</button>
            <button onMouseDown={(e)=>{e.preventDefault();format('insertUnorderedList')}} style={btnTool}>&bull; Lista</button>
            <button onMouseDown={(e)=>{e.preventDefault();format('insertOrderedList')}} style={btnTool}>1. Lista</button>
            <button onMouseDown={(e)=>{e.preventDefault();format('justifyLeft')}} style={btnTool}>&larr;</button>
            <button onMouseDown={(e)=>{e.preventDefault();format('justifyCenter')}} style={btnTool}>&harr;</button>
            <button onClick={async ()=>{ const url = await dialog.prompt({ title: 'Inserisci immagine', message: 'URL dell\'immagine:', placeholder: 'https://…' }); if (url) format('insertImage', url) }} style={btnTool}>Img</button>
          </div>
          <div ref={editorRef} contentEditable suppressContentEditableWarning style={{ minHeight:'180px', border:'1px solid #d1d5db', borderRadius:'6px', padding:'12px', fontSize:'14px', color:'#1a1a1a', outline:'none' }} />

          <div style={{ fontWeight:'700', color:'#1a1a1a', margin:'20px 0 10px', fontSize:'14px' }}>Allegati <span style={{ fontWeight:400, color:'#9ca3af', fontSize:'12px' }}>(moduli, PDF, immagini — max 10 file, 8 MB l'uno)</span></div>
          <input ref={fileRef} type="file" multiple onChange={e=>aggiungiFile(e.target.files)} style={{ display:'none' }} />
          <button type="button" onClick={()=>fileRef.current?.click()} style={{ ...btnTool, display:'inline-flex', alignItems:'center', gap:'6px' }}>📎 Allega file</button>
          {allegati.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:'8px', marginTop:'12px' }}>
              {allegati.map((a, i) => (
                <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:'8px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'6px', padding:'6px 10px', fontSize:'13px', color:'#374151' }}>
                  <span style={{ maxWidth:'220px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.nome}</span>
                  <button type="button" onClick={()=>rimuoviFile(i)} aria-label="Rimuovi allegato" style={{ border:'none', background:'none', color:'#dc2626', cursor:'pointer', fontSize:'15px', lineHeight:1, padding:0 }}>×</button>
                </span>
              ))}
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'18px' }}>
            <button onClick={invia} disabled={inviando} style={{ padding:'9px 28px', background:'#f97316', color:'#fff', border:'none', borderRadius:'6px', fontSize:'14px', fontWeight:'700', cursor: inviando ? 'default' : 'pointer', opacity: inviando ? 0.6 : 1 }}>{inviando ? 'Invio...' : 'Invia'}</button>
          </div>
        </div>
      </div>
      <div style={{ background:'#fff', borderRadius:'8px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', marginTop:'20px', overflow:'hidden' }}>
        <div style={{ padding:'14px 22px', borderBottom:'1px solid #eee', fontSize:'16px', fontWeight:'700', color:'#374151' }}>Elenco Notifiche</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
            <thead><tr style={{ background:'#f9fafb', textAlign:'left' }}>
              {['Data','Destinatari','Oggetto','Messaggio','Azioni'].map(h=><th key={h} style={{ padding:'10px 14px', color:'#374151', fontWeight:'700', borderBottom:'1px solid #eee' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.length === 0 ? (
                <tr><td colSpan={5} style={{ padding:'18px', textAlign:'center', color:'#999' }}>Nessuna notifica</td></tr>
              ) : lista.map((n:any)=>(
                <tr key={n.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                  <td style={{ padding:'10px 14px', color:'#1a1a1a', whiteSpace:'nowrap' }}>{new Date(n.created_at).toLocaleDateString('it-IT')} {new Date(n.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                  <td style={{ padding:'10px 14px', color:'#1a1a1a' }}>{(n.gruppi||[]).join(', ')}</td>
                  <td style={{ padding:'10px 14px', color:'#1a1a1a', fontWeight:'600' }}>{n.oggetto}</td>
                  <td style={{ padding:'10px 14px', color:'#555', maxWidth:'300px' }}>
                    <div dangerouslySetInnerHTML={{__html: n.messaggio || ''}} />
                    {Array.isArray(n.allegati) && n.allegati.length > 0 && (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginTop:'8px' }}>
                        {n.allegati.map((a:any, i:number)=>(
                          <a key={i} href={`/api/file?n=${n.id}&f=${encodeURIComponent(a.url || a.path || '')}`} target="_blank" rel="noopener noreferrer"
                            style={{ display:'inline-flex', alignItems:'center', gap:'4px', background:'#f0f9ff', border:'1px solid #bae6fd', color:'#0369a1', borderRadius:'5px', padding:'3px 8px', fontSize:'12px', textDecoration:'none', maxWidth:'160px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📎 {a.nome || 'allegato'}</a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding:'10px 14px' }}><button onClick={()=>eliminaNotifica(n.id)} style={{ padding:'5px 10px', background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:'5px', fontSize:'12px', fontWeight:'700', cursor:'pointer' }}>Elimina</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}