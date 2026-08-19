'use client'
import { useEffect, useState } from 'react'
import { Testata, Avviso, Vuoto, card, cardH, th, td, btn } from '../comune'

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

  function carica() {
    setLoading(true)
    fetch('/api/logistica/da-preparare')
      .then(r => r.json())
      .then(d => { setRighe(Array.isArray(d?.spedizioni) ? d.spedizioni : []); setArticoli(d?.articoli || {}); setLoading(false) })
      .catch(() => { setLoading(false); setMsg({ t: 'err', x: 'Errore nel caricamento' }) })
  }
  useEffect(() => { carica() }, [])

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

      <div style={card}>
        <div style={cardH}>{loading ? 'Carico…' : `${righe.length} da preparare`}</div>
        {loading ? null : righe.length === 0 ? (
          <Vuoto testo="Niente da preparare. Le nuove spedizioni dei clienti in logistica compaiono qui." />
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
                        {arts.length === 0 ? <span style={{ color: '#aaa' }}>—</span> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {arts.map((a, i) => (
                              <span key={i} style={{ fontSize: '12px' }}>
                                <b>{a.quantita}×</b> {a.nome}{a.sku ? <span style={{ color: '#999' }}> ({a.sku})</span> : null}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => preparata(r.id)} disabled={facendo === r.id} style={{ ...btn, opacity: facendo === r.id ? 0.6 : 1 }}>
                          {facendo === r.id ? '…' : '✓ Preparata'}
                        </button>
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
