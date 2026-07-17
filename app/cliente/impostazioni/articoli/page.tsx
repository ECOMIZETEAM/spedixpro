'use client'
import { useState, useEffect, useRef } from 'react'

const inpS: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }

export default function ArticoliCliente() {
  const [articoli, setArticoli] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(false)
  const [edit, setEdit] = useState<any>(null)
  const [sku, setSku] = useState(''); const [nome, setNome] = useState('')
  const [peso, setPeso] = useState(''); const [lung, setLung] = useState(''); const [larg, setLarg] = useState(''); const [alt, setAlt] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { carica() }, [])
  function carica() {
    setLoading(true)
    fetch('/api/cliente/articoli').then(r => r.json()).then(d => { setArticoli(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false))
  }
  function apri(a: any) {
    if (a) { setEdit(a); setSku(a.sku); setNome(a.nome || ''); setPeso(String(a.peso ?? '')); setLung(String(a.lunghezza ?? '')); setLarg(String(a.larghezza ?? '')); setAlt(String(a.altezza ?? '')) }
    else { setEdit(null); setSku(''); setNome(''); setPeso(''); setLung(''); setLarg(''); setAlt('') }
    setModal(true)
  }
  async function salva() {
    if (!sku.trim()) { alert('Inserisci lo SKU'); return }
    setSaving(true)
    const body: any = { sku, nome, peso, lunghezza: lung, larghezza: larg, altezza: alt }
    if (edit) body.id = edit.id
    const res = await fetch('/api/cliente/articoli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json(); setSaving(false)
    if (d.error) { alert('Errore: ' + d.error); return }
    setModal(false); carica()
  }
  async function elimina(id: string) {
    if (!confirm('Eliminare questo articolo?')) return
    await fetch('/api/cliente/articoli?id=' + id, { method: 'DELETE' }); carica()
  }
  async function svuota() {
    if (!confirm('Svuotare TUTTO il catalogo articoli? L\'operazione non è reversibile.')) return
    await fetch('/api/cliente/articoli?tutti=1', { method: 'DELETE' }); carica()
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setImporting(true); setMsg(null)
    try {
      const fd = new FormData(); fd.append('file', f)
      const res = await fetch('/api/cliente/articoli/importa', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok || d.error) { setMsg({ t: 'err', x: d.error || 'Errore import' }) }
      else setMsg({ t: 'ok', x: `${d.salvati} articoli importati${d.scartati ? ` (${d.scartati} righe senza SKU saltate)` : ''}${d.colonne?.misure ? '' : ' — misure non presenti nel file (verranno dal pacco)'}` })
      carica()
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const filtrati = q.trim() ? articoli.filter(a => (a.sku || '').toLowerCase().includes(q.toLowerCase()) || (a.nome || '').toLowerCase().includes(q.toLowerCase())) : articoli
  const th = { textAlign: 'left' as const, padding: '10px 14px', fontSize: '12px', fontWeight: '700' as const, color: '#1a1a1a', borderBottom: '1px solid #e8e8e8' }
  const td = { padding: '10px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f5f5f5' }
  const lbl = { fontSize: '12px', fontWeight: '600' as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '4px' }

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '400', color: '#1a1a1a', margin: '0 0 6px' }}>Catalogo articoli</h1>
      <p style={{ color: '#666', fontSize: '13px', margin: '0 0 20px' }}>SKU → peso (e misure se disponibili). In Importa Ordini il peso viene applicato in automatico allo SKU dell'ordine; le misure, se mancano, vengono dal pacco.</p>

      {msg && <div style={{ background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.t === 'ok' ? '#15803d' : '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{msg.x}</div>}

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #f0f0f0' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca SKU o nome…" style={{ ...inpS, flex: 1, minWidth: '200px' }} />
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ background: '#111827', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: importing ? 0.6 : 1 }}>{importing ? 'Import…' : '⬆ Importa da file (Shopify/Amazon)'}</button>
          <button onClick={() => apri(null)} style={{ background: '#f97316', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Aggiungi</button>
          {articoli.length > 0 && <button onClick={svuota} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', padding: '9px 12px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer' }}>Svuota</button>}
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : !articoli.length ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
            Nessun articolo. Importa il file <b>prodotti</b> di Shopify (Variant SKU + Variant Grams) o Amazon, oppure aggiungi a mano.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>SKU</th><th style={th}>Nome</th><th style={th}>Peso (kg)</th><th style={th}>Misure (cm)</th><th style={{ ...th, width: '110px' }}>Azioni</th></tr></thead>
              <tbody>
                {filtrati.map(a => (
                  <tr key={a.id}>
                    <td style={{ ...td, fontWeight: 600, color: '#f97316' }}>{a.sku}</td>
                    <td style={td}>{a.nome || '—'}</td>
                    <td style={td}>{Number(a.peso || 0).toFixed(3).replace(/\.?0+$/, '')} kg</td>
                    <td style={{ ...td, color: (a.lunghezza || a.larghezza || a.altezza) ? '#1a1a1a' : '#cbd5e1' }}>{(a.lunghezza || a.larghezza || a.altezza) ? `${a.lunghezza}×${a.larghezza}×${a.altezza}` : '— (dal pacco)'}</td>
                    <td style={td}>
                      <button onClick={() => apri(a)} style={{ background: 'transparent', color: '#f97316', border: 'none', cursor: 'pointer', fontSize: '13px', marginRight: '10px' }}>Edit</button>
                      <button onClick={() => elimina(a.id)} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>🗑</button>
                    </td>
                  </tr>
                ))}
                {!filtrati.length && <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Nessun articolo per la ricerca.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {articoli.length > 0 && <div style={{ fontSize: '12px', color: '#999', marginTop: '10px' }}>{filtrati.length} di {articoli.length} articoli</div>}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setModal(false)}>
          <div style={{ background: '#fff', borderRadius: '10px', padding: '24px', width: '440px', maxWidth: '90%' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#1a1a1a', margin: '0 0 16px' }}>{edit ? 'Modifica articolo' : 'Aggiungi articolo'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><label style={lbl}>SKU</label><input value={sku} onChange={e => setSku(e.target.value)} disabled={!!edit} style={inpS} /></div>
              <div><label style={lbl}>Nome <span style={{ fontWeight: 400, color: '#999' }}>(opzionale)</span></label><input value={nome} onChange={e => setNome(e.target.value)} style={inpS} /></div>
              <div><label style={lbl}>Peso (kg)</label><input type="number" step="0.001" value={peso} onChange={e => setPeso(e.target.value)} style={inpS} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div><label style={lbl}>Lungh. (cm)</label><input type="number" value={lung} onChange={e => setLung(e.target.value)} style={inpS} /></div>
                <div><label style={lbl}>Largh. (cm)</label><input type="number" value={larg} onChange={e => setLarg(e.target.value)} style={inpS} /></div>
                <div><label style={lbl}>Alt. (cm)</label><input type="number" value={alt} onChange={e => setAlt(e.target.value)} style={inpS} /></div>
              </div>
              <div style={{ fontSize: '11px', color: '#999' }}>Le misure sono opzionali: se le lasci vuote, in spedizione vengono usate quelle del pacco.</div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(false)} style={{ padding: '9px 18px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer', fontSize: '13px', color: '#1a1a1a' }}>Annulla</button>
              <button onClick={salva} disabled={saving} style={{ padding: '9px 18px', border: 'none', borderRadius: '6px', background: '#f97316', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600', opacity: saving ? 0.6 : 1 }}>{saving ? 'Salvataggio…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
