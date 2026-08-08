'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Widget SUPPORTO della piattaforma: l'utente scrive a NOI (diverso dai ticket cliente→master).
// Oggetto, categoria, descrizione e fino a 3 allegati (screen o video). All'invio va un'email a
// info@moovexpress.com con "Rispondi" già puntato all'utente. Gli allegati si caricano DIRETTI su
// storage (regge anche i video); l'email porta i link firmati.
const CATEGORIE = [
  'Problema tecnico', 'Domanda sull’uso', 'Fatturazione e credito',
  'Spedizioni e corrieri', 'Richiesta funzionalità', 'Altro',
]
const MAX_FILE = 25 * 1024 * 1024   // 25 MB per file
const MAX_N = 3
const ACCENT = '#f97316'

export default function SupportoButton({ compatto = false }: { compatto?: boolean }) {
  const [aperto, setAperto] = useState(false)
  const [oggetto, setOggetto] = useState('')
  const [categoria, setCategoria] = useState('')
  const [descrizione, setDescrizione] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [invio, setInvio] = useState(false)
  const [ok, setOk] = useState(false)
  const [errore, setErrore] = useState('')
  const [sopra, setSopra] = useState(false)   // drag&drop attivo
  const inputFile = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!aperto) return
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !invio) setAperto(false) }
    document.addEventListener('keydown', esc)
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', esc) }
  }, [aperto, invio])

  function reset() { setOggetto(''); setCategoria(''); setDescrizione(''); setFiles([]); setOk(false); setErrore('') }

  function aggiungi(nuovi: FileList | null) {
    if (!nuovi) return
    setErrore('')
    const arr = [...files]
    for (const f of Array.from(nuovi)) {
      if (arr.length >= MAX_N) { setErrore(`Massimo ${MAX_N} file.`); break }
      if (f.size > MAX_FILE) { setErrore(`"${f.name}" supera i 25 MB.`); continue }
      arr.push(f)
    }
    setFiles(arr.slice(0, MAX_N))
  }

  async function invia() {
    if (invio) return
    if (!oggetto.trim() || !categoria || !descrizione.trim()) { setErrore('Compila oggetto, categoria e descrizione.'); return }
    setInvio(true); setErrore('')
    try {
      // 1) allegati diretti su storage (bypassano il limite del corpo richiesta)
      const sb = createClient()
      const meta: { nome: string; path: string; tipo: string }[] = []
      for (const f of files) {
        const up = await fetch('/api/supporto/upload-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomeFile: f.name }),
        }).then(r => r.json())
        if (!up?.path || !up?.token) throw new Error('Caricamento allegato non riuscito.')
        const { error } = await sb.storage.from(up.bucket || 'reports').uploadToSignedUrl(up.path, up.token, f)
        if (error) throw new Error(`Caricamento di "${f.name}" non riuscito.`)
        meta.push({ nome: f.name, path: up.path, tipo: f.type })
      }
      // 2) invia la richiesta → email a info@moovexpress.com
      const r = await fetch('/api/supporto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oggetto, categoria, descrizione, allegati: meta }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d?.error) throw new Error(d?.error || 'Invio non riuscito.')
      setOk(true); setFiles([])
    } catch (e: any) {
      setErrore(e?.message || 'Invio non riuscito. Riprova.')
    } finally { setInvio(false) }
  }

  const campo: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '14px',
    border: '1px solid #ddd', borderRadius: '8px', outline: 'none', color: '#1a1a1a', background: '#fff',
  }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', margin: '0 0 6px' }

  return (
    <>
      <button onClick={() => { reset(); setAperto(true) }} title="Supporto" aria-label="Supporto"
        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid #e8e8e8', cursor: 'pointer', padding: compatto ? '5px 8px' : '5px 10px', borderRadius: '8px', color: '#333', fontSize: '13px', fontWeight: 500 }}>
        <span style={{ fontSize: '15px' }}>🛟</span>
        {!compatto && <span style={{ whiteSpace: 'nowrap' }}>Supporto</span>}
      </button>

      {aperto && (
        <div onMouseDown={() => { if (!invio) setAperto(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
          <div onMouseDown={e => e.stopPropagation()}
            style={{ width: '460px', maxWidth: '100%', background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            {/* Testata */}
            <div style={{ background: '#1a1a1a', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '17px', fontWeight: 700 }}>Supporto</div>
              <button onClick={() => { if (!invio) setAperto(false) }} aria-label="Chiudi" style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '30px', height: '30px', borderRadius: '8px', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: '20px' }}>
              {ok ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: '40px' }}>✓</div>
                  <div style={{ fontWeight: 700, fontSize: '16px', color: '#15803d', marginTop: '8px' }}>Richiesta inviata</div>
                  <div style={{ color: '#666', fontSize: '14px', marginTop: '6px' }}>Ti rispondiamo via email il prima possibile.</div>
                  <button onClick={() => setAperto(false)} style={{ marginTop: '18px', background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 22px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Chiudi</button>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '14px' }}>
                    <label style={lbl}>Oggetto <span style={{ color: '#dc2626' }}>*</span></label>
                    <input value={oggetto} onChange={e => setOggetto(e.target.value)} maxLength={200} style={campo} placeholder="Riassumi il problema in poche parole" />
                  </div>
                  <div style={{ marginBottom: '14px' }}>
                    <label style={lbl}>Categoria <span style={{ color: '#dc2626' }}>*</span></label>
                    <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...campo, cursor: 'pointer' }}>
                      <option value="">Seleziona una categoria</option>
                      {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: '14px' }}>
                    <label style={lbl}>Descrizione <span style={{ color: '#dc2626' }}>*</span></label>
                    <textarea value={descrizione} onChange={e => setDescrizione(e.target.value)} maxLength={5000} rows={5} style={{ ...campo, resize: 'vertical' }} placeholder="Cosa è successo, dove, e cosa ti aspettavi. Più dettagli ci dai, prima ti aiutiamo." />
                  </div>

                  {/* Allegati */}
                  <div
                    onDragOver={e => { e.preventDefault(); setSopra(true) }}
                    onDragLeave={() => setSopra(false)}
                    onDrop={e => { e.preventDefault(); setSopra(false); aggiungi(e.dataTransfer.files) }}
                    onClick={() => inputFile.current?.click()}
                    style={{ border: `2px dashed ${sopra ? ACCENT : '#ddd'}`, borderRadius: '10px', padding: '18px', textAlign: 'center', cursor: 'pointer', background: sopra ? '#fff7ed' : '#fafafa', transition: 'all .12s' }}>
                    <input ref={inputFile} type="file" multiple accept="image/*,video/*,.pdf" onChange={e => { aggiungi(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
                    <div style={{ fontSize: '22px', opacity: 0.5 }}>⤒</div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#333', marginTop: '4px' }}>Carica file (massimo {MAX_N})</div>
                    <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>Clicca o trascina — screen o video, fino a 25 MB l’uno.</div>
                  </div>
                  {files.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {files.map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: '#f5f5f5', borderRadius: '8px', padding: '7px 10px', fontSize: '13px' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#333' }}>{f.name}</span>
                          <button onClick={e => { e.stopPropagation(); setFiles(files.filter((_, j) => j !== i)) }} aria-label="Rimuovi" style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {errore && <div style={{ color: '#dc2626', fontSize: '13px', marginTop: '12px' }}>{errore}</div>}

                  <button onClick={invia} disabled={invio}
                    style={{ width: '100%', marginTop: '18px', background: invio ? '#f0a875' : ACCENT, color: '#fff', border: 'none', borderRadius: '10px', padding: '13px 0', fontSize: '15px', fontWeight: 700, cursor: invio ? 'default' : 'pointer' }}>
                    {invio ? 'Invio in corso…' : 'Invia'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
