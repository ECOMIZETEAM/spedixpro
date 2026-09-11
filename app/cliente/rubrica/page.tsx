'use client'
import { useState, useEffect, useRef } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

const ACCENT = '#f97316'
const inp: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }
const th: any = { textAlign: 'left', padding: '9px 10px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
const td: any = { padding: '9px 10px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f1f1f1', verticalAlign: 'top' }
const sub: any = { fontSize: '11.5px', color: '#888' }
const btn: any = { padding: '9px 15px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: 'none' }

type Riga = { id: string; nome: string; indirizzo: string; citta: string; provincia: string; cap: string; paese: string; telefono: string; email: string; note: string }
const VUOTO = { id: '', nome: '', indirizzo: '', citta: '', provincia: '', cap: '', paese: 'IT', telefono: '', email: '', note: '' }

export default function RubricaCliente() {
  const dialog = useDialog()
  const [righe, setRighe] = useState<Riga[]>([])
  const [totale, setTotale] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<any>({ ...VUOTO })
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function carica(query = q) {
    setLoading(true)
    fetch(`/api/cliente/rubrica?limit=500&q=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(d => { setRighe(Array.isArray(d?.righe) ? d.righe : []); setTotale(Number(d?.totale) || 0); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { carica('') }, [])
  // Ricerca con debounce
  useEffect(() => { const t = setTimeout(() => carica(q), 300); return () => clearTimeout(t) }, [q])

  async function importa(file: File) {
    setImporting(true); setMsg(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      const res = await fetch('/api/cliente/rubrica/importa', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) setMsg({ t: 'err', x: d.error || 'Errore import' })
      else { setMsg({ t: 'ok', x: `Rubrica aggiornata: ${d.salvati} destinatari importati${d.scartati ? `, ${d.scartati} righe saltate (senza nominativo)` : ''}.` }); carica('') }
    } catch (e: any) { setMsg({ t: 'err', x: e?.message || 'Errore import' }) }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function scaricaTemplate() {
    const header = 'Destinatario,Indirizzo,Telefono,Città,CAP,Provincia,Email'
    const esempio = 'Mario Rossi,Via Roma 1,3331234567,Milano,20100,MI,mario@example.com'
    const blob = new Blob(['﻿' + header + '\n' + esempio + '\n'], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'template_rubrica.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function apri(r?: Riga) { setForm(r ? { ...r } : { ...VUOTO }); setModal(true) }
  async function salva() {
    if (!String(form.nome || '').trim()) { await dialog.alert({ title: 'Nominativo mancante', message: 'Il nominativo del destinatario è obbligatorio.' }); return }
    setSaving(true)
    const res = await fetch('/api/cliente/rubrica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const d = await res.json().catch(() => ({})); setSaving(false)
    if (!res.ok || d.error) { await dialog.alert({ title: 'Errore', message: d.error || 'Salvataggio non riuscito' }); return }
    setModal(false); carica()
  }
  async function elimina(r: Riga) {
    const ok = await dialog.confirm({ title: 'Eliminare il contatto?', message: `${r.nome} — ${[r.indirizzo, r.citta].filter(Boolean).join(', ')}`, confirmText: 'Elimina', danger: true })
    if (!ok) return
    const res = await fetch(`/api/cliente/rubrica?id=${r.id}`, { method: 'DELETE' })
    if (res.ok) setRighe(rs => rs.filter(x => x.id !== r.id))
  }

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '4px 2px 40px' }}>
      <div style={{ marginBottom: '4px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Rubrica destinatari</h1>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0' }}>
          I tuoi destinatari salvati. In creazione spedizione compaiono già come suggerimenti quando scrivi il nominativo.
        </p>
      </div>

      {/* Import + template */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', margin: '14px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importa(f) }} />
        <button style={{ ...btn, background: ACCENT, color: '#fff', opacity: importing ? 0.6 : 1 }} disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? 'Importo…' : 'Importa da file'}
        </button>
        <button style={{ ...btn, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }} onClick={scaricaTemplate}>Scarica template</button>
        <button style={{ ...btn, background: '#fff', color: ACCENT, border: `1px solid ${ACCENT}` }} onClick={() => apri()}>+ Aggiungi contatto</button>
        <span style={{ fontSize: '12px', color: '#9ca3af', flex: 1, minWidth: '220px', textAlign: 'right' }}>
          Colonne: <b>Destinatario, Indirizzo, Telefono, Città, CAP, Provincia</b> (Email opzionale). CSV o Excel.
        </span>
      </div>

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', background: msg.t === 'ok' ? '#ecfdf5' : '#fef2f2', color: msg.t === 'ok' ? '#065f46' : '#b91c1c', border: `1px solid ${msg.t === 'ok' ? '#a7f3d0' : '#fecaca'}` }}>{msg.x}</div>
      )}

      {/* Ricerca */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca per nome, città, CAP, indirizzo…" style={{ ...inp, maxWidth: '360px' }} />
        <span style={{ fontSize: '12.5px', color: '#9ca3af' }}>{totale} destinatari{totale > righe.length ? ` (mostrati ${righe.length})` : ''}</span>
      </div>

      {/* Tabella */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Destinatario</th>
              <th style={th}>Indirizzo</th>
              <th style={th}>Contatti</th>
              <th style={{ ...th, width: '90px', textAlign: 'center' }}>Azioni</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: '30px' }} colSpan={4}>Carico…</td></tr>
              ) : !righe.length ? (
                <tr><td style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: '34px' }} colSpan={4}>
                  {q ? 'Nessun destinatario corrisponde alla ricerca.' : 'Rubrica vuota. Importa un file o aggiungi un contatto.'}
                </td></tr>
              ) : righe.map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight: 600, minWidth: '170px' }}>{r.nome}{r.note ? <div style={sub}>{r.note}</div> : null}</td>
                  <td style={{ ...td, minWidth: '210px' }}>
                    {r.indirizzo || <span style={{ color: '#c4c4c4' }}>—</span>}
                    <div style={sub}>{[r.cap, r.citta, r.provincia ? '(' + r.provincia + ')' : ''].filter(Boolean).join(' ')}{r.paese && r.paese !== 'IT' ? ' · ' + r.paese : ''}</div>
                  </td>
                  <td style={{ ...td, minWidth: '160px' }}>
                    {r.telefono ? <div>☎ {r.telefono}</div> : null}
                    {r.email ? <div style={sub}>✉ {r.email}</div> : null}
                    {!r.telefono && !r.email ? <span style={{ color: '#c4c4c4' }}>—</span> : null}
                  </td>
                  <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => apri(r)} title="Modifica" style={{ ...btn, padding: '5px 9px', background: '#fff', border: '1px solid #d1d5db', color: '#374151', marginRight: '6px' }}>✎</button>
                    <button onClick={() => elimina(r)} title="Elimina" style={{ ...btn, padding: '5px 9px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c' }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modale aggiungi/modifica */}
      {modal && (
        <div onClick={() => setModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', padding: '20px', width: '100%', maxWidth: '520px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700 }}>{form.id ? 'Modifica contatto' : 'Nuovo contatto'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={sub}>Destinatario *</label><input style={inp} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={sub}>Indirizzo</label><input style={inp} value={form.indirizzo} onChange={e => setForm({ ...form, indirizzo: e.target.value })} /></div>
              <div><label style={sub}>Città</label><input style={inp} value={form.citta} onChange={e => setForm({ ...form, citta: e.target.value })} /></div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}><label style={sub}>CAP</label><input style={inp} value={form.cap} onChange={e => setForm({ ...form, cap: e.target.value })} /></div>
                <div style={{ width: '70px' }}><label style={sub}>Prov.</label><input style={inp} maxLength={2} value={form.provincia} onChange={e => setForm({ ...form, provincia: e.target.value.toUpperCase() })} /></div>
              </div>
              <div><label style={sub}>Telefono</label><input style={inp} value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} /></div>
              <div><label style={sub}>Email</label><input style={inp} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button style={{ ...btn, background: '#fff', border: '1px solid #d1d5db', color: '#374151' }} onClick={() => setModal(false)}>Annulla</button>
              <button style={{ ...btn, background: ACCENT, color: '#fff', opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={salva}>{saving ? 'Salvo…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
