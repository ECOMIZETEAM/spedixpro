'use client'
import { useState } from 'react'

// CENTRALE DI CONTROLLO (super master). Registro di "controlli": ogni problematica ricorrente diventa
// un controllo che scansiona i dati veri e dice QUALE e PERCHE'. La pagina e' GENERICA: ogni endpoint
// ritorna { kpi, colonne, righe, categoriaKey, cercaKeys, csvNome, finestra, nota } e viene reso da solo.
// Aggiungere un controllo = una lib che ritorna quella forma + /api/controllo/<id> + una card qui.

type Controllo = { id: string; nome: string; descrizione: string; icona: string; pronto: boolean }
const CONTROLLI: Controllo[] = [
  { id: 'spedizioni-in-perdita', nome: 'Spedizioni in perdita', icona: '📉', pronto: true,
    descrizione: 'Master che vanno sotto STRUTTURALMENTE su una spedizione (pagano piu\' di quanto incassano) e il perche\': listino sotto costo o anomalia peso/volume. Esclude le rettifiche in transito.' },
  { id: 'rettifiche-da-girare', nome: 'Rettifiche da girare', icona: '🔁', pronto: true,
    descrizione: 'Rettifiche gia\' addebitate a un master ma non ancora girate al livello sotto: soldi che deve ancora recuperare. Non e\' una perdita, e\' un incasso in sospeso.' },
  { id: 'zone-listini', nome: 'Zone & Listini', icona: '🗺️', pronto: true,
    descrizione: 'Errori di configurazione di zone e listini che rompono il prezzo: buchi tra le fasce, sovrapposizioni, prezzi ≤ 0, zone con CAP ma senza tariffa.' },
  { id: 'log-errori', nome: 'Log & Errori', icona: '🚨', pronto: true,
    descrizione: 'Dove il sistema ha dato problemi: annulli, fulfillment, integrazioni, import, webhook, addebiti giacenze/resi, e LDV rimaste su numero provvisorio.' },
]

