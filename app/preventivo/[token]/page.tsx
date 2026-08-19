'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// PAGINA PUBBLICA DEL PREVENTIVO (senza login, per token). Brandizzata col logo/colori del master.
// Mostra i prezzi (tutte le zone + supplementi) e le sezioni, e permette di ACCETTARE con un clic.

const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function PreventivoPubblico() {
  const { token } = useParams()
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [accettando, setAccettando] = useState(false)
  const [accettato, setAccettato] = useState(false)

  useEffect(() => {
    fetch(`/api/pubblico/preventivo?t=${token}`).then(r => r.json()).then(x => {
      if (x?.error) { setErr(x.error) } else { setD(x); if (x.stato === 'accettato') setAccettato(true) }
      setLoading(false)
    }).catch(() => { setErr('Preventivo non disponibile'); setLoading(false) })
  }, [token])

  async function accetta() {
    setAccettando(true); setErr('')
    try {
      const res = await fetch('/api/pubblico/preventivo/accetta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const x = await res.json().catch(() => ({}))
      if (!res.ok || x?.error) { setErr(x?.error || 'Accettazione non riuscita'); setAccettando(false); return }
      setAccettato(true)
    } catch { setErr('Errore di rete') } finally { setAccettando(false) }
  }

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#666', fontFamily: 'sans-serif' }}>Caricamento…</div>
  if (err && !d) return <div style={{ padding: '60px', textAlign: 'center', color: '#b91c1c', fontFamily: 'sans-serif' }}>{err}</div>
  if (!d) return null

  const b = d.branding || {}
  const colP = b.colore_primario || '#f97316'
  const colS = b.colore_secondario || '#1a1a1a'
  const corrieri = d.prezzi?.corrieri || []

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'sans-serif', padding: '24px 14px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,.08)' }}>
        <div style={{ background: colS, color: '#fff', padding: '22px 28px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          {b.logo_url ? <img src={b.logo_url} alt="logo" style={{ maxHeight: '46px', maxWidth: '200px', objectFit: 'contain' }} /> : <div style={{ fontSize: '22px', fontWeight: 800 }}>{b.nome}</div>}
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '12px', opacity: .85 }}>Preventivo{d.valido_fino ? <><br />valido fino al {new Date(d.valido_fino).toLocaleDateString('it-IT')}</> : null}</div>
        </div>

        <div style={{ padding: '26px 28px' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: colS }}>{d.oggetto || 'Preventivo di spedizione'}</div>
          {d.dest_nome && <div style={{ fontSize: '14px', color: '#555', marginTop: '2px' }}>Per: <b>{d.dest_nome}</b></div>}

          {d.scaduto && !accettato && <div style={{ marginTop: '14px', background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', borderRadius: '8px', padding: '10px 14px', fontSize: '13px' }}>⏳ Questo preventivo è scaduto. Contatta chi te l'ha inviato per uno aggiornato.</div>}

          {corrieri.map((c: any, i: number) => (
            <div key={i} style={{ marginTop: '22px' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: colS, borderBottom: `2px solid ${colP}`, paddingBottom: '5px', marginBottom: '8px' }}>{c.nome}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: `${120 + (c.zone?.length || 1) * 76}px` }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: '#888', fontWeight: 700, borderBottom: '1px solid #eee' }}>Peso</th>
                    {(c.zone || []).map((z: string) => <th key={z} style={{ textAlign: 'right', padding: '6px 8px', color: '#888', fontWeight: 700, borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{z}</th>)}
                  </tr></thead>
                  <tbody>
                    {(c.fasce || []).map((f: any, j: number) => (
                      <tr key={j} style={{ borderBottom: '1px solid #f4f4f4' }}>
                        <td style={{ padding: '6px 8px', color: '#333', whiteSpace: 'nowrap' }}>{f.label}</td>
                        {(c.zone || []).map((z: string) => <td key={z} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{f.prezzi?.[z] != null ? eur(f.prezzi[z]) : '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(c.supplementi || []).length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#555' }}>
                  {c.supplementi.map((s: any, k: number) => <span key={k} style={{ marginRight: '14px' }}><b>{s.nome}:</b> {s.dettaglio || '—'}</span>)}
                </div>
              )}
            </div>
          ))}

          {(d.sezioni || []).filter((s: any) => s.titolo || s.testo).map((s: any) => (
            <div key={s.id} style={{ marginTop: '22px' }}>
              {s.titolo && <div style={{ fontSize: '15px', fontWeight: 700, color: colS, marginBottom: '5px' }}>{s.titolo}</div>}
              <div style={{ fontSize: '13px', color: '#444', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{s.testo}</div>
            </div>
          ))}

          {/* Accetta */}
          <div style={{ marginTop: '28px', textAlign: 'center' }}>
            {accettato ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '18px' }}>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#15803d' }}>✅ Preventivo accettato!</div>
                <div style={{ fontSize: '13px', color: '#166534', marginTop: '6px' }}>Grazie. Il tuo listino è pronto. Se è il tuo primo accesso, ti abbiamo inviato le credenziali via email per entrare e iniziare a spedire.</div>
              </div>
            ) : d.scaduto ? null : (
              <>
                {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '12px' }}>{err}</div>}
                <button onClick={accetta} disabled={accettando} style={{ background: colP, color: '#fff', border: 'none', borderRadius: '10px', padding: '14px 32px', fontSize: '15px', fontWeight: 800, cursor: 'pointer', opacity: accettando ? 0.6 : 1 }}>
                  {accettando ? 'Accetto…' : 'Accetta preventivo'}
                </button>
                <div style={{ fontSize: '11.5px', color: '#999', marginTop: '10px' }}>Accettando, il preventivo diventa il tuo listino.</div>
              </>
            )}
          </div>

          <div style={{ marginTop: '26px', paddingTop: '16px', borderTop: '1px solid #f0f0f0', fontSize: '11.5px', color: '#999', textAlign: 'center' }}>
            {b.nome}{b.email ? ` · ${b.email}` : ''}{b.telefono ? ` · ${b.telefono}` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
