'use client'

import { useEffect, useRef, useState } from 'react'

const ACCENT = '#f97316' // arancione portale (allineato all'avatar/credito)

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
  order_id: string | null
  totale_ordine: number | null
  fonte: string
  stato: string
  errore: string | null
  created_at: string
}

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

export default function ImportaOrdiniPage() {
  const [ordini, setOrdini] = useState<Ordine[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => { loadOrdini() }, [])

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
    a.download = 'template_ordini_spedixpro.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const allChecked = ordini.length > 0 && sel.size === ordini.length

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
              1. Seleziona il file CSV
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
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
            Il file deve avere nella prima riga i nomi delle colonne. Obbligatorie:{' '}
            <b style={{ color: '#b45309' }}>destinatario, indirizzo, cap, localita, provincia</b>.<br />
            Opzionali: country, peso, colli, contrassegno, telefono, email_destinatario, contenuto,
            note, rif_mittente, rif_destinatario, order_id, totale_ordine.<br />
            Separatore <b>;</b> (punto e virgola).
          </div>
        </div>
      </div>

      {/* Tabella */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ fontSize: '13px', color: '#666' }}>
            {sel.size > 0 ? `${sel.size} selezionati` : `${ordini.length} ordini`}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={eliminaSelezionati}
              disabled={!sel.size}
              style={{
                background: '#fff', color: sel.size ? '#b91c1c' : '#bbb',
                border: `1px solid ${sel.size ? '#fecaca' : '#eee'}`, borderRadius: '8px',
                padding: '8px 14px', fontSize: '13px', cursor: sel.size ? 'pointer' : 'default',
              }}
            >
              Elimina selezionati
            </button>
            <button
              disabled
              title="Disponibile a breve — richiede indirizzo mittente e calcolo tariffe"
              style={{
                background: '#f3f4f6', color: '#9ca3af', border: '1px solid #eee',
                borderRadius: '8px', padding: '8px 14px', fontSize: '13px', cursor: 'not-allowed',
              }}
            >
              Spedisci selezionati
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
                </tr>
              </thead>
              <tbody>
                {ordini.map(o => {
                  const s = STATO[o.stato] || STATO.da_spedire
                  return (
                    <tr key={o.id} style={{ background: sel.has(o.id) ? '#fff7ed' : '#fff' }}>
                      <td style={td}>
                        <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
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
                        <span style={{
                          fontSize: '11.5px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
                          color: s.c, background: s.bg,
                        }}>
                          {s.t}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
