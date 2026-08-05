'use client'
import { useState, useEffect, useRef } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

const inpS: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }

export default function ArticoliCliente() {
  const dialog = useDialog()
  const [articoli, setArticoli] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(false)
  const [edit, setEdit] = useState<any>(null)
  const [sku, setSku] = useState(''); const [nome, setNome] = useState(''); const [asin, setAsin] = useState('')
  const [peso, setPeso] = useState(''); const [lung, setLung] = useState(''); const [larg, setLarg] = useState(''); const [alt, setAlt] = useState('')
  // VARIANTI: `prodotto` raggruppa (es. "T-SHIRT LOGO"), gli attributi dicono in cosa differiscono.
  // Sono coppie libere — colore, taglia, gusto — perche' cambiano da mestiere a mestiere.
  const [prodotto, setProdotto] = useState('')
  const [attrs, setAttrs] = useState<{ k: string; v: string }[]>([])
  // Movimento di magazzino: carico merce arrivata, oppure conteggio (inventario).
  const [giacArt, setGiacArt] = useState<any>(null)
  const [giacTipo, setGiacTipo] = useState<'carico' | 'inventario'>('carico')
  const [giacQta, setGiacQta] = useState(''); const [giacNota, setGiacNota] = useState('')
  const [giacSaving, setGiacSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pacchi, setPacchi] = useState<any[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [paccoSel, setPaccoSel] = useState('')
  const [assegnando, setAssegnando] = useState(false)

  useEffect(() => { carica(); caricaPacchi() }, [])
  function carica() {
    setLoading(true)
    fetch('/api/cliente/articoli').then(r => r.json()).then(d => { setArticoli(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false))
  }
  function caricaPacchi() { fetch('/api/cliente/pacchi').then(r => r.json()).then(d => setPacchi(Array.isArray(d) ? d : [])).catch(() => {}) }
  function toggle(id: string) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function assegnaPacco() {
    if (!paccoSel) { await dialog.alert({ title: 'Pacco mancante', message: 'Scegli il pacco a cui assegnare gli articoli selezionati.' }); return }
    const skus = articoli.filter(a => sel.has(a.id)).map(a => a.sku).filter(Boolean)
    if (!skus.length) return
    setAssegnando(true)
    const res = await fetch('/api/cliente/pacchi/assegna', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paccoId: paccoSel, skus }) })
    const d = await res.json().catch(() => ({})); setAssegnando(false)
    if (!res.ok || d.error) setMsg({ t: 'err', x: d.error || 'Errore assegnazione' })
    else { setMsg({ t: 'ok', x: `${skus.length} articoli assegnati al pacco` }); setSel(new Set()); caricaPacchi() }
  }
  function apri(a: any) {
    if (a) {
      setEdit(a); setSku(a.sku); setNome(a.nome || ''); setAsin(a.asin || ''); setPeso(String(a.peso ?? ''))
      setLung(String(a.lunghezza ?? '')); setLarg(String(a.larghezza ?? '')); setAlt(String(a.altezza ?? ''))
      setProdotto(a.prodotto || '')
      setAttrs(Object.entries(a.attributi || {}).map(([k, v]) => ({ k, v: String(v ?? '') })))
    } else {
      setEdit(null); setSku(''); setNome(''); setAsin(''); setPeso(''); setLung(''); setLarg(''); setAlt('')
      setProdotto(''); setAttrs([])
    }
    setModal(true)
  }
  async function salva() {
    if (!sku.trim()) { await dialog.alert({ title: 'SKU mancante', message: 'Inserisci lo SKU.' }); return }
    setSaving(true)
    const attributi: Record<string, string> = {}
    for (const a of attrs) { const k = a.k.trim(); if (k && a.v.trim()) attributi[k] = a.v.trim() }
    const body: any = { sku, nome, asin, peso, lunghezza: lung, larghezza: larg, altezza: alt,
      prodotto, attributi: Object.keys(attributi).length ? attributi : null }
    if (edit) body.id = edit.id
    const res = await fetch('/api/cliente/articoli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json(); setSaving(false)
    if (d.error) { await dialog.alert({ title: 'Errore', message: d.error }); return }
    setModal(false); carica()
  }
  async function salvaGiacenza() {
    const n = parseInt(giacQta, 10)
    if (!isFinite(n)) { await dialog.alert({ title: 'Quantita mancante', message: 'Scrivi quanti pezzi.' }); return }
    setGiacSaving(true)
    const res = await fetch('/api/cliente/articoli/giacenza', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articolo_id: giacArt.id, tipo: giacTipo, quantita: n, nota: giacNota }),
    })
    const d = await res.json().catch(() => ({})); setGiacSaving(false)
    if (!res.ok || d.error) { await dialog.alert({ title: 'Errore', message: d.error || 'Non riuscito' }); return }
    setGiacArt(null); setGiacQta(''); setGiacNota(''); carica()
  }
  function apriGiacenza(a: any, tipo: 'carico' | 'inventario') {
    setGiacArt(a); setGiacTipo(tipo); setGiacNota('')
    setGiacQta(tipo === 'inventario' ? String(a.quantita ?? 0) : '')
  }
  async function elimina(id: string) {
    if (!await dialog.confirm({ title: 'Eliminare l\'articolo?', danger: true, confirmText: 'Elimina' })) return
    await fetch('/api/cliente/articoli?id=' + id, { method: 'DELETE' }); carica()
  }
  async function svuota() {
    if (!await dialog.confirm({ title: 'Svuotare tutto il catalogo?', message: 'L\'operazione non è reversibile.', danger: true, confirmText: 'Svuota' })) return
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

  const filtrati = q.trim() ? articoli.filter(a => (a.sku || '').toLowerCase().includes(q.toLowerCase()) || (a.nome || '').toLowerCase().includes(q.toLowerCase()) || (a.asin || '').toLowerCase().includes(q.toLowerCase()) || (a.prodotto || '').toLowerCase().includes(q.toLowerCase())) : articoli
  // SKU → pacco assegnato (per mostrare la colonna Pacco): ogni pacco ha una lista di SKU nel campo `sku`.
  const skuToPacco = new Map<string, any>()
  for (const p of pacchi) for (const s of String(p.sku || '').split(/[\s,;]+/)) { const k = s.trim().toLowerCase(); if (k) skuToPacco.set(k, p) }
  function toggleAll() { setSel(s => s.size === filtrati.length ? new Set() : new Set(filtrati.map(a => a.id))) }
  const th = { textAlign: 'left' as const, padding: '10px 14px', fontSize: '12px', fontWeight: '700' as const, color: '#1a1a1a', borderBottom: '1px solid #e8e8e8' }
  const td = { padding: '10px 14px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f5f5f5' }
  const lbl = { fontSize: '12px', fontWeight: '600' as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '4px' }

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '400', color: '#1a1a1a', margin: '0 0 6px' }}>Catalogo articoli</h1>
      <p style={{ color: '#666', fontSize: '13px', margin: '0 0 20px' }}>SKU → peso/misure. Seleziona più articoli e <b>assegnali a un pacco</b> in blocco (peso+misure dalla scatola), invece di scriverli a mano nei Pacchi. In Importa Ordini il peso/misure vengono applicati in automatico allo SKU dell'ordine.</p>

      {msg && <div style={{ background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.t === 'ok' ? '#15803d' : '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{msg.x}</div>}

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #f0f0f0' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca SKU o nome…" style={{ ...inpS, flex: 1, minWidth: '200px' }} />
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ background: '#111827', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: importing ? 0.6 : 1 }}>{importing ? 'Import…' : '⬆ Importa da file (Shopify/Amazon)'}</button>
          <button onClick={() => apri(null)} style={{ background: '#f97316', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Aggiungi</button>
          {articoli.length > 0 && <button onClick={svuota} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', padding: '9px 12px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer' }}>Svuota</button>}
        </div>

        {articoli.length > 0 && (
          <div style={{ padding: '10px 16px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
            {pacchi.length === 0 ? (
              <span style={{ fontSize: '13px', color: '#9a3412' }}>💡 Crea prima un <b>Pacco</b> in Impostazioni → Pacchi, poi qui: spunta gli articoli e assegnali al pacco.</span>
            ) : (<>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#9a3412' }}>Assegna a un pacco:</span>
              <span style={{ fontSize: '12.5px', color: '#6b7280' }}>1) spunta gli articoli qui sotto → 2) scegli il pacco → 3) Assegna</span>
              <select value={paccoSel} onChange={e => setPaccoSel(e.target.value)} style={{ ...inpS, width: 'auto', minWidth: '220px' }}>
                <option value="">— scegli pacco —</option>
                {pacchi.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.peso}kg · {p.lunghezza}×{p.larghezza}×{p.altezza}cm</option>)}
              </select>
              <button onClick={assegnaPacco} disabled={assegnando || !paccoSel || sel.size === 0} style={{ background: '#f97316', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: (assegnando || !paccoSel || sel.size === 0) ? 'not-allowed' : 'pointer', opacity: (assegnando || !paccoSel || sel.size === 0) ? 0.5 : 1 }}>{assegnando ? 'Assegno…' : (sel.size > 0 ? `Assegna (${sel.size})` : 'Assegna')}</button>
              {sel.size > 0 && <button onClick={() => setSel(new Set())} style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Deseleziona ({sel.size})</button>}
            </>)}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : !articoli.length ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
            Nessun articolo. Importa il file <b>prodotti</b> di Shopify (Variant SKU + Variant Grams) o Amazon, oppure aggiungi a mano.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...th, width: '34px' }}><input type="checkbox" checked={filtrati.length > 0 && sel.size === filtrati.length} onChange={toggleAll} /></th><th style={th}>SKU</th><th style={th}>ASIN</th><th style={th}>Nome</th><th style={th}>Prodotto · variante</th><th style={th}>Giacenza</th><th style={th}>Peso (kg)</th><th style={th}>Misure (cm)</th><th style={th}>Pacco</th><th style={{ ...th, width: '110px' }}>Azioni</th></tr></thead>
              <tbody>
                {filtrati.map(a => { const pk = skuToPacco.get(String(a.sku || '').toLowerCase()); return (
                  <tr key={a.id} style={sel.has(a.id) ? { background: '#fff7ed' } : undefined}>
                    <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} /></td>
                    <td style={{ ...td, fontWeight: 600, color: '#f97316' }}>{a.sku}</td>
                    <td style={{ ...td, color: a.asin ? '#1a1a1a' : '#cbd5e1' }}>{a.asin || '—'}</td>
                    <td style={td}>{a.nome || '—'}</td>
                    <td style={td}>
                      {a.prodotto ? <div style={{ fontWeight: 600 }}>{a.prodotto}</div> : null}
                      {a.attributi && Object.keys(a.attributi).length ? (
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          {Object.entries(a.attributi).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </div>
                      ) : (!a.prodotto ? <span style={{ color: '#cbd5e1' }}>—</span> : null)}
                    </td>
                    <td style={td}>
                      {/* La giacenza puo' andare SOTTO ZERO: si spedisce comunque un pacco vero, e
                          un numero rosso si vede e si corregge. Bloccare fermerebbe il lavoro. */}
                      <span style={{ fontWeight: 700, fontSize: '14px', color: Number(a.quantita) < 0 ? '#b91c1c' : Number(a.quantita) > 0 ? '#15803d' : '#9ca3af' }}>
                        {Number(a.quantita ?? 0)}
                      </span>
                      <button onClick={() => apriGiacenza(a, 'carico')} title="Carica merce arrivata"
                        style={{ marginLeft: '8px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: '2px 7px' }}>+</button>
                      <button onClick={() => apriGiacenza(a, 'inventario')} title="Ho contato: correggi la giacenza"
                        style={{ marginLeft: '4px', background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '2px 7px' }}>=</button>
                    </td>
                    <td style={{ ...td, color: Number(a.peso || 0) > 0 ? '#1a1a1a' : (pk && Number(pk.peso) > 0 ? '#94a3b8' : '#cbd5e1') }}>{Number(a.peso || 0) > 0 ? `${Number(a.peso).toFixed(3).replace(/\.?0+$/, '')} kg` : (pk && Number(pk.peso) > 0 ? `↳ ${Number(pk.peso).toFixed(3).replace(/\.?0+$/, '')} kg` : '— (dal pacco)')}</td>
                    <td style={{ ...td, color: (a.lunghezza || a.larghezza || a.altezza) ? '#1a1a1a' : '#cbd5e1' }}>{(a.lunghezza || a.larghezza || a.altezza) ? `${a.lunghezza}×${a.larghezza}×${a.altezza}` : (pk ? `↳ ${pk.lunghezza}×${pk.larghezza}×${pk.altezza}` : '— (dal pacco)')}</td>
                    <td style={{ ...td, color: pk ? '#15803d' : '#cbd5e1', fontWeight: pk ? 600 : 400 }}>{pk ? pk.nome : '—'}</td>
                    <td style={td}>
                      <button onClick={() => apri(a)} style={{ background: 'transparent', color: '#f97316', border: 'none', cursor: 'pointer', fontSize: '13px', marginRight: '10px' }}>Edit</button>
                      <button onClick={() => elimina(a.id)} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>🗑</button>
                    </td>
                  </tr>
                )})}
                {!filtrati.length && <tr><td colSpan={10} style={{ padding: '24px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Nessun articolo per la ricerca.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {articoli.length > 0 && <div style={{ fontSize: '12px', color: '#999', marginTop: '10px' }}>{filtrati.length} di {articoli.length} articoli</div>}

      {giacArt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setGiacArt(null)}>
          <div style={{ background: '#fff', borderRadius: '10px', padding: '24px', width: '400px', maxWidth: '90%' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>
              {giacTipo === 'carico' ? 'Carica merce' : 'Correggi la giacenza'}
            </h2>
            <p style={{ fontSize: '12.5px', color: '#6b7280', margin: '0 0 16px' }}>
              {giacArt.sku}{giacArt.nome ? ` · ${giacArt.nome}` : ''} — adesso ne risultano <b>{Number(giacArt.quantita ?? 0)}</b>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={lbl}>{giacTipo === 'carico' ? 'Quanti pezzi sono arrivati' : 'Quanti pezzi ci sono davvero'}</label>
                <input type="number" step="1" value={giacQta} onChange={e => setGiacQta(e.target.value)} autoFocus style={inpS} />
              </div>
              <div><label style={lbl}>Nota <span style={{ fontWeight: 400, color: '#999' }}>(opzionale)</span></label>
                <input value={giacNota} onChange={e => setGiacNota(e.target.value)} placeholder={giacTipo === 'carico' ? 'es. bolla 1234' : 'es. conteggio del 5 agosto'} style={inpS} /></div>
              <div style={{ fontSize: '11.5px', color: '#999' }}>
                {giacTipo === 'carico'
                  ? 'Si aggiunge a quello che gia\u2019 c\u2019e\u2019. Resta scritto nel registro dell\u2019articolo.'
                  : 'Si scrive la differenza rispetto a quello che il sistema credeva, così resta la traccia di quanto mancava.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button onClick={() => setGiacArt(null)} style={{ padding: '9px 18px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer', fontSize: '13px', color: '#1a1a1a' }}>Annulla</button>
              <button onClick={salvaGiacenza} disabled={giacSaving} style={{ padding: '9px 18px', border: 'none', borderRadius: '6px', background: '#f97316', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, opacity: giacSaving ? 0.6 : 1 }}>{giacSaving ? 'Salvo…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setModal(false)}>
          <div style={{ background: '#fff', borderRadius: '10px', padding: '24px', width: '440px', maxWidth: '90%' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#1a1a1a', margin: '0 0 16px' }}>{edit ? 'Modifica articolo' : 'Aggiungi articolo'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><label style={lbl}>SKU</label><input value={sku} onChange={e => setSku(e.target.value)} disabled={!!edit} style={inpS} /></div>
              <div><label style={lbl}>Nome <span style={{ fontWeight: 400, color: '#999' }}>(opzionale)</span></label><input value={nome} onChange={e => setNome(e.target.value)} style={inpS} /></div>
              <div><label style={lbl}>ASIN <span style={{ fontWeight: 400, color: '#999' }}>(Amazon, opzionale)</span></label><input value={asin} onChange={e => setAsin(e.target.value)} style={inpS} /></div>
              {/* VARIANTI. Ogni variante e' una riga a se' col SUO SKU: la maglietta rossa S e la
                  nera L sono due articoli, con due giacenze. Qui si dice solo a quale PRODOTTO
                  appartengono e in cosa differiscono, cosi' a schermo stanno insieme. */}
              <div><label style={lbl}>Prodotto <span style={{ fontWeight: 400, color: '#999' }}>(raggruppa le varianti, opzionale)</span></label>
                <input value={prodotto} onChange={e => setProdotto(e.target.value)} placeholder="es. T-shirt logo" style={inpS} /></div>
              <div>
                <label style={lbl}>Variante <span style={{ fontWeight: 400, color: '#999' }}>(colore, taglia, gusto…)</span></label>
                {attrs.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                    <input value={a.k} onChange={e => setAttrs(x => x.map((y, j) => j === i ? { ...y, k: e.target.value } : y))} placeholder="colore" style={{ ...inpS, flex: 1 }} />
                    <input value={a.v} onChange={e => setAttrs(x => x.map((y, j) => j === i ? { ...y, v: e.target.value } : y))} placeholder="rosso" style={{ ...inpS, flex: 1 }} />
                    <button onClick={() => setAttrs(x => x.filter((_, j) => j !== i))} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', padding: '0 10px', fontSize: '13px' }}>×</button>
                  </div>
                ))}
                <button onClick={() => setAttrs(x => [...x, { k: '', v: '' }])} style={{ background: '#fff', color: '#f97316', border: '1px dashed #fdba74', borderRadius: '6px', cursor: 'pointer', padding: '6px 12px', fontSize: '12.5px', fontWeight: 600 }}>+ aggiungi variante</button>
              </div>
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
