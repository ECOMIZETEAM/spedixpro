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

export default function AssistenzaPage() {
  const [ricevuti, setRicevuti] = useState<any[]>([])
  const [miei, setMiei] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<any>(null)          // ticket aperto nel dettaglio
  const [risposta, setRisposta] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [apri, setApri] = useState(false)            // modale nuovo ticket
  const [nuovo, setNuovo] = useState({ oggetto: '', messaggio: '' })
  const [msg, setMsg] = useState('')

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/assistenza/lista').then(r => r.json())
    setRicevuti(d.ricevuti || []); setMiei(d.miei || [])
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  async function aggiorna(id: string, campi: any) {
    setSalvando(true)
    const r = await fetch('/api/assistenza/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campi) })
    const j = await r.json()
    setSalvando(false)
    if (j.error) { setMsg(j.error); return }
    await carica()
    if (sel) setSel((s: any) => ({ ...s, ...campi }))
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

  const th = { textAlign: 'left' as const, padding: '10px 14px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, color: '#1a1a1a', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' as const }
  const td = { padding: '11px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' as const }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Assistenza Clienti</h1>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Ticket aperti dai tuoi clienti e dai sotto-master della tua rete.</p>
        </div>
        <button onClick={() => { setApri(true); setMsg('') }} style={{ padding: '9px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>+ Apri un ticket</button>
      </div>

      {/* TICKET RICEVUTI */}
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '20px' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Ticket ricevuti</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>
              {['Data', 'Da', 'Oggetto', 'Stato', 'Azioni'].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !ricevuti.length ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#999' }}>Nessun ticket ricevuto</td></tr>
              ) : ricevuti.map(t => (
                <tr key={t.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(t.created_at).toLocaleDateString('it-IT')} {new Date(t.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{t.aperto_da || '—'}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{t.tipo_apertura === 'master' ? 'Sotto-master' : 'Cliente'}</div>
                  </td>
                  <td style={td}>{t.oggetto}</td>
                  <td style={td}><Badge stato={t.stato} /></td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button onClick={() => { setSel(t); setRisposta(t.risposta || ''); setMsg('') }} style={{ padding: '5px 10px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: '#1a1a1a' }}>Apri</button>
                      {t.stato !== 'in_lavorazione' && t.stato !== 'risolto' && (
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
      </div>

      {/* I MIEI TICKET (aperti alla linea superiore) */}
      {miei.length > 0 && (
        <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>I miei ticket</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f9fafb' }}>{['Data', 'Oggetto', 'Stato', 'Risposta'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {miei.map(t => (
                  <tr key={t.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(t.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{t.oggetto}</td>
                    <td style={td}><Badge stato={t.stato} /></td>
                    <td style={{ ...td, color: '#555', fontSize: '12px' }}>{t.risposta || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DETTAGLIO TICKET */}
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
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>Risposta / nota</label>
                <textarea value={risposta} onChange={e => setRisposta(e.target.value)} rows={3} placeholder="Scrivi una risposta al cliente…" style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              {msg && <div style={{ fontSize: '12px', color: '#dc2626' }}>{msg}</div>}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button disabled={salvando} onClick={() => aggiorna(sel.id, { risposta })} style={{ padding: '9px 16px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#1a1a1a' }}>Salva risposta</button>
                <button disabled={salvando} onClick={() => aggiorna(sel.id, { stato: 'in_lavorazione' })} style={{ padding: '9px 16px', border: 'none', background: '#2563eb', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>In lavorazione</button>
                <button disabled={salvando} onClick={() => aggiorna(sel.id, { stato: 'risolto', risposta })} style={{ padding: '9px 16px', border: 'none', background: '#16a34a', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Segna risolto</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NUOVO TICKET (verso linea superiore) */}
      {apri && (
        <div onClick={() => setApri(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '10px', width: '480px', maxWidth: '100%' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Apri un ticket</div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><label style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '5px' }}>Oggetto</label>
                <input value={nuovo.oggetto} onChange={e => setNuovo(n => ({ ...n, oggetto: e.target.value }))} style={{ width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }} /></div>
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
