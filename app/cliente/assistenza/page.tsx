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

export default function AssistenzaClientePage() {
  const [miei, setMiei] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [nuovo, setNuovo] = useState({ oggetto: '', messaggio: '' })
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [cerca, setCerca] = useState('')
  const [perPage, setPerPage] = useState(25)
  const [pagina, setPagina] = useState(1)

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/assistenza/lista').then(r => r.json())
    setMiei(d.miei || [])
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  async function invia() {
    if (!nuovo.oggetto.trim() || !nuovo.messaggio.trim()) { setMsg({ t: 'err', x: 'Compila oggetto e messaggio' }); return }
    setSalvando(true); setMsg(null)
    const r = await fetch('/api/assistenza/apri', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nuovo) })
    const j = await r.json()
    setSalvando(false)
    if (j.error) { setMsg({ t: 'err', x: j.error }); return }
    setNuovo({ oggetto: '', messaggio: '' }); setMsg({ t: 'ok', x: 'Richiesta inviata! La vedrai qui sotto con lo stato di avanzamento.' })
    carica()
  }

  const filtrati = miei.filter(t => !cerca.trim() || String(t.oggetto || '').toLowerCase().includes(cerca.trim().toLowerCase()))
  const totalePagine = Math.max(1, Math.ceil(filtrati.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const visibili = filtrati.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' as const }
  const lbl = { fontSize: '12px', fontWeight: 600 as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '5px' }
  const th = { textAlign: 'left' as const, padding: '10px 14px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, color: '#1a1a1a', borderBottom: '1px solid #e5e7eb' }
  const td = { padding: '11px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f1f5f9' }

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Assistenza</h1>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '18px' }}>Apri una richiesta di assistenza: la seguiremo fino alla risoluzione.</p>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '18px', marginBottom: '20px', maxWidth: '640px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '14px' }}>Nuova richiesta</div>
        {msg && <div style={{ padding: '9px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '12.5px', color: '#fff', background: msg.t === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.x}</div>}
        <div style={{ marginBottom: '12px' }}><label style={lbl}>LDV</label><input value={nuovo.oggetto} onChange={e => setNuovo(n => ({ ...n, oggetto: e.target.value }))} placeholder="Numero LDV della spedizione" style={inp} /></div>
        <div style={{ marginBottom: '14px' }}><label style={lbl}>Messaggio</label><textarea value={nuovo.messaggio} onChange={e => setNuovo(n => ({ ...n, messaggio: e.target.value }))} rows={4} placeholder="Descrivi il problema o la richiesta…" style={{ ...inp, resize: 'vertical' as const }} /></div>
        <button disabled={salvando} onClick={invia} style={{ padding: '10px 22px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Invio…' : 'Invia richiesta'}</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Le mie richieste</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder="🔎 Cerca LDV…"
              style={{ padding: '7px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', minWidth: '190px' }} />
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
            <thead><tr style={{ background: '#f9fafb' }}>{['Data', 'LDV', 'Stato', 'Risposta'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#999' }}>Caricamento…</td></tr>
              ) : !filtrati.length ? (
                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#999' }}>{cerca ? 'Nessuna richiesta per questa LDV' : 'Nessuna richiesta ancora'}</td></tr>
              ) : visibili.map(t => (
                <tr key={t.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(t.created_at).toLocaleDateString('it-IT')}</td>
                  <td style={td}><div style={{ fontWeight: 600 }}>{t.oggetto}</div><div style={{ fontSize: '11.5px', color: '#888', marginTop: '2px' }}>{t.messaggio}</div></td>
                  <td style={td}><Badge stato={t.stato} /></td>
                  <td style={{ ...td, color: '#555', fontSize: '12.5px' }}>{t.risposta || '—'}</td>
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
    </div>
  )
}
