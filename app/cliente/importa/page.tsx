'use client'

import { useEffect, useRef, useState } from 'react'

const ACCENT = '#f97316'

type Ordine = {
  id: string
  destinatario: string
  indirizzo: string
  cap: string
  localita: string
  provincia: string
  country: string
  telefono: string | null
  email_destinatario: string | null
  peso: number | null
  colli: number
  contrassegno: number
  contenuto: string | null
  note: string | null
  rif_mittente: string | null
  rif_destinatario: string | null
  order_id: string | null
  totale_ordine: number | null
  fonte: string
  stato: string
  errore: string | null
  created_at: string
}

type Corriere = { id: string; nome: string; tipo: string }

const STATO: Record<string, { t: string; c: string; bg: string }> = {
  da_spedire: { t: 'Da spedire', c: '#b45309', bg: '#fef3c7' },
  spedito:    { t: 'Spedito',    c: '#15803d', bg: '#dcfce7' },
  errore:     { t: 'Errore',     c: '#b91c1c', bg: '#fee2e2' },
  archiviato: { t: 'Archiviato', c: '#6b7280', bg: '#f3f4f6' },
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '20px',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#888',
  textTransform: 'uppercase', letterSpacing: '.03em', padding: '10px 12px',
  borderBottom: '1px solid #eee', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  fontSize: '13px', color: '#333', padding: '11px 12px', borderBottom: '1px solid #f2f2f2',
  whiteSpace: 'nowrap',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600, color: '#888',
  textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '4px',
}
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: '13px',
  border: '1px solid #ddd', borderRadius: '6px', color: '#1a1a1a', outline: 'none',
}

