'use client'
import { useEffect, useState } from 'react'

const STATI: Record<string, { label: string; bg: string; color: string }> = {
  aperto: { label: 'Aperto', bg: '#fff7ed', color: '#ea580c' },
  in_lavorazione: { label: 'In lavorazione', bg: '#eff6ff', color: '#2563eb' },
  risolto: { label: 'Risolto', bg: '#f0fdf4', color: '#16a34a' },
}
function Badge({ stato }: { stato: string }) {
  const s = STATI[stato] || STATI.aperto
  return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '5px', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>
}

export default function AssistenzaMasterView({ categoria }: { categoria: 'ticket' | 'pod' }) {
  const isPod = categoria === 'pod'
  const [ricevuti, setRicevuti] = useState<any[]>([])
  const [miei, setMiei] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<any>(null)          // ticket aperto nel dettaglio
  const [risposta, setRisposta] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [apri, setApri] = useState(false)            // modale nuovo ticket
  const [nuovo, setNuovo] = useState({ oggetto: '', messaggio: '' })
  const [msg, setMsg] = useState('')
  const [cerca, setCerca] = useState('')             // ricerca per LDV
  const [perPage, setPerPage] = useState(25)
  const [pagina, setPagina] = useState(1)
  const [dragPod, setDragPod] = useState(false)
  const [viewImg, setViewImg] = useState<string | null>(null)   // lightbox foto allegate

  async function caricaPod(id: string, file: File): Promise<boolean> {
    if (file.type !== 'application/pdf') { setMsg('Il file della POD deve essere un PDF'); return false }
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file) })
    return await aggiorna(id, { podBase64: b64 })
  }

  async function carica(silent = false) {
    if (!silent) setLoading(true)
    const d = await fetch('/api/assistenza/lista').then(r => r.json())
    setRicevuti(d.ricevuti || []); setMiei(d.miei || [])
    if (!silent) setLoading(false)
  }
  useEffect(() => {
    carica()
    const t = setInterval(() => carica(true), 15000)  // aggiornamento automatico ogni 15s
    return () => clearInterval(t)
  }, [])

  async function aggiorna(id: string, campi: any): Promise<boolean> {
    setSalvando(true)
    try {
      const r = await fetch('/api/assistenza/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campi) })
      const j = await r.json().catch(() => ({}))
      setSalvando(false)
      if (!r.ok || j.error) { setMsg(j.error || (r.status === 413 ? 'PDF troppo grande: caricane uno più leggero (max ~4 MB).' : 'Errore durante il salvataggio (' + r.status + ')')); return false }
      await carica()
      return true
    } catch (e: any) {
      setSalvando(false); setMsg('Errore di rete: ' + (e?.message || 'riprova')); return false
    }
  }

  async function inviaTicket() {
    if (!nuovo.oggetto.trim() || !nuovo.messaggio.trim()) { setMsg('Compila oggetto e messaggio'); return }
    setSalvando(true); setMsg('')
    const r = await fetch('/api/assistenza/apri', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nuovo) })
    const j = await r.json()
    setSalvando(false)
    if (j.error) { setMsg(j.error); return }
    setApri(false); setNuovo({ oggetto: '', messaggio: '' }); carica()
  }

  // Filtro per categoria (ticket/pod) + ricerca per LDV o nome + paginazione
  const filtrati = ricevuti
    .filter(t => (isPod ? t.categoria === 'pod' : t.categoria !== 'pod'))
    .filter(t => {
      if (!cerca.trim()) return true
      const q = cerca.trim().toLowerCase()
      return String(t.oggetto || '').toLowerCase().includes(q) || String(t.aperto_da || '').toLowerCase().includes(q)
    })
  const mieiFiltrati = miei.filter(t => (isPod ? t.categoria === 'pod' : t.categoria !== 'pod'))
  const totalePagine = Math.max(1, Math.ceil(filtrati.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const visibili = filtrati.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  const th = { textAlign: 'left' as const, padding: '10px 14px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, color: '#1a1a1a', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' as const }
  const td = { padding: '11px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' as const }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>{isPod ? 'Assistenza — Richieste POD' : 'Assistenza — Ticket'}</h1>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>{isPod ? 'Richieste POD dei tuoi clienti e sotto-master: carica il PDF della prova di consegna.' : 'Ticket aperti dai tuoi clienti e dai sotto-master della tua rete.'}</p>
        </div>
        {!isPod && <button onClick={() => { setApri(true); setMsg('') }} style={{ padding: '9px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>+ Apri un ticket</button>}
      </div>

      {/* RICEVUTI */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '20px' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>{isPod ? 'Richieste POD ricevute' : 'Ticket ricevuti'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder="🔎 Cerca LDV…"
              style={{ padding: '7px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', minWidth: '200px' }} />
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
            <thead><tr style={{ background: '#f9fafb' }}>
              {['Data', 'Da', 'LDV', 'Stato', 'Azioni'].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !filtrati.length ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>{cerca ? 'Nessuna richiesta per questa LDV' : (isPod ? 'Nessuna richiesta POD ricevuta' : 'Nessun ticket ricevuto')}</td></tr>
              ) : visibili.map(t => (
                <tr key={t.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(t.created_at).toLocaleDateString('it-IT')} {new Date(t.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{t.aperto_da || '—'}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{t.tipo_apertura === 'master' ? 'Sotto-master' : 'Cliente'}</div>
                  </td>
                  <td style={td}>
                    {t.oggetto}
                    {Array.isArray(t.allegati) && t.allegati.length > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#2563eb' }}>📎{t.allegati.length}</span>}
                  </td>
                  <td style={td}><Badge stato={t.stato} /></td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button onClick={() => { setSel(t); setRisposta(t.risposta || ''); setMsg('') }} style={{ padding: '5px 10px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: '#1a1a1a' }}>Apri</button>
                      {!isPod && t.stato !== 'in_lavorazione' && t.stato !== 'risolto' && (
                        <button onClick={() => aggiorna(t.id, { stato: 'in_lavorazione' })} style={{ padding: '5px 10px', border: 'none', background: '#2563eb', color: '#fff', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>In lavorazione</button>
                      )}
                      {t.stato !== 'risolto' && (
                        <button onClick={() => aggiorna(t.id, { stato: 'risolto' })} style={{ padding: '5px 10px', border: 'none', background: '#16a34a', color: '#fff', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>Segna risolto</button>
                      )}
                    </div>
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

      {/* LE MIE RICHIESTE (aperte alla linea superiore) */}
      {mieiFiltrati.length > 0 && (
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>{isPod ? 'Le mie richieste POD' : 'I miei ticket'}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f9fafb' }}>{['Data', 'LDV', 'Stato', isPod ? 'POD' : 'Risposta'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {mieiFiltrati.map(t => (
                  <tr key={t.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(t.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{t.oggetto}</td>
                    <td style={td}><Badge stato={t.stato} /></td>
                    <td style={{ ...td, color: '#555', fontSize: '12px' }}>{isPod ? (t.pod_url ? <a href={t.pod_url} target="_blank" rel="noopener noreferrer" download style={{ color: '#f97316', fontWeight: 700, textDecoration: 'none' }}>⬇ Scarica POD</a> : '—') : (t.risposta || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DETTAGLIO */}
      {sel && (
        <div onClick={() => setSel(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '10px', width: '560px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>{sel.oggetto}</div>
              <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#999' }}>✕</button>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
                <span><b style={{ color: '#1a1a1a' }}>{sel.aperto_da}</b> ({sel.tipo_apertura === 'master' ? 'Sotto-master' : 'Cliente'})</span>
                <Badge stato={sel.stato} />
              </div>
              <div style={{ background: '#f9fafb', border: '1px solid #eee', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#1a1a1a', whiteSpace: 'pre-wrap' }}>{sel.messaggio}</div>

              {/* Allegati del ticket (foto/PDF caricati dal cliente) */}
              {Array.isArray(sel.allegati) && sel.allegati.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Allegati ({sel.allegati.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {sel.allegati.map((a: any, i: number) => (
                      String(a.tipo || '').startsWith('image/')
                        ? <img key={i} src={a.url} alt={a.nome} onClick={() => setViewImg(a.url)} title="Clicca per ingrandire" style={{ width: '90px', height: '90px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e5e7eb', cursor: 'zoom-in' }} />
                        : <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                            <div style={{ width: '90px', height: '90px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: '11px', color: '#2563eb', textAlign: 'center', padding: '4px' }}><span style={{ fontSize: '24px' }}>📄</span><span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome}</span></div>
                          </a>
                    ))}
                  </div>
                </div>
              )}

              {sel.categoria === 'pod' && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragPod(true) }}
                  onDragLeave={() => setDragPod(false)}
                  onDrop={async e => { e.preventDefault(); setDragPod(false); const f = e.dataTransfer.files?.[0]; if (f) { if (await caricaPod(sel.id, f)) setSel(null) } }}
                  style={{ background: dragPod ? '#dbeafe' : '#f0f9ff', border: dragPod ? '2px dashed #2563eb' : '2px dashed #bae6fd', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Prova di consegna (POD) — LDV {sel.oggetto}</div>
                  {sel.pod_url && <div style={{ marginBottom: '10px' }}><a href={sel.pod_url} target="_blank" rel="noopener noreferrer" download style={{ color: '#f97316', fontWeight: 700, textDecoration: 'none' }}>⬇ Scarica POD caricata</a></div>}
                  <div style={{ fontSize: '12.5px', color: '#555', marginBottom: '10px' }}>📎 Trascina qui il PDF della POD, oppure</div>
                  <label style={{ display: 'inline-block', padding: '8px 16px', background: '#2563eb', color: '#fff', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
                    {sel.pod_url ? 'Sostituisci PDF' : 'Scegli PDF'}
                    <input type="file" accept="application/pdf" onChange={async e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) { if (await caricaPod(sel.id, f)) setSel(null) } }} style={{ display: 'none' }} />
                  </label>
                  <div style={{ fontSize: '11px', color: '#666', marginTop: '9px' }}>Caricando il PDF la richiesta si chiude in automatico (risolta) e il cliente riceve la notifica per scaricare la POD.</div>
                </div>
              )}

              {!isPod && <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>Risposta / nota</label>
                <textarea value={risposta} onChange={e => setRisposta(e.target.value)} rows={3} placeholder="Scrivi una risposta al cliente…" style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>}
              {msg && <div style={{ fontSize: '12px', color: '#dc2626' }}>{msg}</div>}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {!isPod && <button disabled={salvando} onClick={async () => { if (await aggiorna(sel.id, { risposta, stato: sel.stato === 'aperto' ? 'in_lavorazione' : sel.stato })) setSel(null) }} style={{ padding: '9px 16px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#1a1a1a' }}>Salva risposta</button>}
                {!isPod && <button disabled={salvando} onClick={async () => { if (await aggiorna(sel.id, { stato: 'in_lavorazione', risposta })) setSel(null) }} style={{ padding: '9px 16px', border: 'none', background: '#2563eb', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>In lavorazione</button>}
                {sel.stato !== 'risolto' && <button disabled={salvando} onClick={async () => { if (await aggiorna(sel.id, { stato: 'risolto', risposta: isPod ? undefined : risposta })) setSel(null) }} style={{ padding: '9px 16px', border: 'none', background: '#16a34a', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Segna risolto</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX FOTO ALLEGATE */}
      {viewImg && (
        <div onClick={() => setViewImg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '30px', cursor: 'zoom-out' }}>
          <button onClick={() => setViewImg(null)} style={{ position: 'absolute', top: '18px', right: '22px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '50%', width: '38px', height: '38px', fontSize: '20px', cursor: 'pointer' }}>✕</button>
          <img src={viewImg} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '95%', maxHeight: '92vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', cursor: 'default' }} />
        </div>
      )}

      {/* NUOVO TICKET (verso linea superiore) */}
      {apri && (
        <div onClick={() => setApri(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '10px', width: '480px', maxWidth: '100%' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Apri un ticket</div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>LDV</label>
                <input value={nuovo.oggetto} onChange={e => setNuovo(n => ({ ...n, oggetto: e.target.value }))} placeholder="Numero LDV" style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }} /></div>
              <div><label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>Messaggio</label>
                <textarea value={nuovo.messaggio} onChange={e => setNuovo(n => ({ ...n, messaggio: e.target.value }))} rows={4} style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box', resize: 'vertical' }} /></div>
              {msg && <div style={{ fontSize: '12px', color: '#dc2626' }}>{msg}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button onClick={() => setApri(false)} style={{ padding: '9px 16px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#1a1a1a' }}>Annulla</button>
                <button disabled={salvando} onClick={inviaTicket} style={{ padding: '9px 18px', border: 'none', background: '#f97316', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{salvando ? 'Invio…' : 'Invia ticket'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
