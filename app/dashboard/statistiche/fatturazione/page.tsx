'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import DateRangePicker from '@/app/components/DateRangePicker'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ARANCIO = '#f97316', VERDE = '#16a34a', NERO = '#1a1a1a'
const oggi = () => new Date().toISOString().slice(0, 10)
const inizioAnno = () => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)

export default function StatFatturazionePage() {
  const [dal, setDal] = useState(inizioAnno()); const [al, setAl] = useState(oggi())
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true)
  async function carica() { setLoading(true); try { const r = await fetch(`/api/statistiche/fatturazione?dal=${dal}&al=${al}`); const j = await r.json(); setD(j.error ? null : j) } catch { setD(null) } setLoading(false) }
  useEffect(() => { carica() }, [])  // eslint-disable-line
  const k = d?.kpi
  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: '0 0 2px' }}>Fatturazione</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 16px' }}>Fatturato ai tuoi clienti e alla tua rete diretta.</p>
      <div style={card}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Periodo</label><DateRangePicker dal={dal} al={al} onChange={(d, a) => { setDal(d); setAl(a) }} /></div>
          <button onClick={carica} style={btnP}>Filtra</button>
        </div>
      </div>
      {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Caricamento…</div> : !d ? <div style={{ ...card, textAlign: 'center', color: '#999' }}>Nessun dato.</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '12px', marginBottom: '16px' }}>
            <Kpi label="Fatturato totale" value={eur(k.fatturatoTot)} color={ARANCIO} big />
            <Kpi label="Da fatturare (fattura mensile)" value={eur(k.daFatturare)} color={VERDE} />
            <Kpi label="Clienti / entità" value={String(k.clienti)} color={NERO} />
          </div>
          <div style={{ ...card, height: '320px' }}><div style={titolo}>Fatturato per mese</div>
            <ResponsiveContainer width="100%" height="86%"><BarChart data={d.serieMese}><XAxis dataKey="mese" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v: any) => eur(v)} /><Bar dataKey="fatturato" fill={ARANCIO} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
          <div style={card}><div style={titolo}>Fatturato per cliente / entità</div>
            <Tabella cols={['Nome', 'Tipo', 'Fatturato']} rows={d.righe.map((r: any) => [r.nome, r.tipo, eur(r.fatturato)])} />
          </div>
        </>
      )}
    </div>
  )
}
function Kpi({ label, value, color, big }: any) { return (<div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px' }}><div style={{ fontSize: '10.5px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: big ? '24px' : '19px', fontWeight: 800, color, marginTop: '4px' }}>{value}</div></div>) }
function Tabella({ cols, rows }: { cols: string[]; rows: any[][] }) { return (<div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}><thead><tr>{cols.map((c, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : (i === 1 ? 'left' : 'right'), padding: '8px 10px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} style={{ textAlign: j === 0 ? 'left' : (j === 1 ? 'left' : 'right'), padding: '8px 10px', color: NERO, borderBottom: '1px solid #f6f6f6', whiteSpace: 'nowrap' }}>{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={cols.length} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>Nessun dato</td></tr>}</tbody></table></div>) }
const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px', marginBottom: '16px' }
const titolo = { fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '10px' }
const lbl = { fontSize: '11px', fontWeight: 600 as const, color: '#9ca3af', display: 'block' as const, marginBottom: '4px', textTransform: 'uppercase' as const }
const inp = { padding: '8px 11px', border: '1px solid #e2e2e2', borderRadius: '8px', fontSize: '13px', color: NERO }
const btnP = { background: ARANCIO, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 700 as const, cursor: 'pointer', height: '38px' }