export default function ImportaOrdiniPage() {
  const [ordini, setOrdini] = useState<Ordine[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Modal modifica
  const [editing, setEditing] = useState<Ordine | null>(null)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  // Spedizione
  const [corrieri, setCorrieri] = useState<Corriere[]>([])
  const [filtro, setFiltro] = useState<string>('min') // 'min' | corriere_id
  const [spedendo, setSpedendo] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function loadOrdini() {
    setLoading(true)
    try {
      const res = await fetch('/api/ordini/lista')
      const data = await res.json()
      if (res.ok) setOrdini(data.ordini || [])
      else setMsg({ type: 'err', text: data.error || 'Errore nel caricamento' })
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete' })
    } finally {
      setLoading(false)
    }
  }

  async function loadCorrieri() {
    try {
      const res = await fetch('/api/cliente/corrieri')
      const data = await res.json()
      if (res.ok) setCorrieri(data.corrieri || [])
    } catch { /* silente */ }
  }

  useEffect(() => { loadOrdini(); loadCorrieri() }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/ordini/importa', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        const extra = data.scartati ? ` — ${data.scartati} righe scartate` : ''
        setMsg({ type: 'ok', text: `${data.importati} ordini importati${extra}` })
        loadOrdini()
      } else {
        setMsg({ type: 'err', text: data.error || 'Errore durante l\'importazione' })
      }
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete durante l\'upload' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function toggle(id: string) {
    setSel(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleAll() {
    setSel(prev => (prev.size === ordini.length ? new Set() : new Set(ordini.map(o => o.id))))
  }

  async function eliminaSelezionati() {
    if (!sel.size) return
    if (!confirm(`Eliminare ${sel.size} ordini selezionati?`)) return
    try {
      const res = await fetch('/api/ordini/elimina', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(sel) }),
      })
      const data = await res.json()
      if (res.ok) { setSel(new Set()); loadOrdini() }
      else setMsg({ type: 'err', text: data.error || 'Errore eliminazione' })
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete' })
    }
  }

  function scaricaTemplate() {
    const csv = [
      'destinatario;indirizzo;cap;localita;provincia;country;peso;colli;contrassegno;telefono;email_destinatario;contenuto;note;rif_mittente;rif_destinatario;order_id;totale_ordine',
      'Mario Rossi;"Via Roma, 20";58100;Grosseto;GR;IT;1;1;25.5;3435556667;mario@example.com;frame 20x20;Fragile;Amazon;Mario Rossi;21545-45454;25.5',
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'template_ordini_moovexpress.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Modifica ────────────────────────────────────────────────────────────
  function openEdit(o: Ordine) {
    setEditing(o)
    setForm({ ...o })
    setFormErr(null)
  }
  function closeEdit() { setEditing(null); setFormErr(null) }
  function setF(k: string, v: any) { setForm((prev: any) => ({ ...prev, [k]: v })) }

  async function saveEdit() {
    if (!editing) return
    for (const k of ['destinatario', 'indirizzo', 'cap', 'localita', 'provincia']) {
      if (!String(form[k] ?? '').trim()) { setFormErr('Compila tutti i campi obbligatori (*)'); return }
    }
    setSaving(true)
    setFormErr(null)
    try {
      const res = await fetch('/api/ordini/modifica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...form }),
      })
      const data = await res.json()
      if (res.ok) { closeEdit(); loadOrdini() }
      else setFormErr(data.error || 'Errore salvataggio')
    } catch {
      setFormErr('Errore di rete')
    } finally {
      setSaving(false)
    }
  }

  // ── Spedisci selezionati ──────────────────────────────────────────────────
  async function spedisciSelezionati() {
    if (!sel.size || spedendo) return

    // Ordini spedibili tra quelli selezionati
    const targets = ordini.filter(o => sel.has(o.id) && (o.stato === 'da_spedire' || o.stato === 'errore'))
    if (!targets.length) { setMsg({ type: 'err', text: 'Nessun ordine spedibile selezionato' }); return }

    // Mittente dal profilo cliente (route dedicata)
    setMsg(null)
    let mitt: any
    try {
      const res = await fetch('/api/cliente/mittente')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Errore')
      mitt = data.mittente
    } catch {
      setMsg({ type: 'err', text: 'Impossibile leggere i dati del mittente' }); return
    }
    const shipFrom = {
      name: mitt?.nome || '', company: mitt?.nome || '',
      street1: mitt?.indirizzo || '', street2: '',
      city: mitt?.citta || '', state: mitt?.provincia || '',
      postalCode: mitt?.cap || '', country: 'IT',
      phone: mitt?.telefono || '', email: mitt?.email || '',
    }
    if (!shipFrom.street1 || !shipFrom.city || !shipFrom.state || !shipFrom.postalCode) {
      setMsg({ type: 'err', text: 'Indirizzo mittente mancante: compila l\'indirizzo del cliente in Mio Account, poi riprova' })
      return
    }

    setSpedendo(true)
    setProgress({ done: 0, total: targets.length })
    let ok = 0, ko = 0

    for (let i = 0; i < targets.length; i++) {
      const o = targets[i]
      try {
        const packages = [{ length: 20, width: 15, height: 10, weight: o.peso || 1 }]
        const shipTo = {
          name: o.destinatario, company: '',
          street1: o.indirizzo, street2: '',
          city: o.localita, state: o.provincia,
          postalCode: o.cap, country: o.country || 'IT',
          phone: o.telefono || '', email: o.email_destinatario || '',
        }

        // 1) Tariffe
        const tRes = await fetch('/api/spedizioni/tariffe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages, shipFrom, shipTo, codValue: o.contrassegno || 0, insuranceValue: 0, notes: o.note || '' }),
        })
        const tariffe = await tRes.json()
        if (!Array.isArray(tariffe) || !tariffe.length) {
          throw new Error(tariffe?.error || 'Nessuna tariffa disponibile')
        }

        // 2) Scelta corriere
        let scelta: any
        if (filtro === 'min') {
          scelta = tariffe.reduce((a: any, b: any) =>
            parseFloat(b.total_price) < parseFloat(a.total_price) ? b : a)
        } else {
          scelta = tariffe.find((t: any) => String(t._corriere_id) === String(filtro))
          if (!scelta) throw new Error('Corriere selezionato non disponibile per questo ordine')
        }
        const corriereId = scelta._corriere_id
        if (!corriereId) throw new Error('Corriere non identificato (listino senza corriere)')

        // 3) Crea spedizione
        const cRes = await fetch('/api/spedizioni/crea', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            _corriere_id: corriereId,
            totalPrice: scelta.total_price,
            packages,
            shipFrom, shipTo,
            notes: o.note || '', insuranceValue: 0, codValue: o.contrassegno || 0,
            contenuto: o.contenuto || '',
          }),
        })
        const cData = await cRes.json()
        if (!cRes.ok || cData.error) throw new Error(cData?.error || 'Errore creazione spedizione')

        // 4) Marca come spedito
        await fetch('/api/ordini/aggiorna-stato', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: o.id, stato: 'spedito', numero: cData.numero }),
        })
        ok++
      } catch (e: any) {
        await fetch('/api/ordini/aggiorna-stato', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: o.id, stato: 'errore', errore: String(e?.message || e) }),
        })
        ko++
      }
      setProgress({ done: i + 1, total: targets.length })
    }

    setSpedendo(false)
    setProgress(null)
    setSel(new Set())
    await loadOrdini()
    setMsg({
      type: ko ? 'err' : 'ok',
      text: `Spedizioni completate: ${ok} riuscite${ko ? `, ${ko} in errore (vedi colonna Stato)` : ''}`,
    })
  }

  const allChecked = ordini.length > 0 && sel.size === ordini.length
  const modificabile = (o: Ordine) => o.stato === 'da_spedire' || o.stato === 'errore'

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Importa Ordini</h1>
        <p style={{ color: '#999', fontSize: '13px', marginTop: '4px' }}>
          Carica un file CSV con i tuoi ordini per generare le spedizioni
        </p>
      </div>

      {/* Messaggio */}
      {msg && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
          border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
          background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
          color: msg.type === 'ok' ? '#15803d' : '#b91c1c',
        }}>
          {msg.text}
        </div>
      )}

      {/* Upload */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '12px' }}>
              1. Seleziona il file (CSV o Excel)
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} style={{ display: 'none' }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px',
                padding: '10px 18px', fontSize: '13px', fontWeight: 600,
                cursor: uploading ? 'default' : 'pointer', opacity: uploading ? .6 : 1,
              }}
            >
              {uploading ? 'Caricamento…' : 'Carica file CSV'}
            </button>
            <button
              onClick={scaricaTemplate}
              style={{
                marginLeft: '10px', background: '#fff', color: '#555', border: '1px solid #ddd',
                borderRadius: '8px', padding: '10px 14px', fontSize: '13px', cursor: 'pointer',
              }}
            >
              Scarica template
            </button>
          </div>

          <div style={{ flex: '1 1 320px', fontSize: '12.5px', color: '#666', lineHeight: 1.6 }}>
            Puoi caricare direttamente l&apos;<b>export ordini di Shopify</b> (o file Excel di
            eBay/Amazon): il sistema riconosce da solo le colonne e raggruppa gli ordini con più
            prodotti.<br />
            In alternativa usa il nostro <b>template</b> — colonne obbligatorie:{' '}
            <b style={{ color: '#b45309' }}>destinatario, indirizzo, cap, localita, provincia</b>.<br />
            Formati: <b>.csv</b> o <b>.xlsx</b>.
          </div>
        </div>
      </div>

      {/* Tabella */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ fontSize: '13px', color: '#666' }}>
            {spedendo && progress
              ? `Spedizione ${progress.done}/${progress.total} in corso…`
              : (sel.size > 0 ? `${sel.size} selezionati` : `${ordini.length} ordini`)}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={eliminaSelezionati}
              disabled={!sel.size || spedendo}
              style={{
                background: '#fff', color: sel.size && !spedendo ? '#b91c1c' : '#bbb',
                border: `1px solid ${sel.size && !spedendo ? '#fecaca' : '#eee'}`, borderRadius: '8px',
                padding: '8px 14px', fontSize: '13px', cursor: sel.size && !spedendo ? 'pointer' : 'default',
              }}
            >
              Elimina selezionati
            </button>

            <span style={{ fontSize: '12.5px', color: '#666' }}>Spedisci con:</span>
            <select
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
              disabled={spedendo}
              style={{ ...inp, width: 'auto', minWidth: '200px', padding: '8px 10px' }}
            >
              <option value="min">Prezzo minore (automatico)</option>
              {corrieri.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            <button
              onClick={spedisciSelezionati}
              disabled={!sel.size || spedendo}
              style={{
                background: sel.size && !spedendo ? ACCENT : '#f3f4f6',
                color: sel.size && !spedendo ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: '8px', padding: '8px 16px',
                fontSize: '13px', fontWeight: 600,
                cursor: sel.size && !spedendo ? 'pointer' : 'not-allowed',
              }}
            >
              {spedendo ? 'Spedizione in corso…' : 'Spedisci selezionati'}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : ordini.length === 0 ? (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#999' }}>Nessun ordine importato</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: '36px' }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th style={th}>Destinatario</th>
                  <th style={th}>Località</th>
                  <th style={th}>CAP</th>
                  <th style={th}>Prov</th>
                  <th style={th}>Telefono</th>
                  <th style={th}>Peso</th>
                  <th style={th}>Colli</th>
                  <th style={th}>Contrassegno</th>
                  <th style={th}>Order ID</th>
                  <th style={th}>Stato</th>
                  <th style={{ ...th, width: '60px', textAlign: 'center' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {ordini.map(o => {
                  const s = STATO[o.stato] || STATO.da_spedire
                  return (
                    <tr key={o.id} style={{ background: sel.has(o.id) ? '#fff7ed' : '#fff' }}>
                      <td style={td}>
                        <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} disabled={spedendo} />
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: '#1a1a1a' }}>
                        {o.destinatario}
                        <div style={{ fontSize: '11.5px', color: '#999', fontWeight: 400 }}>{o.indirizzo}</div>
                      </td>
                      <td style={td}>{o.localita}</td>
                      <td style={td}>{o.cap}</td>
                      <td style={td}>{o.provincia}</td>
                      <td style={td}>{o.telefono || '—'}</td>
                      <td style={td}>{o.peso != null ? `${o.peso} kg` : '—'}</td>
                      <td style={td}>{o.colli}</td>
                      <td style={td}>{o.contrassegno ? `€ ${Number(o.contrassegno).toFixed(2)}` : '—'}</td>
                      <td style={td}>{o.order_id || '—'}</td>
                      <td style={td}>
                        <span
                          title={o.stato === 'errore' && o.errore ? o.errore : undefined}
                          style={{
                            fontSize: '11.5px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
                            color: s.c, background: s.bg, cursor: o.stato === 'errore' ? 'help' : 'default',
                          }}
                        >
                          {s.t}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {modificabile(o) ? (
                          <button
                            onClick={() => openEdit(o)}
                            title="Modifica ordine"
                            disabled={spedendo}
                            style={{
                              background: '#fff', border: '1px solid #e5e5e5', borderRadius: '6px',
                              padding: '4px 8px', fontSize: '13px', cursor: spedendo ? 'default' : 'pointer', color: '#555',
                            }}
                          >
                            ✎
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Modifica */}
      {editing && (
        <div
          onClick={closeEdit}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '10px', width: '100%', maxWidth: '640px',
              boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Modifica ordine</div>
              <button onClick={closeEdit} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Destinatario *</label>
                <input style={inp} value={form.destinatario ?? ''} onChange={e => setF('destinatario', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Indirizzo *</label>
                <input style={inp} value={form.indirizzo ?? ''} onChange={e => setF('indirizzo', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>CAP *</label>
                <input style={inp} value={form.cap ?? ''} onChange={e => setF('cap', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Località *</label>
                <input style={inp} value={form.localita ?? ''} onChange={e => setF('localita', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Provincia *</label>
                <input style={inp} value={form.provincia ?? ''} onChange={e => setF('provincia', e.target.value)} maxLength={4} />
              </div>
              <div>
                <label style={lbl}>Country</label>
                <input style={inp} value={form.country ?? ''} onChange={e => setF('country', e.target.value)} maxLength={2} />
              </div>
              <div>
                <label style={lbl}>Telefono</label>
                <input style={inp} value={form.telefono ?? ''} onChange={e => setF('telefono', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Email destinatario</label>
                <input style={inp} value={form.email_destinatario ?? ''} onChange={e => setF('email_destinatario', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Peso (kg)</label>
                <input style={inp} type="number" step="0.1" value={form.peso ?? ''} onChange={e => setF('peso', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Colli</label>
                <input style={inp} type="number" min="1" value={form.colli ?? ''} onChange={e => setF('colli', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Contrassegno (€)</label>
                <input style={inp} type="number" step="0.01" value={form.contrassegno ?? ''} onChange={e => setF('contrassegno', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Totale ordine (€)</label>
                <input style={inp} type="number" step="0.01" value={form.totale_ordine ?? ''} onChange={e => setF('totale_ordine', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Order ID</label>
                <input style={inp} value={form.order_id ?? ''} onChange={e => setF('order_id', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Rif. mittente</label>
                <input style={inp} value={form.rif_mittente ?? ''} onChange={e => setF('rif_mittente', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Contenuto</label>
                <input style={inp} value={form.contenuto ?? ''} onChange={e => setF('contenuto', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Note</label>
                <input style={inp} value={form.note ?? ''} onChange={e => setF('note', e.target.value)} />
              </div>

              {formErr && (
                <div style={{ gridColumn: '1 / -1', color: '#b91c1c', fontSize: '12.5px' }}>{formErr}</div>
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={closeEdit}
                style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1 }}
              >
                {saving ? 'Salvataggio…' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
