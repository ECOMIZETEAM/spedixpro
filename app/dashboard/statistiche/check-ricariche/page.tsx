'use client'
import { useEffect, useState } from 'react'

// CHECK RICARICHE — monitoraggio bonifici delle ricariche manuali (contabilita' + anti-truffa).
// Ogni ricarica manuale a un cliente/sotto-master compare qui: si segna "bonifico effettuato" e poi
// "bonifico arrivato". Gli alert rossi stanano chi non paga e i bonifici non ancora incassati.

const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }
const th: any = { padding: '9px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', textAlign: 'left', whiteSpace: 'nowrap' }
const td: any = { padding: '9px 12px', fontSize: '12.5px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0', verticalAlign: 'middle' }
const btn: any = { background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnSec: any = { background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '6px 10px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }

const STATI: [string, string][] = [['', 'Tutti'], ['alert', '⚠ Solo alert'], ['in_attesa', 'In attesa bonifico'], ['effettuato', 'Bonifico effettuato'], ['arrivato', 'Arrivati']]

export default function CheckRicariche() {
  const [righe, setRighe] = useState<any[]>([])
  const [riep, setRiep] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [stato, setStato] = useState('')
  const [cerca, setCerca] = useState('')
  const [facendo, setFacendo] = useState('')
  const [err, setErr] = useState('')

  function carica() {
    setLoading(true)
    const qs = new URLSearchParams()
    if (stato) qs.set('stato', stato)
    if (cerca.trim()) qs.set('q', cerca.trim())
    fetch(`/api/statistiche/check-ricariche?${qs.toString()}`)
      .then(r => r.json())
      .then(d => { setRighe(Array.isArray(d?.righe) ? d.righe : []); setRiep(d?.riepilogo || null); setLoading(false) })
      .catch(() => { setLoading(false); setErr('Errore nel caricamento') })
  }
  useEffect(() => { carica() }, [stato])

  async function azione(id: string, az: string) {
    if (facendo) return   // guardia anti doppio-click: un'azione alla volta
    // Conferma sulle azioni che tornano indietro o cancellano: niente cambi di stato per sbaglio.
    const conferme: Record<string, string> = {
      annulla_effettuato: 'Annullare il "bonifico effettuato"? La ricarica torna in attesa.',
      annulla_arrivato: 'Annullare la conferma d\'arrivo? Il bonifico torna a "effettuato, non ancora incassato".',
      elimina: 'Togliere questa ricarica dal monitoraggio bonifici? (non tocca il credito)',
    }
    if (conferme[az] && !window.confirm(conferme[az])) return
    setFacendo(id + az); setErr('')
    try {
      const res = await fetch('/api/statistiche/check-ricariche', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, azione: az }),
      })
      const d = await res.json().catch(() => ({}))
      // Controlla lo STATO HTTP, non solo d.error: un 404/403 (es. sessione o deploy) non deve
      // sembrare riuscito. Cosi' non si vede mai uno stato "segnato" che in realta' non e' salvato.
      if (!res.ok || d?.error) { setErr(d?.error || 'Operazione non riuscita — ricarica la pagina e riprova'); setFacendo(''); return }
      // La UI si allinea allo stato VERO restituito dal server (mai ottimistico), poi rinfresca il riepilogo.
      if (d?.eliminata) setRighe(prev => prev.filter(r => r.id !== id))
      else if (d?.riga) setRighe(prev => prev.map(r => (r.id === id ? d.riga : r)))
      carica()
    } catch { setErr('Errore di rete — ricarica la pagina') } finally { setFacendo('') }
  }

  const dataOra = (s: any) => { try { return new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  const soglie = riep?.soglie || { no_bonifico: 3, no_arrivo: 4 }

  const badgeStato = (r: any) => {
    if (r.stato === 'arrivato') return <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>🟢 Arrivato</span>
    if (r.stato === 'effettuato') return <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>🔵 Bonifico fatto</span>
    return <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>🟠 In attesa</span>
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '22px 20px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Check Ricariche</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          Bonifici delle ricariche che avete fatto. Segnate quando il cliente dispone il bonifico e quando lo incassate.
          Alert dopo <b>{soglie.no_bonifico} giorni</b> senza bonifico e dopo <b>{soglie.no_arrivo} giorni</b> se non è confermato l’arrivo.
        </p>
      </div>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{err}</div>}

      {/* Riepilogo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Scoperto (da incassare)</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginTop: '4px' }}>{eur(riep?.scoperto)}</div>
        </div>
        <div style={{ ...card, padding: '14px 16px', borderColor: (riep?.n_alert || 0) > 0 ? '#fecaca' : '#e8e8e8', background: (riep?.n_alert || 0) > 0 ? '#fff7f7' : '#fff' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>⚠ Alert attivi</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: (riep?.n_alert || 0) > 0 ? '#dc2626' : '#1a1a1a', marginTop: '4px' }}>{riep?.n_alert ?? 0}</div>
        </div>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>In attesa bonifico</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginTop: '4px' }}>{riep?.n_in_attesa ?? 0}</div>
        </div>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Da confermare arrivo</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginTop: '4px' }}>{riep?.n_effettuato ?? 0}</div>
        </div>
      </div>

      {/* Filtri */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {STATI.map(([v, l]) => (
          <button key={v} onClick={() => setStato(v)} style={{ ...btnSec, background: stato === v ? '#1a1a1a' : '#fff', color: stato === v ? '#fff' : '#555', borderColor: stato === v ? '#1a1a1a' : '#d5d5d5', padding: '7px 12px' }}>{l}</button>
        ))}
        <input value={cerca} onChange={e => setCerca(e.target.value)} onKeyDown={e => e.key === 'Enter' && carica()} placeholder="🔍 cerca cliente / sotto-master…"
          style={{ marginLeft: 'auto', padding: '7px 11px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px', minWidth: '220px' }} />
        <button onClick={carica} style={btnSec}>Cerca</button>
      </div>

      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>
          {loading ? 'Carico…' : `${righe.length} ricariche`}
        </div>
        {loading ? null : righe.length === 0 ? (
          <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Nessuna ricarica manuale. Compaiono qui appena ricaricate un cliente o un sotto-master.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '840px' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={th}>Ricaricato il</th>
                <th style={th}>Chi</th>
                <th style={{ ...th, textAlign: 'right' }}>Importo</th>
                <th style={th}>Stato</th>
                <th style={th}>Attesa</th>
                <th style={{ ...th, textAlign: 'right' }}>Azioni</th>
              </tr></thead>
              <tbody>
                {righe.map(r => (
                  <tr key={r.id} style={{ background: r.alert ? '#fff7f7' : undefined }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#555' }}>{dataOra(r.ricaricato_il)}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{r.target_nome || '—'}</span>
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: r.target_tipo === 'master' ? '#7c3aed' : '#0891b2', background: r.target_tipo === 'master' ? '#f3e8ff' : '#ecfeff', padding: '1px 6px', borderRadius: '4px' }}>
                        {r.target_tipo === 'master' ? 'sotto-master' : 'cliente'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(r.importo)}</td>
                    <td style={td}>{badgeStato(r)}</td>
                    <td style={td}>
                      {r.stato === 'arrivato' ? <span style={{ color: '#9ca3af' }}>—</span> : (
                        <span style={{ color: r.alert ? '#dc2626' : '#666', fontWeight: r.alert ? 700 : 400 }}>
                          {r.stato === 'in_attesa'
                            ? `${r.giorniDaRicarica}g dalla ricarica${r.alert_no_bonifico ? ' · non ha pagato!' : ''}`
                            : `${r.giorniDaEffettuato ?? 0}g dal bonifico${r.alert_no_arrivo ? ' · verifica incasso!' : ''}`}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.stato === 'in_attesa' && (
                        <button onClick={() => azione(r.id, 'effettuato')} disabled={facendo === r.id + 'effettuato'} style={btn}>Bonifico effettuato</button>
                      )}
                      {r.stato === 'effettuato' && (
                        <span style={{ display: 'inline-flex', gap: '6px' }}>
                          <button onClick={() => azione(r.id, 'annulla_effettuato')} disabled={!!facendo} style={btnSec} title="Torna in attesa">↶</button>
                          <button onClick={() => azione(r.id, 'arrivato')} disabled={facendo === r.id + 'arrivato'} style={{ ...btn, background: '#16a34a' }}>Bonifico arrivato</button>
                        </span>
                      )}
                      {r.stato === 'arrivato' && (
                        <button onClick={() => azione(r.id, 'annulla_arrivato')} disabled={!!facendo} style={btnSec} title="Annulla conferma arrivo">↶ annulla arrivo</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