const eur = (n: number) => (n < 0 ? '−' : '') + '€ ' + Math.abs(Number(n) || 0).toFixed(2)
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4', verticalAlign: 'top' }
function chip(active: boolean): React.CSSProperties {
  return { background: active ? '#1a1a1a' : '#fff', color: active ? '#fff' : '#555', border: '1px solid ' + (active ? '#1a1a1a' : '#ddd'), borderRadius: 20, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
}

export default function CentraleControlloPage() {
  const [sel, setSel] = useState<string | null>(null)
  const [giorni, setGiorni] = useState(14)
  const [loading, setLoading] = useState(false)
  const [d, setD] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')

  async function esegui(id: string, gg = giorni) {
    setSel(id); setLoading(true); setMsg(''); setD(null); setCat(''); setQ('')
    const r = await fetch(`/api/controllo/${id}?giorni=${gg}`).then(x => x.json()).catch(() => null)
    if (!r || r.error) setMsg(r?.error || 'Errore nel controllo'); else setD(r)
    setLoading(false)
  }

  const righe: any[] = (d?.righe || []).filter((x: any) => {
    if (d?.categoriaKey && cat && x[d.categoriaKey] !== cat) return false
    if (q && d?.cercaKeys) return d.cercaKeys.some((k: string) => String(x[k] ?? '').toLowerCase().includes(q.toLowerCase()))
    return true
  })
  const categorie: string[] = d?.categoriaKey ? Array.from(new Set((d.righe || []).map((x: any) => x[d.categoriaKey]).filter(Boolean))) : []

  function esportaCsv() {
    const cols = (d?.colonne || []).map((c: any) => c.key)
    const head = cols.join(';')
    const rows = righe.map((r: any) => cols.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(';'))
    const blob = new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${d?.csvNome || 'controllo'}.csv`; a.click()
  }

  function cella(r: any, c: any) {
    const v = r[c.key]
    if (c.tipo === 'eur') return <span style={{ fontVariantNumeric: 'tabular-nums', color: Number(v) < 0 ? '#b91c1c' : '#1a1a1a', fontWeight: Number(v) < 0 ? 700 : 400 }}>{eur(v)}</span>
    if (c.tipo === 'peso') return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v} kg</span>
    if (c.tipo === 'mono') return <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{v}</span>
    if (c.tipo === 'badge') return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>{v}</span>
    return <span>{v}</span>
  }

  const finestra = !!d?.finestra

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: '0 0 4px' }}>🎛️ Centrale di Controllo</h1>
      <p style={{ color: '#777', fontSize: 13, margin: '0 0 18px' }}>Un controllo per ogni problematica: scansiona i dati veri della rete e dice <b>quale</b> e <b>perché</b>.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))', gap: 12, marginBottom: 22 }}>
        {CONTROLLI.map(c => (
          <div key={c.id} style={{ background: sel === c.id ? '#fff7ed' : '#fff', border: '1px solid ' + (sel === c.id ? '#fdba74' : '#eee'), borderRadius: 12, padding: 16, opacity: c.pronto ? 1 : .55, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{c.icona}</span>
              <span style={{ fontWeight: 800, fontSize: 15, color: '#1a1a1a' }}>{c.nome}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#666', lineHeight: 1.5, flex: 1 }}>{c.descrizione}</div>
            <button onClick={() => c.pronto && esegui(c.id)} disabled={!c.pronto || loading}
              style={{ marginTop: 10, background: c.pronto ? '#1a1a1a' : '#eee', color: c.pronto ? '#fff' : '#999', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: c.pronto ? 'pointer' : 'default' }}>
              {loading && sel === c.id ? 'Scansione…' : c.pronto ? 'Esegui controllo' : 'In arrivo'}
            </button>
          </div>
        ))}
      </div>

      {msg && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      {sel && (d || loading) && (
        <div>
          {finestra && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: '#777', fontWeight: 700 }}>Periodo:</span>
              {[7, 14, 30, 60].map(g => (
                <button key={g} onClick={() => { setGiorni(g); esegui(sel, g) }} disabled={loading}
                  style={{ background: giorni === g ? '#1a1a1a' : '#fff', color: giorni === g ? '#fff' : '#555', border: '1px solid ' + (giorni === g ? '#1a1a1a' : '#ddd'), borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{g} gg</button>
              ))}
            </div>
          )}

          {loading && <div style={{ color: '#999', fontSize: 13, padding: 20 }}>Scansione in corso…</div>}

          {d && (
            <>
              {d.kpi?.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  {d.kpi.map((k: any, i: number) => (
                    <div key={i} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '14px 16px', minWidth: 150 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a' }}>{k.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: k.colore || '#1a1a1a', marginTop: 4 }}>{k.valore}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                {categorie.length > 0 && <button onClick={() => setCat('')} style={chip(cat === '')}>Tutte</button>}
                {categorie.map((k: string) => <button key={k} onClick={() => setCat(k)} style={chip(cat === k)}>{k}</button>)}
                {d.cercaKeys && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca…" style={{ marginLeft: 'auto', border: '1px solid #ddd', borderRadius: 7, padding: '7px 11px', fontSize: 13, minWidth: 200 }} />}
                <button onClick={esportaCsv} style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 7, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginLeft: d.cercaKeys ? 0 : 'auto' }}>Esporta CSV</button>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead><tr style={{ background: '#fafafa' }}>
                    {(d.colonne || []).map((c: any) => <th key={c.key} style={{ ...th, textAlign: c.align === 'right' ? 'right' : 'left' }}>{c.label}</th>)}
                  </tr></thead>
                  <tbody>
                    {righe.slice(0, 500).map((r: any, i: number) => (
                      <tr key={i}>
                        {(d.colonne || []).map((c: any) => <td key={c.key} style={{ ...td, textAlign: c.align === 'right' ? 'right' : 'left' }}>{cella(r, c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {righe.length > 500 && <div style={{ fontSize: 12, color: '#999', padding: '10px 2px' }}>Mostrate 500 di {righe.length}. Usa l'Esporta CSV per tutte.</div>}
              {!righe.length && <div style={{ color: '#16a34a', fontSize: 13, padding: 16 }}>Nessun problema con questi filtri. ✓</div>}
              {d.nota && <div style={{ fontSize: 12, color: '#999', padding: '12px 2px 0' }}>{d.nota}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
