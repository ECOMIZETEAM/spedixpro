'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import DateRangePicker from '@/app/components/DateRangePicker'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ARANCIO = '#f97316', VERDE = '#16a34a', ROSSO = '#dc2626', NERO = '#1a1a1a'
const col = (x: number) => (x >= 0 ? VERDE : ROSSO)

function oggiStr() { return new Date().toISOString().slice(0, 10) }
function primoMese() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }

export default function StatProfittoPage() {
  const [dal, setDal] = useState(primoMese())
  const [al, setAl] = useState(oggiStr())
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function carica(da = dal, a = al) {
    setLoading(true)
    try {
      const res = await fetch(`/api/statistiche/profitto?dal=${da}&al=${a}`)
      const j = await res.json()
      setD(j.error ? null : j)
    } catch { setD(null) }
    setLoading(false)
  }
  useEffect(() => { carica() }, [])  // eslint-disable-line

  // Imposta un range rapido E ricarica subito (come la dashboard).
  function rangeVeloce(tipo: string) {
    const oggi = new Date(); let start = new Date(), end = new Date()
    if (tipo === 'oggi') { /* start=end=oggi */ }
    else if (tipo === 'ieri') { start.setDate(oggi.getDate() - 1); end.setDate(oggi.getDate() - 1) }
    else if (tipo === 'mese') start = new Date(oggi.getFullYear(), oggi.getMonth(), 1)
    else if (tipo === 'mesescorso') { start = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); end = new Date(oggi.getFullYear(), oggi.getMonth(), 0) }
    else if (tipo === '7') start.setDate(oggi.getDate() - 6)
    else if (tipo === '30') start.setDate(oggi.getDate() - 29)
    else if (tipo === '90') start.setDate(oggi.getDate() - 89)
    else if (tipo === 'anno') start = new Date(oggi.getFullYear(), 0, 1)
    const da = start.toISOString().slice(0, 10), a = end.toISOString().slice(0, 10)
    setDal(da); setAl(a); carica(da, a)
  }

  const t = d?.totale
  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: '0 0 2px' }}>Report Guadagno</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 16px' }}>Il calderone: tutto il guadagno del periodo, per voce, per contratto e per cliente. Combacia col Guadagno Totale della dashboard.</p>

      {/* Filtri */}
      <div style={card}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {[['oggi', 'Oggi'], ['ieri', 'Ieri'], ['mese', 'Questo mese'], ['mesescorso', 'Mese scorso'], ['7', 'Ultimi 7 gg'], ['30', 'Ultimi 30 gg'], ['90', 'Ultimi 90 gg'], ['anno', "Quest'anno"]].map(([ti, l]) => (
            <button key={ti} onClick={() => rangeVeloce(ti)} style={chip}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Periodo</label><DateRangePicker dal={dal} al={al} onChange={(da, a) => { setDal(da); setAl(a) }} /></div>
          <button onClick={() => carica()} style={{ ...btnPrimario, height: '38px' }}>Filtra</button>
        </div>
      </div>

      {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Caricamento…</div>
        : !d ? <div style={{ ...card, textAlign: 'center', color: '#999' }}>Nessun dato disponibile.</div>
          : (
            <>
              {/* KPI totali */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '16px' }}>
                <Kpi label="Guadagno Totale" value={eur(t.guadagno)} color={col(t.guadagno)} big />
                <Kpi label="Incassato (ricavi)" value={eur(t.ricavi)} color={ARANCIO} />
                <Kpi label="Speso (costi)" value={eur(t.costi)} color={ROSSO} />
                <Kpi label="Margine" value={`${t.margine}%`} color={NERO} />
                <Kpi label="Spedizioni" value={Number(d.spedizioni).toLocaleString('it-IT')} color={NERO} />
                <Kpi label="Guadagno medio / sped." value={eur(d.guadagnoMedio)} color={col(d.guadagnoMedio)} />
              </div>

              {/* Per voce (il calderone scomposto) */}
              <div style={card}>
                <div style={titolo}>Da dove viene il guadagno</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
                  {d.perVoce.map((v: any) => (
                    <div key={v.tipo} style={{ border: '1px solid #eee', borderRadius: '9px', padding: '11px 13px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>{v.label}</div>
                      <div style={{ fontSize: '17px', fontWeight: 800, color: col(v.guadagno), marginTop: '3px' }}>{eur(v.guadagno)}</div>
                      <div style={{ fontSize: '10.5px', color: '#9ca3af', marginTop: '2px' }}>incassa {eur(v.ricavi)} · spende {eur(v.costi)}</div>
                    </div>
                  ))}
                  {!d.perVoce.length && <div style={{ color: '#9ca3af', fontSize: '13px' }}>Nessun movimento nel periodo.</div>}
                </div>
              </div>

              {/* Per contratto */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }} className="grid2">
                <div style={{ ...card, height: '380px' }}>
                  <div style={titolo}>Guadagno per contratto (top 15)</div>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={d.perContratto.slice(0, 15)} layout="vertical" margin={{ left: 20, right: 12 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="contratto" tick={{ fontSize: 10 }} width={140} />
                      <Tooltip formatter={(v: any) => eur(v)} />
                      <Bar dataKey="guadagno" name="Guadagno" radius={[0, 4, 4, 0]}>
                        {d.perContratto.slice(0, 15).map((c: any, i: number) => <Cell key={i} fill={col(c.guadagno)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={card}>
                  <div style={titolo}>Dettaglio per contratto</div>
                  <Tabella cols={['Contratto', 'Sped.', 'Incassato', 'Speso', 'Guadagno', 'Margine']}
                    rows={d.perContratto.map((c: any) => [c.contratto, Number(c.spedizioni).toLocaleString('it-IT'), eur(c.ricavi), eur(c.costi),
                    <span style={{ color: col(c.guadagno), fontWeight: 700 }}>{eur(c.guadagno)}</span>, `${c.margine}%`])} />
                </div>
              </div>

              {/* Per cliente */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="grid2">
                <div style={{ ...card, height: '400px' }}>
                  <div style={titolo}>Guadagno per cliente (top 15)</div>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={d.perCliente.slice(0, 15)} layout="vertical" margin={{ left: 20, right: 12 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={150} />
                      <Tooltip formatter={(v: any) => eur(v)} />
                      <Bar dataKey="guadagno" name="Guadagno" radius={[0, 4, 4, 0]}>
                        {d.perCliente.slice(0, 15).map((c: any, i: number) => <Cell key={i} fill={col(c.guadagno)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={card}>
                  <div style={titolo}>Dettaglio per cliente ({d.perCliente.length})</div>
                  <Tabella cols={['Cliente / entità', 'Sped.', 'Incassato', 'Speso', 'Guadagno', 'Margine']}
                    rows={d.perCliente.map((c: any) => [c.nome, Number(c.spedizioni).toLocaleString('it-IT'), eur(c.ricavi), eur(c.costi),
                    <span style={{ color: col(c.guadagno), fontWeight: 700 }}>{eur(c.guadagno)}</span>, `${c.margine}%`])} />
                </div>
              </div>
            </>
          )}
      <style>{`@media (max-width: 900px){ .grid2 { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function Kpi({ label, value, color, big }: any) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px' }}>
      <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: big ? '26px' : '19px', fontWeight: 800, color, marginTop: '4px' }}>{value}</div>
    </div>
  )
}
function Tabella({ cols, rows }: { cols: string[]; rows: any[][] }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead><tr>{cols.map((c, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', borderBottom: '1px solid #eee', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' }}>{c}</th>)}</tr></thead>
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
const chip = { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '6px 12px', fontSize: '12px', color: '#374151', cursor: 'pointer' }
const btnPrimario = { background: ARANCIO, color: '#fff', border: 'none', borderRadius: '8px', padding: '0 18px', fontSize: '13px', fontWeight: 700 as const, cursor: 'pointer' }
