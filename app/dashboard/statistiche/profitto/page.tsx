'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ARANCIO = '#f97316', VERDE = '#16a34a', NERO = '#1a1a1a', GRIGIO = '#9ca3af'

function oggi() { return new Date().toISOString().slice(0, 10) }
function primoMese() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }

export default function StatProfittoPage() {
  const [dal, setDal] = useState(primoMese())
  const [al, setAl] = useState(oggi())
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function carica() {
    setLoading(true)
    try {
      const res = await fetch(`/api/statistiche/profitto?dal=${dal}&al=${al}`)
      const j = await res.json()
      setD(j.error ? null : j)
    } catch { setD(null) }
    setLoading(false)
  }
  useEffect(() => { carica() }, [])  // eslint-disable-line

  function rangeVeloce(tipo: string) {
    const d = new Date(); let start = new Date()
    if (tipo === 'mese') start = new Date(d.getFullYear(), d.getMonth(), 1)
    else if (tipo === 'mesescorso') { start = new Date(d.getFullYear(), d.getMonth() - 1, 1); const fine = new Date(d.getFullYear(), d.getMonth(), 0); setAl(fine.toISOString().slice(0, 10)); setDal(start.toISOString().slice(0, 10)); return }
    else if (tipo === '7') start.setDate(d.getDate() - 6)
    else if (tipo === '30') start.setDate(d.getDate() - 29)
    else if (tipo === '90') start.setDate(d.getDate() - 89)
    else if (tipo === 'anno') start = new Date(d.getFullYear(), 0, 1)
    setDal(start.toISOString().slice(0, 10)); setAl(oggi())
  }

  const k = d?.kpi
  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: '0 0 2px' }}>Dashboard Profitto</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 16px' }}>Costi e margine per spedizione — solo i tuoi clienti e la tua rete diretta.</p>

      {/* Filtri */}
      <div style={card}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {[['mese', 'Questo mese'], ['mesescorso', 'Mese scorso'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimi 30 giorni'], ['90', 'Ultimi 90 giorni'], ['anno', "Quest'anno"]].map(([t, l]) => (
            <button key={t} onClick={() => rangeVeloce(t)} style={chip}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Data inizio</label><input type="date" value={dal} onChange={e => setDal(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Data fine</label><input type="date" value={al} onChange={e => setAl(e.target.value)} style={inp} /></div>
          <button onClick={carica} style={{ ...btnPrimario, height: '38px' }}>Filtra</button>
        </div>
      </div>

      {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Caricamento…</div>
        : !d ? <div style={{ ...card, textAlign: 'center', color: '#999' }}>Nessun dato disponibile.</div>
          : (
            <>
              {/* KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '12px', marginBottom: '16px' }}>
                <Kpi label="Profitto netto" value={eur(k.profitto)} color={k.profitto >= 0 ? VERDE : '#dc2626'} big />
                <Kpi label="Fatturato (ai clienti)" value={eur(k.fatturato)} color={ARANCIO} />
                <Kpi label="Costo corriere" value={eur(k.costo)} color="#dc2626" />
                <Kpi label="Margine" value={`${k.margine}%`} color={NERO} />
                <Kpi label="Spedizioni" value={String(k.spedizioni)} color={NERO} />
                <Kpi label="Costo medio / sped." value={eur(k.costoMedio)} color={NERO} />
                <Kpi label="Profitto medio / sped." value={eur(k.profittoMedio)} color={k.profittoMedio >= 0 ? VERDE : '#dc2626'} />
                <Kpi label="Costo singolo più alto" value={eur(k.costoMax)} color={NERO} hint={d.costoMaxDettaglio?.cliente} />
              </div>

              {/* Serie temporale */}
              <div style={{ ...card, height: '340px' }}>
                <div style={titolo}>Fatturato, costo e profitto nel tempo</div>
                <ResponsiveContainer width="100%" height="88%">
                  <LineChart data={d.serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="giorno" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(8) + '/' + v.slice(5, 7)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => eur(v)} labelFormatter={(l) => l} />
                    <Legend />
                    <Line type="monotone" dataKey="fatturato" name="Fatturato" stroke={ARANCIO} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="costo" name="Costo" stroke="#dc2626" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="profitto" name="Profitto" stroke={VERDE} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Profitto per corriere: grafico + tabella */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }} className="grid2">
                <div style={{ ...card, height: '320px' }}>
                  <div style={titolo}>Profitto per corriere</div>
                  <ResponsiveContainer width="100%" height="86%">
                    <BarChart data={d.perCorriere} layout="vertical" margin={{ left: 20, right: 12 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="corriere" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip formatter={(v: any) => eur(v)} />
                      <Bar dataKey="profitto" name="Profitto" fill={VERDE} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={card}>
                  <div style={titolo}>Dettaglio per corriere</div>
                  <Tabella cols={['Vettore', 'Sped.', 'Fatturato', 'Costo', 'Profitto', 'Margine']}
                    rows={d.perCorriere.map((c: any) => [c.corriere, c.spedizioni, eur(c.fatturato), eur(c.costo),
                    <span style={{ color: c.profitto >= 0 ? VERDE : '#dc2626', fontWeight: 700 }}>{eur(c.profitto)}</span>, `${c.margine}%`])} />
                </div>
              </div>

              {/* Top clienti */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="grid2">
                <div style={{ ...card, height: '340px' }}>
                  <div style={titolo}>Top clienti (fatturato)</div>
                  <ResponsiveContainer width="100%" height="88%">
                    <BarChart data={d.topFatturato} layout="vertical" margin={{ left: 20, right: 12 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={130} />
                      <Tooltip formatter={(v: any) => eur(v)} />
                      <Bar dataKey="fatturato" name="Fatturato" fill={ARANCIO} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ ...card, height: '340px' }}>
                  <div style={titolo}>Clienti più redditizi</div>
                  <ResponsiveContainer width="100%" height="88%">
                    <BarChart data={d.topProfitto} layout="vertical" margin={{ left: 20, right: 12 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={130} />
                      <Tooltip formatter={(v: any) => eur(v)} />
                      <Bar dataKey="profitto" name="Profitto" fill={VERDE} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
      <style>{`@media (max-width: 900px){ .grid2 { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function Kpi({ label, value, color, big, hint }: any) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px' }}>
      <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: big ? '24px' : '19px', fontWeight: 800, color, marginTop: '4px' }}>{value}</div>
      {hint && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{hint}</div>}
    </div>
  )
}
function Tabella({ cols, rows }: { cols: string[]; rows: any[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead><tr>{cols.map((c, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} style={{ textAlign: j === 0 ? 'left' : 'right', padding: '8px 10px', color: NERO, borderBottom: '1px solid #f6f6f6', whiteSpace: 'nowrap' }}>{cell}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>Nessun dato</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px', marginBottom: '16px' }
const titolo = { fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '10px' }
const lbl = { fontSize: '11px', fontWeight: 600 as const, color: '#9ca3af', display: 'block' as const, marginBottom: '4px', textTransform: 'uppercase' as const }
const inp = { padding: '8px 11px', border: '1px solid #e2e2e2', borderRadius: '8px', fontSize: '13px', color: NERO }
const chip = { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '6px 12px', fontSize: '12px', color: '#374151', cursor: 'pointer' }
const btnPrimario = { background: ARANCIO, color: '#fff', border: 'none', borderRadius: '8px', padding: '0 18px', fontSize: '13px', fontWeight: 700 as const, cursor: 'pointer' }
