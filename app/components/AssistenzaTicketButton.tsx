'use client'
import { useState } from 'react'

// Icona assistenza (accanto al cestino della LDV): apre un popup dove si sceglie
// tra "Apertura ticket" e "Richiesta POD"; poi si compila e si invia. La LDV è
// gia' precompilata.
function fileToObj(file: File): Promise<any> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ nome: file.name, tipo: file.type || 'application/octet-stream', dati: r.result as string }); r.onerror = rej; r.readAsDataURL(file) })
}

export default function AssistenzaTicketButton({ ldv }: { ldv: string }) {
  const [open, setOpen] = useState(false)
  const [modo, setModo] = useState<'' | 'ticket' | 'pod'>('')   // '' = scelta iniziale
  const [desc, setDesc] = useState('')
  const [files, setFiles] = useState<any[]>([])
  const [drag, setDrag] = useState(false)
  const [inviando, setInviando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)

  function chiudi() { setOpen(false); setModo(''); setDesc(''); setFiles([]); setMsg(null) }

  async function aggiungiFile(list: FileList | File[]) {
    const arr = Array.from(list).slice(0, 10)
    const objs = await Promise.all(arr.map(fileToObj))
    setFiles(f => [...f, ...objs].slice(0, 10))
  }

  async function invia() {
    if (modo === 'ticket' && !desc.trim()) { setMsg({ t: 'err', x: 'Inserisci una descrizione del problema' }); return }
    setInviando(true); setMsg(null)
    const r = await fetch('/api/assistenza/apri', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oggetto: ldv, messaggio: desc, categoria: modo, allegati: modo === 'ticket' ? files : [] }),
    })
    const j = await r.json(); setInviando(false)
    if (j.error) { setMsg({ t: 'err', x: j.error }); return }
    setMsg({ t: 'ok', x: modo === 'pod' ? 'Richiesta POD inviata! La trovi in Assistenza.' : 'Segnalazione inviata! La trovi in Assistenza.' })
    setTimeout(() => chiudi(), 1100)
  }

  const btn = { padding: '9px 16px', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }

  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); setModo(''); setDesc(''); setMsg(null) }} title="Assistenza / POD"
        style={{ padding: '4px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: '4px', fontSize: '14px', border: '1px solid #bfdbfe', cursor: 'pointer' }}>🎧</button>

      {open && (
        <div onClick={chiudi} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '10px', width: '460px', maxWidth: '100%' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontSize: '15px', fontWeight: 700, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>🎧 Assistenza — LDV {ldv}</div>

            {/* Scelta iniziale */}
            {modo === '' ? (
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '13px', color: '#555' }}>Cosa vuoi fare per questa spedizione?</div>
                <button onClick={() => setModo('ticket')} style={{ ...btn, background: '#f97316', color: '#fff', padding: '13px', textAlign: 'left' }}>📩 Apertura ticket<div style={{ fontSize: '11px', fontWeight: 400, opacity: .9, marginTop: '2px' }}>Segnala un problema su questa spedizione</div></button>
                <button onClick={() => setModo('pod')} style={{ ...btn, background: '#2563eb', color: '#fff', padding: '13px', textAlign: 'left' }}>📄 Richiesta POD<div style={{ fontSize: '11px', fontWeight: 400, opacity: .9, marginTop: '2px' }}>Richiedi la prova di consegna</div></button>
              </div>
            ) : (
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div><label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>LDV</label>
                  <input value={ldv} disabled style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#f5f5f5', boxSizing: 'border-box' }} /></div>
                {modo === 'ticket' && <div><label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>Descrizione del problema <span style={{ color: '#dc2626', fontWeight: 700 }}>fornire imballo e contenuto obbligatorio</span></label>
                  <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} autoFocus placeholder="Descrivi il problema su questa spedizione…" style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box', resize: 'vertical' }} /></div>}
                {modo === 'ticket' && <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>Allegati (foto/PDF)</label>
                  <label
                    onDragOver={e => { e.preventDefault(); setDrag(true) }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) aggiungiFile(e.dataTransfer.files) }}
                    style={{ display: 'block', border: drag ? '2px dashed #2563eb' : '2px dashed #d1d5db', background: drag ? '#eff6ff' : '#fafafa', borderRadius: '8px', padding: '14px', textAlign: 'center', cursor: 'pointer', color: '#666', fontSize: '12px' }}>
                    📎 Trascina qui foto o PDF, oppure clicca per scegliere
                    <input type="file" accept="image/*,application/pdf" multiple onChange={e => { if (e.target.files?.length) aggiungiFile(e.target.files); e.currentTarget.value = '' }} style={{ display: 'none' }} />
                  </label>
                  {files.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '8px' }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f3f4f6', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: '#1a1a1a' }}>
                        {String(f.tipo).startsWith('image/') ? <img src={f.dati} alt="" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '4px' }} /> : <span>📄</span>}
                        <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nome}</span>
                        <button onClick={() => setFiles(arr => arr.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '13px' }}>✕</button>
                      </div>
                    ))}
                  </div>}
                </div>}
                {modo === 'pod' && <div style={{ fontSize: '13px', color: '#555' }}>Confermi la richiesta della POD per la LDV <b>{ldv}</b>?</div>}
                {msg && <div style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px', color: '#fff', background: msg.t === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.x}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <button onClick={() => { setModo(''); setMsg(null) }} style={{ padding: '9px 16px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#1a1a1a' }}>← Indietro</button>
                  <button disabled={inviando} onClick={invia} style={{ ...btn, background: modo === 'pod' ? '#2563eb' : '#f97316', color: '#fff', opacity: inviando ? 0.7 : 1 }}>{inviando ? 'Invio…' : (modo === 'pod' ? 'Inoltra richiesta POD' : 'Invia segnalazione')}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
