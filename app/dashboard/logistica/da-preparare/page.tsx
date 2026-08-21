'use client'
import { useEffect, useState } from 'react'
import { Testata, Avviso, Vuoto, card, cardH, th, td, btn, btnSec } from '../comune'
import SelettoreArticoli, { type ArticoloCat, type RigaArticolo } from '@/app/components/SelettoreArticoli'

// SPEDIZIONI DA PREPARARE (fulfillment logistica).
// Lo staff del master vede qui i pacchi dei clienti "logistica" da preparare fisicamente, con gli
// articoli da prelevare, e li segna "Preparata". Il conteggio guida il pallino rosso sul menu.

type Riga = any

export default function DaPreparare() {
  const [righe, setRighe] = useState<Riga[]>([])
  const [articoli, setArticoli] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [facendo, setFacendo] = useState<string>('')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  // Due viste sulla stessa lista: i pacchi ancora DA preparare (default, operativo) e lo STORICO di
  // quelli già preparati — così la logistica può ritrovare un pacco vecchio senza cercarlo altrove.
  const [vista, setVista] = useState<'da_preparare' | 'storico'>('da_preparare')

  // Editor articoli (la logistica aggiunge/modifica cosa c'e' nel pacco se il cliente l'ha dimenticato).
  const [edit, setEdit] = useState<Riga | null>(null)
  const [cat, setCat] = useState<ArticoloCat[]>([])
  const [sel, setSel] = useState<RigaArticolo[]>([])
  const [caricoCat, setCaricoCat] = useState(false)
  const [salvoArt, setSalvoArt] = useState(false)

  async function apriEditor(r: Riga) {
    setEdit(r); setCaricoCat(true); setCat([])
    setSel((articoli[r.id] || []).filter((a: any) => a.articolo_id).map((a: any) => ({ id: a.articolo_id, qta: a.quantita || 1 })))
    try {
      const d = await fetch(`/api/catalogo?cliente_id=${r.cliente_id}`).then(x => x.json())
      setCat(Array.isArray(d?.articoli) ? d.articoli : [])
    } catch { setCat([]) }
    setCaricoCat(false)
  }

  async function salvaArticoli() {
    if (!edit) return
    setSalvoArt(true)
    try {
      const res = await fetch('/api/spedizioni/articoli', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spedizione_id: edit.id, articoli: sel.map(r => ({ articolo_id: r.id, quantita: r.qta })) }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.error) { setMsg({ t: 'err', x: d.error }); setSalvoArt(false); return }
      // Aggiorna la riga in locale coi nomi dal catalogo (niente ricarica dell'intera lista).
      const nuovi = sel.map(r => { const a = cat.find(c => c.id === r.id); return { articolo_id: r.id, sku: a?.sku, nome: a?.prodotto || a?.nome || a?.sku, quantita: r.qta } })
      setArticoli(prev => ({ ...prev, [edit.id]: nuovi }))
      setEdit(null)
      setMsg({ t: 'ok', x: 'Articoli del pacco aggiornati.' })
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) }
    finally { setSalvoArt(false) }
  }

  function carica() {
    setLoading(true)
    fetch('/api/logistica/da-preparare' + (vista === 'storico' ? '?storico=1' : ''))
      .then(r => r.json())
      .then(d => { setRighe(Array.isArray(d?.spedizioni) ? d.spedizioni : []); setArticoli(d?.articoli || {}); setLoading(false) })
      .catch(() => { setLoading(false); setMsg({ t: 'err', x: 'Errore nel caricamento' }) })
  }
  useEffect(() => { carica() }, [vista])

  async function preparata(id: string) {
    setFacendo(id); setMsg(null)
    try {
      const res = await fetch('/api/logistica/da-preparare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spedizioneId: id }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.error) { setMsg({ t: 'err', x: d.error }); setFacendo(''); return }
      // Via dalla lista: il badge del menu si aggiorna al prossimo giro (polling).
      setRighe(prev => prev.filter(r => r.id !== id))
      setMsg({ t: 'ok', x: 'Segnata come preparata. Il cliente è stato avvisato.' })
    } catch {
      setMsg({ t: 'err', x: 'Errore di rete' })
    } finally { setFacendo('') }
  }

  const dataBreve = (s: any) => { try { return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  const dest = (r: any) => [r.dest_nome, [r.dest_cap, r.dest_citta].filter(Boolean).join(' '), r.dest_provincia].filter(Boolean).join(' · ')

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '22px 20px' }}>
      <Testata titolo="Da preparare" sottotitolo="Spedizioni dei clienti in logistica da preparare fisicamente e affidare al corriere. L'etichetta è già emessa." />
      <Avviso msg={msg} />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {([['da_preparare', 'Da preparare'], ['storico', 'Storico']] as const).map(([v, label]) => (
          <button key={v} onClick={() => { if (vista !== v) { setMsg(null); setVista(v) } }}
            style={{ padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
              border: '1px solid ' + (vista === v ? '#ea580c' : '#e5e5e5'),
              background: vista === v ? '#fff7ed' : '#fff', color: vista === v ? '#ea580c' : '#555' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={card}>
        <div style={cardH}>{loading ? 'Carico…' : (vista === 'storico' ? `${righe.length} preparate (storico)` : `${righe.length} da preparare`)}</div>
        {loading ? null : righe.length === 0 ? (
          <Vuoto testo={vista === 'storico' ? 'Ancora nessun pacco preparato.' : 'Niente da preparare. Le nuove spedizioni dei clienti in logistica compaiono qui.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={th}>Data</th>
                <th style={th}>Cliente</th>
                <th style={th}>Destinatario</th>
                <th style={th}>Spedizione</th>
                <th style={th}>Corriere</th>
                <th style={th}>Colli / Peso</th>
                <th style={th}>Da prelevare</th>
                <th style={{ ...th, textAlign: 'right' }}></th>
              </tr></thead>
              <tbody>
                {righe.map(r => {
                  const arts = articoli[r.id] || []
                  const cod = Number(r.contrassegno || 0) > 0
                  return (
                    <tr key={r.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: '#666' }}>{dataBreve(r.created_at)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.clienti?.ragione_sociale || '—'}</td>
                      <td style={td}>{dest(r) || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.numero || r.tracking_number || '—'}
                        {cod && <span style={{ marginLeft: '6px', background: '#fef3c7', color: '#92400e', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px' }}>COD {Number(r.contrassegno).toFixed(2)}€</span>}
                      </td>
                      <td style={td}>{r.corrieri?.nome_contratto || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.colli || 1} · {Number(r.peso_fatturato || r.peso_reale || 0)} kg</td>
                      <td style={td}>
                        {arts.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' }}>
                            {arts.map((a, i) => (
                              <span key={i} style={{ fontSize: '12px' }}>
                                <b>{a.quantita}×</b> {a.nome}{a.sku ? <span style={{ color: '#999' }}> ({a.sku})</span> : null}
                              </span>
                            ))}
                          </div>
                        )}
                        {vista !== 'storico' && (
                          <button onClick={() => apriEditor(r)} style={{ background: 'transparent', border: 'none', color: '#ea580c', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                            {arts.length === 0 ? '＋ aggiungi articoli' : '✎ modifica'}
                          </button>
                        )}
                        {vista === 'storico' && arts.length === 0 && <span style={{ color: '#bbb', fontSize: '12px' }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {vista === 'storico' ? (
                          <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '12px' }}>✓ Preparata</span>
                        ) : (
                          <button onClick={() => preparata(r.id)} disabled={facendo === r.id} style={{ ...btn, opacity: facendo === r.id ? 0.6 : 1 }}>
                            {facendo === r.id ? '…' : '✓ Preparata'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && (
        <div onClick={() => !salvoArt && setEdit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '85vh', overflowY: 'auto', padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a', marginBottom: '2px' }}>Cosa c'è nel pacco</div>
            <div style={{ fontSize: '12.5px', color: '#777', marginBottom: '14px' }}>
              {edit.clienti?.ragione_sociale} · {edit.numero || edit.tracking_number} — correggi cosa prelevare dal magazzino. Alla conferma la giacenza si aggiorna da sola.
            </div>
            {caricoCat ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Carico il catalogo…</div>
            ) : cat.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Questo cliente non ha articoli a catalogo: caricali da Catalogo prodotti.</div>
            ) : (
              <SelettoreArticoli articoli={cat} valore={sel} onChange={setSel} titolo="Articoli da prelevare" apertoDefault />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button onClick={() => setEdit(null)} disabled={salvoArt} style={btnSec}>Annulla</button>
              <button onClick={salvaArticoli} disabled={salvoArt || caricoCat} style={{ ...btn, opacity: (salvoArt || caricoCat) ? 0.6 : 1 }}>{salvoArt ? 'Salvo…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
