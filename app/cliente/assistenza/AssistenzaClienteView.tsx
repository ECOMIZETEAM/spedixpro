'use client'
import { useEffect, useRef, useState } from 'react'
import { fileToAllegato } from '@/app/components/fileAllegato'

const STATI: Record<string, { label: string; bg: string; color: string }> = {
  aperto: { label: 'Aperto', bg: '#fff7ed', color: '#ea580c' },
  in_lavorazione: { label: 'In lavorazione', bg: '#eff6ff', color: '#2563eb' },
  risolto: { label: 'Risolto', bg: '#f0fdf4', color: '#16a34a' },
  chiuso: { label: 'Chiuso', bg: '#f3f4f6', color: '#6b7280' },
}
function Badge({ stato }: { stato: string }) {
  const s = STATI[stato] || STATI.aperto
  return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '5px', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>
}
export default function AssistenzaClienteView({ categoria }: { categoria: 'ticket' | 'pod' }) {
  const isPod = categoria === 'pod'
  const [miei, setMiei] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [nuovo, setNuovo] = useState({ oggetto: '', messaggio: '' })
  const [files, setFiles] = useState<any[]>([])
  const [drag, setDrag] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [cerca, setCerca] = useState('')
  const [filtroStato, setFiltroStato] = useState('tutti')   // lo storico resta sempre: 'tutti' include i chiusi
  const [perPage, setPerPage] = useState(25)
  const [pagina, setPagina] = useState(1)
  const [nuoviIds, setNuoviIds] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  // Chat modale
  const [chat, setChat] = useState<any>(null)         // { ticket, messaggi }
  const [chatLoad, setChatLoad] = useState(false)
  const [testo, setTesto] = useState('')
  const [inviando, setInviando] = useState(false)
  const fondoRef = useRef<HTMLDivElement>(null)

  async function apriChat(id: string) {
    setChatLoad(true); setChat({ id }); setTesto('')
    const d = await fetch('/api/assistenza/' + id).then(r => r.json()).catch(() => null)
    setChatLoad(false)
    if (!d || d.error) { setMsg({ t: 'err', x: d?.error || 'Errore apertura' }); setChat(null); return }
    setChat(d)
    setNuoviIds(prev => { const s = new Set(prev); s.delete(id); return s })
    setTimeout(() => fondoRef.current?.scrollIntoView({ behavior: 'auto' }), 50)
  }
  async function inviaMsg() {
    if (!testo.trim() || !chat?.ticket?.id) return
    setInviando(true)
    const r = await fetch('/api/assistenza/' + chat.ticket.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo }) })
    const j = await r.json(); setInviando(false)
    if (j.error) { setMsg({ t: 'err', x: j.error }); return }
    setTesto('')
    await apriChat(chat.ticket.id)
    carica(true)
  }

  async function carica(silent = false) {
    if (!silent) setLoading(true)
    const d = await fetch('/api/assistenza/lista').then(r => r.json())
    const lista = d.miei || []
    setMiei(lista)
    // Il "letto" scatta SOLO aprendo la singola chat (lo fa la route del dettaglio): niente piu'
    // marca-tutto-letto all'apertura della lista, che spegneva il pallino rosso senza aver letto.
    setNuoviIds(new Set(lista.filter((t: any) => t.aperto_letto === false).map((t: any) => t.id)))
    if (!silent) setLoading(false)
  }
  useEffect(() => { carica(); const t = setInterval(() => { if (document.visibilityState === 'visible') carica(true) }, 15000); return () => clearInterval(t) }, [])

  async function aggiungiFile(list: FileList | File[]) {
    const arr = Array.from(list).slice(0, 10)
    const objs = await Promise.all(arr.map(fileToAllegato))
    setFiles(f => [...f, ...objs].slice(0, 10))
  }

  async function invia() {
    if (!nuovo.oggetto.trim()) { setMsg({ t: 'err', x: 'Inserisci la LDV' }); return }
    if (!isPod && !nuovo.messaggio.trim()) { setMsg({ t: 'err', x: 'Inserisci il messaggio' }); return }
    setSalvando(true); setMsg(null)
    const r = await fetch('/api/assistenza/apri', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...nuovo, categoria, allegati: isPod ? [] : files }) })
    const j = await r.json()
    setSalvando(false)
    if (j.error) { setMsg({ t: 'err', x: j.error }); return }
    setNuovo({ oggetto: '', messaggio: '' }); setFiles([])
    setMsg({ t: 'ok', x: isPod ? 'Richiesta POD inviata!' : 'Richiesta inviata! La trovi qui sotto con lo stato.' })
    carica()
  }

  const filtrati = miei
    .filter(t => (isPod ? t.categoria === 'pod' : t.categoria !== 'pod'))
    .filter(t => filtroStato === 'tutti' || t.stato === filtroStato)
    .filter(t => !cerca.trim() || String(t.oggetto || '').toLowerCase().includes(cerca.trim().toLowerCase()))
  const totalePagine = Math.max(1, Math.ceil(filtrati.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const visibili = filtrati.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' as const }
  const lbl = { fontSize: '12px', fontWeight: 600 as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '5px' }
  const th = { textAlign: 'left' as const, padding: '10px 14px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, color: '#1a1a1a', borderBottom: '1px solid #e5e7eb' }
  const td = { padding: '11px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f1f5f9' }

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>{isPod ? 'Assistenza — POD' : 'Assistenza — Ticket'}</h1>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '18px' }}>{isPod ? 'Richiedi la POD (prova di consegna) di una spedizione: basta la LDV.' : 'Apri un ticket: puoi allegare foto (anche da WhatsApp) o PDF.'}</p>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '18px', marginBottom: '20px', maxWidth: '640px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '14px' }}>{isPod ? 'Nuova richiesta POD' : 'Nuovo ticket'}</div>
        {msg && <div style={{ padding: '9px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '12.5px', color: '#fff', background: msg.t === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.x}</div>}
        <div style={{ marginBottom: '12px' }}><label style={lbl}>LDV</label><input value={nuovo.oggetto} onChange={e => setNuovo(n => ({ ...n, oggetto: e.target.value }))} placeholder="Numero LDV della spedizione" style={inp} /></div>

        {!isPod && <>
          <div style={{ marginBottom: '12px' }}><label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>Messaggio <span style={{ color: '#dc2626', fontWeight: 700 }}>fornire imballo e contenuto obbligatorio</span></label><textarea value={nuovo.messaggio} onChange={e => setNuovo(n => ({ ...n, messaggio: e.target.value }))} rows={4} placeholder="Descrivi il problema o la richiesta…" style={{ ...inp, resize: 'vertical' as const }} /></div>
          <div style={{ marginBottom: '14px' }}>
            <label style={lbl}>Allegati (foto/PDF)</label>
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) aggiungiFile(e.dataTransfer.files) }}
              onClick={() => inputRef.current?.click()}
              style={{ border: drag ? '2px dashed #2563eb' : '2px dashed #d1d5db', background: drag ? '#eff6ff' : '#fafafa', borderRadius: '8px', padding: '16px', textAlign: 'center', cursor: 'pointer', color: '#666', fontSize: '12.5px' }}>
              📎 Trascina qui foto o PDF, oppure clicca per scegliere
              <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple onChange={e => { if (e.target.files?.length) aggiungiFile(e.target.files); e.currentTarget.value = '' }} style={{ display: 'none' }} />
            </div>
            {files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f3f4f6', borderRadius: '6px', padding: '4px 8px', fontSize: '11.5px', color: '#1a1a1a' }}>
                    {String(f.tipo).startsWith('image/') ? <img src={f.dati} alt="" style={{ width: '26px', height: '26px', objectFit: 'cover', borderRadius: '4px' }} /> : <span>📄</span>}
                    <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nome}</span>
                    <button onClick={() => setFiles(arr => arr.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '13px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>}

        <button disabled={salvando} onClick={invia} style={{ padding: '10px 22px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Invio…' : (isPod ? 'Inoltra richiesta POD' : 'Invia ticket')}</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>{isPod ? 'Le mie richieste POD' : 'I miei ticket'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder="🔎 Cerca LDV…" style={{ padding: '7px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', minWidth: '190px' }} />
            <select value={filtroStato} onChange={e => { setFiltroStato(e.target.value); setPagina(1) }} style={{ padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12.5px', color: '#1a1a1a', background: '#fff' }}>
              <option value="tutti">Tutti gli stati</option><option value="aperto">Aperti</option><option value="in_lavorazione">In lavorazione</option><option value="risolto">Risolti</option><option value="chiuso">Chiusi (archivio)</option>
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#666' }}>
              Mostra
              <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPagina(1) }} style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '12px', color: '#1a1a1a', background: '#fff' }}>
                <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
              </select>
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>{['Codice', 'Data', 'LDV', 'Stato', isPod ? 'POD' : 'Chat'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !filtrati.length ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>{cerca ? 'Nessuna richiesta per questa LDV' : 'Nessuna richiesta ancora'}</td></tr>
              ) : visibili.map(t => (
                <tr key={t.id} onClick={() => apriChat(t.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700, color: '#f97316', fontSize: '12.5px' }}>{t.codice || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(t.created_at).toLocaleDateString('it-IT')}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {t.oggetto}
                      {nuoviIds.has(t.id) && <span style={{ background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px' }}>● Aggiornato</span>}
                    </div>
                    {!isPod && <div style={{ fontSize: '11.5px', color: '#888', marginTop: '2px', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.messaggio}</div>}
                  </td>
                  <td style={td}><Badge stato={t.stato} /></td>
                  <td style={{ ...td, fontSize: '12.5px' }} onClick={e => { if (isPod) e.stopPropagation() }}>
                    {isPod ? (t.pod_url ? <a href={t.pod_url} target="_blank" rel="noopener noreferrer" download style={{ color: '#f97316', fontWeight: 700, textDecoration: 'none' }}>⬇ Scarica POD</a> : <span style={{ color: '#999' }}>In attesa…</span>) : <span style={{ color: '#2563eb', fontWeight: 600 }}>💬 Apri chat</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtrati.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '12px 16px', borderTop: '1px solid #eee', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#666' }}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, filtrati.length)} di {filtrati.length}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaCorr <= 1} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', fontSize: '12px', cursor: paginaCorr <= 1 ? 'default' : 'pointer', color: paginaCorr <= 1 ? '#ccc' : '#1a1a1a' }}>Precedente</button>
              {Array.from({ length: totalePagine }, (_, i) => i + 1).filter(n => n === 1 || n === totalePagine || Math.abs(n - paginaCorr) <= 2).map((n, idx, arr) => (
                <span key={n} style={{ display: 'flex', alignItems: 'center' }}>
                  {idx > 0 && arr[idx - 1] !== n - 1 && <span style={{ padding: '0 4px', color: '#bbb', fontSize: '12px' }}>…</span>}
                  <button onClick={() => setPagina(n)} style={{ minWidth: '30px', padding: '5px 8px', border: '1px solid', borderColor: n === paginaCorr ? '#f97316' : '#d1d5db', borderRadius: '5px', background: n === paginaCorr ? '#f97316' : '#fff', color: n === paginaCorr ? '#fff' : '#1a1a1a', fontSize: '12px', fontWeight: n === paginaCorr ? 700 : 400, cursor: 'pointer' }}>{n}</button>
                </span>
              ))}
              <button onClick={() => setPagina(p => Math.min(totalePagine, p + 1))} disabled={paginaCorr >= totalePagine} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', fontSize: '12px', cursor: paginaCorr >= totalePagine ? 'default' : 'pointer', color: paginaCorr >= totalePagine ? '#ccc' : '#1a1a1a' }}>Successivo</button>
            </div>
          </div>
        )}
      </div>

      {chat && (
        <div onClick={() => setChat(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '560px', maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 800, color: '#f97316', fontSize: '13px' }}>{chat.ticket?.codice}</span>
                  {chat.ticket && <Badge stato={chat.ticket.stato} />}
                </div>
                <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: 600, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.ticket?.oggetto}</div>
              </div>
              <button onClick={() => setChat(null)} style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer', color: '#999' }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {chatLoad ? <div style={{ textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div> : (chat.messaggi || []).map((m: any) => {
                const mio = m.autore === chat.ruolo
                return (
                  <div key={m.id} style={{ alignSelf: mio ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                    <div style={{ fontSize: '10.5px', color: '#94a3b8', margin: mio ? '0 4px 3px 0' : '0 0 3px 4px', textAlign: mio ? 'right' : 'left', fontWeight: 600 }}>{mio ? 'Tu' : (m.autore_nome || 'Assistenza')}</div>
                    <div style={{ background: mio ? '#f97316' : '#fff', color: mio ? '#fff' : '#1a1a1a', border: mio ? 'none' : '1px solid #e5e7eb', padding: '9px 13px', borderRadius: '12px', fontSize: '13px', lineHeight: 1.45, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }}>
                      {m.testo}
                      {Array.isArray(m.allegati) && m.allegati.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                          {m.allegati.map((a: any, i: number) => <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: mio ? '#fff' : '#2563eb', textDecoration: 'underline' }}>📎 {a.nome}</a>)}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '10px', color: '#b6c0cc', margin: mio ? '2px 4px 0 0' : '2px 0 0 4px', textAlign: mio ? 'right' : 'left' }}>{new Date(m.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                )
              })}
              <div ref={fondoRef} />
            </div>

            {chat.ticket?.stato === 'chiuso' ? (
              <div style={{ padding: '14px 18px', borderTop: '1px solid #eee', textAlign: 'center', fontSize: '12.5px', color: '#6b7280', background: '#f9fafb' }}>🔒 Ticket chiuso e archiviato — sola lettura.</div>
            ) : (
              <div style={{ padding: '12px 14px', borderTop: '1px solid #eee', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <textarea value={testo} onChange={e => setTesto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); inviaMsg() } }} rows={2} placeholder="Scrivi un messaggio…" style={{ flex: 1, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', color: '#1a1a1a', resize: 'none' as const, boxSizing: 'border-box' as const }} />
                <button disabled={inviando || !testo.trim()} onClick={inviaMsg} style={{ padding: '10px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: inviando || !testo.trim() ? 'default' : 'pointer', opacity: inviando || !testo.trim() ? 0.6 : 1 }}>{inviando ? '…' : 'Invia'}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
