'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import DateRangePicker from '@/app/components/DateRangePicker'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ARANCIO = '#f97316', VERDE = '#16a34a', NERO = '#1a1a1a'
const oggi = () => new Date().toISOString().slice(0, 10)
const primoMese = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }

export default function StatClientiPage() {
  const [dal, setDal] = useState(primoMese()); const [al, setAl] = useState(oggi())
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true)
  async function carica() { setLoading(true); try { const r = await fetch(`/api/statistiche/clienti?dal=${dal}&al=${al}`); const j = await r.json(); setD(j.error ? null : j) } catch { setD(null) } setLoading(false) }
  useEffect(() => { carica() }, [])  // eslint-disable-line
  function range(t: string) { const dd = new Date(); let s = new Date(); if (t === 'mese') s = new Date(dd.getFullYear(), dd.getMonth(), 1); else if (t === '7') s.setDate(dd.getDate() - 6); else if (t === '30') s.setDate(dd.getDate() - 29); else if (t === '90') s.setDate(dd.getDate() - 89); else if (t === 'anno') s = new Date(dd.getFullYear(), 0, 1); setDal(s.toISOString().slice(0, 10)); setAl(oggi()) }
  const k = d?.kpi

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: '0 0 2px' }}>Analisi Clienti</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 16px' }}>Fatturato, crescita e abbandono — solo i tuoi clienti e la tua rete diretta.</p>
      <div style={card}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {[['mese', 'Questo mese'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimi 30 giorni'], ['90', 'Ultimi 90 giorni'], ['anno', "Quest'anno"]].map(([t, l]) => <button key={t} onClick={() => range(t)} style={chip}>{l}</button>)}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Periodo</label><DateRangePicker dal={dal} al={al} onChange={(d, a) => { setDal(d); setAl(a) }} /></div>
          <button onClick={carica} style={btnP}>Filtra</button>
        </div>
      </div>
      {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Caricamento…</div> : !d ? <div style={{ ...card, textAlign: 'center', color: '#999' }}>Nessun dato.</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '12px', marginBottom: '16px' }}>
            <Kpi label="Clienti attivi" value={String(k.clientiAttivi)} color={NERO} big />
            <Kpi label="Fatturato medio / cliente" value={eur(k.fatturatoMedio)} color={ARANCIO} />
            <Kpi label="Profitto medio / cliente" value={eur(k.profittoMedio)} color={VERDE} />
            <Kpi label="Valore fatturato periodo" value={eur(k.valoreDaFatturare)} color={NERO} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="grid2">
            <div style={{ ...card, height: '340px' }}><div style={titolo}>Top clienti per fatturato</div>
              <ResponsiveContainer width="100%" height="88%"><BarChart data={d.topFatturato} layout="vertical" margin={{ left: 20 }}><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={140} /><Tooltip formatter={(v: any) => eur(v)} /><Bar dataKey="fatturato" fill={ARANCIO} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
            </div>
            <div style={{ ...card, height: '340px' }}><div style={titolo}>Top clienti per profitto</div>
              <ResponsiveContainer width="100%" height="88%"><BarChart data={d.topProfitto} layout="vertical" margin={{ left: 20 }}><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={140} /><Tooltip formatter={(v: any) => eur(v)} /><Bar dataKey="profitto" fill={VERDE} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
            </div>
          </div>
          <div style={card}><div style={titolo}>Dettaglio clienti</div>
            <Tabella cols={['Cliente', 'Sped.', 'Fatturato', 'Costo', 'Profitto', 'Margine', 'Resi', 'Contrassegno', 'Ultima sped.']}
              rows={d.righe.map((r: any) => [r.nome, r.spedizioni, eur(r.fatturato), eur(r.costo), <span style={{ color: r.profitto >= 0 ? VERDE : '#dc2626', fontWeight: 700 }}>{eur(r.profitto)}</span>, `${r.margine}%`, r.resi, eur(r.contrassegno), r.ultima || '—'])} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="grid2">
            <div style={card}><div style={titolo}>Clienti in crescita</div>
              <Tabella cols={['Cliente', 'Precedente', 'Attuale', 'Variazione']} rows={d.crescita.map((c: any) => [c.nome, eur(c.precedente), eur(c.attuale), <span style={{ color: VERDE, fontWeight: 700 }}>+{eur(c.variazione)}</span>])} />
            </div>
            <div style={card}><div style={titolo}>Rischio abbandono (inattivi)</div>
              <Tabella cols={['Cliente', 'Fatturato precedente']} rows={d.rischio.map((c: any) => [c.nome, eur(c.fatturatoPrec)])} />
            </div>
          </div>
        </>
      )}
      <style>{`@media (max-width:900px){.grid2{grid-template-columns:1fr !important}}`}</style>
    </div>
  )
}
function Kpi({ label, value, color, big }: any) { return (<div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px' }}><div style={{ fontSize: '10.5px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: big ? '24px' : '19px', fontWeight: 800, color, marginTop: '4px' }}>{value}</div></div>) }
function Tabella({ cols, rows }: { cols: string[]; rows: any[][] }) { return (<div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}><thead><tr>{cols.map((c, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} style={{ textAlign: j === 0 ? 'left' : 'right', padding: '8px 10px', color: NERO, borderBottom: '1px solid #f6f6f6', whiteSpace: 'nowrap' }}>{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={cols.length} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>Nessun dato</td></tr>}</tbody></table></div>) }
const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px', marginBottom: '16px' }
const titolo = { fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '10px' }
const lbl = { fontSize: '11px', fontWeight: 600 as const, color: '#9ca3af', display: 'block' as const, marginBottom: '4px', textTransform: 'uppercase' as const }
const inp = { padding: '8px 11px', border: '1px solid #e2e2e2', borderRadius: '8px', fontSize: '13px', color: NERO }
const chip = { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '6px 12px', fontSize: '12px', color: '#374151', cursor: 'pointer' }
const btnP = { background: ARANCIO, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 700 as const, cursor: 'pointer', height: '38px' }
