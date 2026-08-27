'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import { useDialog } from '@/app/components/DialogProvider'

const sel = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', background: '#fff', color: '#1a1a1a', width: '100%' } as const
const lbl = { fontSize: '11px', fontWeight: 600 as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '4px' }

// REPORT AGENTI — quanto ha guadagnato ogni agente nel periodo, col suo metodo. Stile dei report
// (DateRangePicker con presets + filtro agente + download XLSX/CSV/PDF), più la tabella a schermo.
export default function ReportAgentiPage() {
  const dialog = useDialog()
  const oggi = new Date().toISOString().split('T')[0]
  const primo = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const [agentiLista, setAgentiLista] = useState<any[]>([])
  const [filtri, setFiltri] = useState({ agenteId: '', dal: primo, al: oggi, formato: 'XLSX' })
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [scaricando, setScaricando] = useState(false)

  async function carica() {
    setLoading(true)
    const p = new URLSearchParams({ dal: filtri.dal, al: filtri.al })
    if (filtri.agenteId) p.set('agenteId', filtri.agenteId)
    const r = await fetch('/api/agenti/report?' + p.toString()).then(x => x.json()).catch(() => null)
    setD(r && !r.error ? r : { agenti: [], totale: 0, error: r?.error })
    if (r?.agenti && !agentiLista.length) setAgentiLista(r.agenti)   // popola il filtro dalla prima lettura completa
    setLoading(false)
  }
  // Auto-aggiorna appena cambi un filtro (come Elenco Spedizioni): niente bottone "Aggiorna".
  useEffect(() => { carica() }, [filtri.agenteId, filtri.dal, filtri.al])

  const eur = (n: number) => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4' }

  const baseTxt = (a: any) => a.metodo === 'fisso' ? `${a.base} sped.`
    : a.metodo === 'perc_lordo' ? `${eur(a.base)} lordo × ${a.valore}%`
      : a.metodo === 'perc_netto' ? `${eur(a.base)} netto × ${a.valore}%`
        : `${eur(a.lordo)} − ${eur(a.base)} costo`

  async function scarica() {
    const righe = (d?.agenti || [])
    if (!righe.length) { await dialog.alert({ title: 'Nessun dato', message: 'Nessun agente da scaricare nel periodo.' }); return }
    setScaricando(true)
    try {
      const nomeBase = `report_agenti_${filtri.dal}_${filtri.al}`
      const fmt = filtri.formato.toLowerCase()
      const rows = righe.map((a: any) => ({
        Agente: a.nome, Metodo: a.metodoLabel,
        Valore: a.metodo === 'fisso' ? a.valore + ' €/sped' : (a.metodo.startsWith('perc') ? a.valore + '%' : '—'),
        Spedizioni: a.numSpedizioni, Base: baseTxt(a).replace(/€\s?/g, ''),
        'Da dargli (€)': Number(a.guadagno).toFixed(2),
      }))
      if (fmt === 'xlsx' || fmt === 'csv') {
        const XLSX = await import('xlsx')
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Agenti')
        XLSX.writeFile(wb, nomeBase + (fmt === 'csv' ? '.csv' : '.xlsx'), { bookType: fmt === 'csv' ? 'csv' : 'xlsx' })
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF()
        doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(40, 40, 40)
        doc.text('Report Agenti', 14, 20)
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90)
        doc.text('( ' + new Date(filtri.dal).toLocaleDateString('it-IT') + ' - ' + new Date(filtri.al).toLocaleDateString('it-IT') + ' )', 14, 27)
        autoTable(doc, {
          startY: 34, styles: { fontSize: 8, cellPadding: 2, textColor: [80, 80, 80] },
          headStyles: { fillColor: [255, 255, 255], textColor: [80, 80, 80], fontStyle: 'bold', lineWidth: 0 },
          head: [['Agente', 'Metodo', 'Spedizioni', 'Base', 'Da dargli']],
          body: righe.map((a: any) => [a.nome, a.metodoLabel, String(a.numSpedizioni), baseTxt(a), a.guadagno.toFixed(2) + ' EUR']),
        })
        const fy = (doc as any).lastAutoTable.finalY + 12
        doc.setDrawColor(22, 163, 74); doc.setLineWidth(0.8); doc.line(14, fy - 4, 196, fy - 4)
        doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 163, 74)
        doc.text('TOTALE DA DARE', 20, fy + 4); doc.text('EUR ' + Number(d.totale).toFixed(2), 196, fy + 4, { align: 'right' })
        doc.save(nomeBase + '.pdf')
      }
    } catch { await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del file.' }) }
    setScaricando(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Report Agenti</h1>
        <p style={{ fontSize: 13, color: '#8a8a8a', margin: '4px 0 0' }}>Quanto ha guadagnato ogni agente nel periodo, col suo metodo di compenso — cioè quanto devi dargli.</p>
      </div>

      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #d1d5db', padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>Filtri {loading && d && <span style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af' }}>· aggiorno…</span>}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Agente</label>
            <SelectCercabile value={filtri.agenteId} onChange={e => setFiltri(f => ({ ...f, agenteId: (e.target as any).value }))} style={sel}>
              <option value="">Tutti gli agenti</option>
              {agentiLista.map((a: any) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal: string, al: string) => setFiltri(f => ({ ...f, dal, al }))} />
          </div>
        </div>
      </div>

      {(loading && !d) ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Caricamento…</div> : d?.error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>{d.error}</div>
      ) : !d?.agenti?.length ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Nessun agente nel periodo. Assegna il compenso dalla scheda dell&apos;agente (Impostazioni → Staff).</div>
      ) : (
        <>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#166534' }}>Totale da dare agli agenti</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#16a34a' }}>{eur(d.totale)}</span>
          </div>
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Agente</th><th style={th}>Metodo</th><th style={th}>Spedizioni</th><th style={th}>Base</th><th style={{ ...th, textAlign: 'right' }}>Da dargli</th>
              </tr></thead>
              <tbody>
                {d.agenti.map((a: any) => (
                  <tr key={a.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{a.nome}</td>
                    <td style={td}>
                      <span style={{ background: '#eef2ff', color: '#4338ca', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>{a.metodoLabel}</span>
                      {(a.metodo === 'perc_netto' || a.metodo === 'perc_lordo') && <span style={{ color: '#666', marginLeft: 6 }}>{a.valore}%</span>}
                      {a.metodo === 'fisso' && <span style={{ color: '#666', marginLeft: 6 }}>{eur(a.valore)}/sped.</span>}
                      {a.senzaListino && <span style={{ color: '#dc2626', marginLeft: 6, fontSize: 12 }}>⚠️ listino non assegnato</span>}
                    </td>
                    <td style={td}>{a.numSpedizioni}</td>
                    <td style={td}>{baseTxt(a)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: 15 }}>{eur(a.guadagno)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Download in fondo, dove sono i soldi — come Elenco Spedizioni. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <select value={filtri.formato} onChange={e => setFiltri(f => ({ ...f, formato: e.target.value }))} style={{ ...sel, width: 'auto', padding: '9px 12px' }}>
              <option value="XLSX">Excel</option><option value="CSV">CSV</option><option value="PDF">PDF</option>
            </select>
            <button onClick={scarica} disabled={scaricando} style={{ padding: '9px 22px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: scaricando ? .6 : 1 }}>
              {scaricando ? 'Scarico…' : '⬇ Scarica ' + (filtri.agenteId ? "l'agente" : 'tutti')}
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 10 }}>Calcolato sui movimenti reali dei clienti dell&apos;agente (rettifiche e resi compresi). Il &quot;netto&quot; è il margine tuo (prezzo cliente − tuo costo).</p>
        </>
      )}
    </div>
  )
}
