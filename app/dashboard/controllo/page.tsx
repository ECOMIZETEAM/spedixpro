'use client'
import { useState } from 'react'

// CENTRALE DI CONTROLLO (super master). Registro di "controlli": ogni problematica ricorrente
// diventa un controllo che scansiona i dati veri e dice QUALE spedizione e PERCHE'. Estensibile:
// per aggiungerne uno, si aggiunge una voce a CONTROLLI + il suo endpoint /api/controllo/<id>.

type Controllo = { id: string; nome: string; descrizione: string; icona: string; pronto: boolean }
const CONTROLLI: Controllo[] = [
  { id: 'spedizioni-in-perdita', nome: 'Spedizioni in perdita', icona: '📉', pronto: true,
    descrizione: 'Trova i master che vanno sotto su una spedizione (pagano piu\' di quanto incassano dal livello sotto) e il perche\': listino sotto costo o anomalia peso/volume.' },
]

const eur = (n: number) => (n < 0 ? '−' : '') + '€ ' + Math.abs(n).toFixed(2)
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4', verticalAlign: 'top' }

export default function CentraleControlloPage() {
  const [sel, setSel] = useState<string | null>(null)
  const [giorni, setGiorni] = useState(14)
  const [loading, setLoading] = useState(false)
  const [d, setD] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [causa, setCausa] = useState<string>('')
  const [q, setQ] = useState('')

  async function esegui(id: string, gg = giorni) {
    setSel(id); setLoading(true); setMsg(''); setD(null); setCausa(''); setQ('')
    const r = await fetch(`/api/controllo/${id}?giorni=${gg}`).then(x => x.json()).catch(() => null)
    if (!r || r.error) setMsg(r?.error || 'Errore nel controllo')
    else setD(r)
    setLoading(false)
  }

  const righe: any[] = (d?.righe || []).filter((x: any) =>
    (!causa || x.causa === causa) &&
    (!q || (x.numero || '').toLowerCase().includes(q.toLowerCase()) || (x.master || '').toLowerCase().includes(q.toLowerCase())))

  function esportaCsv() {
    const head = ['numero', 'master', 'paga', 'incassa', 'margine', 'peso_reale', 'peso_onesto', 'peso_fatturato', 'causa', 'dettaglio', 'stato']
    const rows = righe.map(r => head.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'))
    const blob = new Blob([head.join(';') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `spedizioni-in-perdita-${giorni}gg.csv`; a.click()
  }

  const card = (label: string, val: any, color = '#1a1a1a') => (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '14px 16px', minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 4 }}>{val}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: '0 0 4px' }}>🎛️ Centrale di Controllo</h1>
      <p style={{ color: '#777', fontSize: 13, margin: '0 0 18px' }}>Un controllo per ogni problematica: scansiona i dati veri della rete e dice <b>quale</b> spedizione e <b>perché</b>.</p>

      {/* registro controlli */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 22 }}>
        {CONTROLLI.map(c => (
          <div key={c.id} style={{ background: sel === c.id ? '#fff7ed' : '#fff', border: '1px solid ' + (sel === c.id ? '#fdba74' : '#eee'), borderRadius: 12, padding: 16, opacity: c.pronto ? 1 : .55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{c.icona}</span>
              <span style={{ fontWeight: 800, fontSize: 15, color: '#1a1a1a' }}>{c.nome}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#666', lineHeight: 1.5, minHeight: 54 }}>{c.descrizione}</div>
            <button onClick={() => c.pronto && esegui(c.id)} disabled={!c.pronto || loading}
              style={{ marginTop: 10, width: '100%', background: c.pronto ? '#1a1a1a' : '#eee', color: c.pronto ? '#fff' : '#999', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: c.pronto ? 'pointer' : 'default' }}>
              {loading && sel === c.id ? 'Scansione…' : c.pronto ? 'Esegui controllo' : 'In arrivo'}
            </button>
          </div>
        ))}
      </div>

      {msg && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      {sel === 'spedizioni-in-perdita' && (d || loading) && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: '#777', fontWeight: 700 }}>Periodo:</span>
            {[7, 14, 30, 60].map(g => (
              <button key={g} onClick={() => { setGiorni(g); esegui('spedizioni-in-perdita', g) }} disabled={loading}
                style={{ background: giorni === g ? '#1a1a1a' : '#fff', color: giorni === g ? '#fff' : '#555', border: '1px solid ' + (giorni === g ? '#1a1a1a' : '#ddd'), borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{g} gg</button>
            ))}
            {d && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#999' }}>{d.spedizioniScansionate?.toLocaleString('it-IT')} spedizioni scansionate</span>}
          </div>

          {loading && <div style={{ color: '#999', fontSize: 13, padding: 20 }}>Scansione degli ultimi {giorni} giorni…</div>}

          {d && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                {card('Righe in perdita', (d.righe?.length || 0).toLocaleString('it-IT'), '#b91c1c')}
                {card('Perdita totale', eur(d.totale || 0), '#b91c1c')}
                {Object.entries(d.perCausa || {}).map(([k, v]: any) => card(k, `${v.n} · ${eur(v.tot)}`, '#c2410c'))}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                <button onClick={() => setCausa('')} style={chip(causa === '')}>Tutte</button>
                {Object.keys(d.perCausa || {}).map(k => <button key={k} onClick={() => setCausa(k)} style={chip(causa === k)}>{k}</button>)}
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca LDV o master…"
                  style={{ marginLeft: 'auto', border: '1px solid #ddd', borderRadius: 7, padding: '7px 11px', fontSize: 13, minWidth: 200 }} />
                <button onClick={esportaCsv} style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 7, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Esporta CSV</button>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                  <thead><tr style={{ background: '#fafafa' }}>
                    <th style={th}>Spedizione</th><th style={th}>Master (in perdita)</th>
                    <th style={{ ...th, textAlign: 'right' }}>Paga</th><th style={{ ...th, textAlign: 'right' }}>Incassa</th><th style={{ ...th, textAlign: 'right' }}>Margine</th>
                    <th style={{ ...th, textAlign: 'right' }}>Peso vero</th><th style={th}>Causa</th>
                  </tr></thead>
                  <tbody>
                    {righe.slice(0, 500).map((r, i) => (
                      <tr key={i}>
                        <td style={td}><span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{r.numero}</span></td>
                        <td style={td}>{r.master}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{eur(r.paga)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{eur(r.incassa)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#b91c1c', fontWeight: 700 }}>{eur(r.margine)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.peso_onesto} kg</td>
                        <td style={td}>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: r.causa === 'anomalia peso/volume' ? '#fef3c7' : '#fee2e2', color: r.causa === 'anomalia peso/volume' ? '#92400e' : '#991b1b' }}>{r.causa}</span>
                          <div style={{ fontSize: 11.5, color: '#888', marginTop: 3 }}>{r.dettaglio}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {righe.length > 500 && <div style={{ fontSize: 12, color: '#999', padding: '10px 2px' }}>Mostrate le 500 peggiori di {righe.length}. Usa l'Esporta CSV per la lista completa.</div>}
              {!righe.length && <div style={{ color: '#16a34a', fontSize: 13, padding: 16 }}>Nessuna spedizione in perdita con questi filtri. ✓</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function chip(active: boolean): React.CSSProperties {
  return { background: active ? '#1a1a1a' : '#fff', color: active ? '#fff' : '#555', border: '1px solid ' + (active ? '#1a1a1a' : '#ddd'), borderRadius: 20, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
}
