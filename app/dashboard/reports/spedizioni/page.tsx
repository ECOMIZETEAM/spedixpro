'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

export default function ReportSpedizioniPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [filtri, setFiltri] = useState({
    clienteId: '', tipoContratto: '', vettore: '', contratto: '',
    dal: '', al: '', agente: '', provincia: '', stato: '', contrassegno: '', formato: 'PDF',
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d : (d?.clienti || [])))
    caricaReports()
  }, [])

  async function caricaReports() {
    try {
      const res = await fetch('/api/reports/lista?tipo=spedizioni')
      const d = await res.json()
      setReports(Array.isArray(d) ? d : [])
    } catch { setReports([]) }
  }

  const setF = (k: string, v: string) => setFiltri(f => ({ ...f, [k]: v }))

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      Object.entries(filtri).forEach(([k, v]) => { if (v) params.set(k, v) })
      const res = await fetch('/api/reports/spedizioni?' + params.toString())
      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'report_spedizioni.' + (filtri.formato === 'PDF' ? 'pdf' : filtri.formato === 'XLSX' ? 'xlsx' : 'csv')
        a.click()
        window.URL.revokeObjectURL(url)
        await caricaReports()
      } else {
        alert('Errore nella generazione del report')
      }
    } catch {
      alert('Errore nella generazione del report')
    }
    setGenerating(false)
  }

  const dateInput = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box' as const }
  const lbl = { fontSize: '11px', fontWeight: '600', color: '#1a1a1a', display: 'block', marginBottom: '4px' } as const
  const STATI: Record<string, string> = { creata: 'Creata', in_transito: 'In transito', consegnata: 'Consegnata', giacenza: 'Giacenza', annullata: 'Annullata', reso: 'Reso' }

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Genera Report Spedizioni PDF</h1>
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', padding: '18px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a', marginBottom: '14px' }}>{'\uD83D\uDD0D'} Nuovo report</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e => setF('clienteId', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
              {clienti.map((c: any) => <option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Tipo Contratto</label>
            <select value={filtri.tipoContratto} onChange={e => setF('tipoContratto', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
              <option value="nazionale">Nazionale</option>
              <option value="internazionale">Internazionale</option>
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e => setF('vettore', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option><option value="gls">GLS</option>
              <option value="brt">BRT</option><option value="poste">Poste</option>
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e => setF('contratto', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal, al) => setFiltri(f => ({ ...f, dal, al }))} />
          </div>
          <div><label style={lbl}>Agente</label>
            <select value={filtri.agente} onChange={e => setF('agente', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div><label style={lbl}>Provincia</label>
            <select value={filtri.provincia} onChange={e => setF('provincia', e.target.value)} style={dateInput}>
              <option value="">Tutte</option>
            </select>
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e => setF('stato', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
              {Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px', maxWidth: '50%' }}>
          <div><label style={lbl}>Contrassegno</label>
            <select value={filtri.contrassegno} onChange={e => setF('contrassegno', e.target.value)} style={dateInput}>
              <option value="">Tutti</option>
              <option value="si">Con contrassegno</option>
              <option value="no">Senza contrassegno</option>
            </select>
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e => setF('formato', e.target.value)} style={dateInput}>
              <option value="PDF">PDF</option><option value="XLSX">Excel</option><option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <button onClick={generaReport} disabled={generating}
          style={{ padding: '9px 24px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', opacity: generating ? 0.7 : 1 }}>
          {generating ? 'Generazione...' : 'Genera Report'}
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', fontWeight: '400', color: '#666' }}>
          Mostra{' '}
          <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPagina(1) }}
            style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', color: '#1a1a1a', background: '#fff' }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>{' '}elementi
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['ID', 'Data', 'Filtri', 'Formato', 'Utente', 'Size', 'Status', 'Scarica'].map(h => (
                <th key={h} style={{ textAlign: 'left' as const, padding: '11px 16px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#1a1a1a', borderBottom: '1px solid #d1d5db' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center' as const, color: '#1a1a1a', fontSize: '13px' }}>Nessun report generato</td></tr>
            ) : reportsPaginate.map((r: any, i: number) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '14px 16px', fontWeight: '700', color: '#1a1a1a' }}>{reports.length - ((paginaCorr - 1) * perPage + i)}</td>
                <td style={{ padding: '14px 16px', color: '#1a1a1a', fontSize: '12px' }}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{ padding: '14px 16px', color: '#f97316', fontSize: '12px' }}>{Object.entries(r.filtri || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || '-'}</td>
                <td style={{ padding: '14px 16px' }}><span style={{ background: '#e0f2fe', color: '#0369a1', padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>{(r.formato || '').toLowerCase()}</span></td>
                <td style={{ padding: '14px 16px', color: '#1a1a1a' }}>{r.utente_nome || '-'}</td>
                <td style={{ padding: '14px 16px', color: '#999' }}>{r.size || '\u2014'}</td>
                <td style={{ padding: '14px 16px', color: '#16a34a' }}>{r.stato || '-'}</td>
                <td style={{ padding: '14px 16px' }}>
                  {r.file_url
                    ? <a href={r.file_url} style={{ color: '#f97316', fontWeight: '600', textDecoration: 'none' }}>Scarica</a>
                    : <span style={{ color: '#f97316', fontWeight: '600', cursor: 'pointer' }} onClick={generaReport}>Scarica</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalePagine > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #e5e7eb', flexWrap: 'wrap' as const, gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#666' }}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, reports.length)} di {reports.length}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaCorr <= 1} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', fontSize: '12px', cursor: paginaCorr <= 1 ? 'default' : 'pointer', color: paginaCorr <= 1 ? '#ccc' : '#1a1a1a' }}>Precedente</button>
              {Array.from({ length: totalePagine }, (_, i) => i + 1).filter(n => n === 1 || n === totalePagine || Math.abs(n - paginaCorr) <= 2).map((n, idx, arr) => (
                <span key={n} style={{ display: 'flex', alignItems: 'center' }}>
                  {idx > 0 && arr[idx - 1] !== n - 1 && <span style={{ padding: '0 4px', color: '#bbb', fontSize: '12px' }}>{'\u2026'}</span>}
                  <button onClick={() => setPagina(n)} style={{ minWidth: '30px', padding: '5px 8px', border: '1px solid', borderColor: n === paginaCorr ? '#f97316' : '#d1d5db', borderRadius: '5px', background: n === paginaCorr ? '#f97316' : '#fff', color: n === paginaCorr ? '#fff' : '#1a1a1a', fontSize: '12px', fontWeight: n === paginaCorr ? '700' : '400', cursor: 'pointer' }}>{n}</button>
                </span>
              ))}
              <button onClick={() => setPagina(p => Math.min(totalePagine, p + 1))} disabled={paginaCorr >= totalePagine} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', fontSize: '12px', cursor: paginaCorr >= totalePagine ? 'default' : 'pointer', color: paginaCorr >= totalePagine ? '#ccc' : '#1a1a1a' }}>Successivo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}