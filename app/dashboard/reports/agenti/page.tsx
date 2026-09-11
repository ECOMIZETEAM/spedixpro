'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'

const sel = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', background: '#fff', color: '#1a1a1a', width: '100%' } as const
const lbl = { fontSize: '11px', fontWeight: 600 as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '4px' }

// REPORT AGENTI — quanto ha guadagnato ogni agente nel periodo. STESSA grafica del Report Spedizioni:
// card filtri + Genera Report + elenco dei report generati (scaricabili). Il PDF ha l'intestazione del
// master (ragione sociale, indirizzo, PIVA, logo) come Spedisci.online — stesso builder condiviso.
export default function ReportAgentiPage() {
  const dialog = useDialog()
  const oggi = new Date().toISOString().split('T')[0]
  const primo = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const [agentiLista, setAgentiLista] = useState<any[]>([])
  const [filtri, setFiltri] = useState({ agenteId: '', dal: primo, al: oggi, formato: 'PDF' })
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [intest, setIntest] = useState<any>({ nome: '', indirizzo: '', email: '', piva: '', logo_url: null })
  const [reports, setReports] = useState<any[]>([])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  async function carica() {
    setLoading(true)
    const p = new URLSearchParams({ dal: filtri.dal, al: filtri.al })
    if (filtri.agenteId) p.set('agenteId', filtri.agenteId)
    const r = await fetch('/api/agenti/report?' + p.toString()).then(x => x.json()).catch(() => null)
    setD(r && !r.error ? r : { agenti: [], totale: 0, error: r?.error })
    if (r?.agenti && !agentiLista.length) setAgentiLista(r.agenti)
    setLoading(false)
  }
  async function caricaReports() {
    const data = await fetch('/api/reports/lista?tipo=agenti').then(x => x.json()).catch(() => [])
    setReports(Array.isArray(data) ? data : [])
  }
  useEffect(() => { carica() }, [filtri.agenteId, filtri.dal, filtri.al])
  useEffect(() => {
    fetch('/api/reports/intestazione').then(r => r.json()).then(x => setIntest(x || {})).catch(() => {})
    caricaReports()
  }, [])

  const eur = (n: number) => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4' }
  const baseTxt = (a: any) => a.margineAgente != null ? eur(a.margineAgente) : '—'
  const valoreMetodo = (a: any) => a.metodo === 'fisso' ? `${a.valore} €/sped` : (String(a.metodo).startsWith('perc') ? `${a.valore}%` : '')

  function filtriTesto(): string {
    const t: string[] = ['periodo=' + filtri.dal + '→' + filtri.al]
    if (filtri.agenteId) { const a = agentiLista.find((x: any) => x.id === filtri.agenteId); t.push('agente=' + String(a?.nome || filtri.agenteId).replace(/\s+/g, '_')) }
    t.push('formato=' + filtri.formato)
    return t.join(' ')
  }
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const j = await inviaReport({ tipo: 'agenti', filtri: filtriTesto(), formato, fileBase64, nomeFile })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error || '') }); return }
    caricaReports()
  }

  async function generaReport() {
    const righe = (d?.agenti || [])
    if (!righe.length) { await dialog.alert({ title: 'Nessun dato', message: 'Nessun agente da scaricare nel periodo.' }); return }
    setGenerating(true)
    try {
      const gen = await import('@/lib/report-spedizioni-genera')
      const fmt = filtri.formato.toLowerCase() as 'pdf' | 'xlsx' | 'csv'
      const ext = gen.estFormato(fmt)
      const periodo = gen.periodoStr(filtri.dal, filtri.al)
      const nomeBase = `report_agenti_${filtri.dal}_${filtri.al}`
      const headers = ['Agente', 'Metodo', 'Spedizioni', 'Margine agente', 'Da dargli']
      const sumSped = righe.reduce((a: number, x: any) => a + (Number(x.numSpedizioni) || 0), 0)
      let b64: string
      if (fmt === 'pdf') {
        const rows = righe.map((a: any) => [a.nome, [a.metodoLabel, valoreMetodo(a)].filter(Boolean).join(' '), a.numSpedizioni, baseTxt(a), eur(a.guadagno)])
        const tot = ['TOTALE', '', sumSped, '', eur(d.totale)]
        const titolo = filtri.agenteId ? (agentiLista.find((x: any) => x.id === filtri.agenteId)?.nome || '') : ''
        b64 = await gen.pdfTabellaB64(intest, periodo, titolo, headers, rows, tot, { 2: 'center', 3: 'right', 4: 'right' })
      } else {
        const rows = righe.map((a: any) => [a.nome, [a.metodoLabel, valoreMetodo(a)].filter(Boolean).join(' '), a.numSpedizioni, a.margineAgente != null ? Math.round(a.margineAgente * 100) / 100 : '', Math.round(a.guadagno * 100) / 100])
        const tot = ['TOTALE', '', sumSped, '', Math.round(d.totale * 100) / 100]
        b64 = await gen.excelTabellaB64(headers, rows, tot, fmt)
      }
      await salvaReport(b64, nomeBase + '.' + ext, fmt)
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Generazione non riuscita: ' + (e?.message || '') })
    } finally {
      setGenerating(false)
    }
  }

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Report Agenti</h1>
        <p style={{ fontSize: 13, color: '#8a8a8a', margin: '4px 0 0' }}>Quanto ha guadagnato ogni agente nel periodo, col suo metodo di compenso — cioè quanto devi dargli.</p>
      </div>

      {/* Card filtri + genera — come Report Spedizioni */}
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #d1d5db', padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>🔍 Nuovo report {loading && d && <span style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af' }}>· aggiorno…</span>}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div><label style={lbl}>Agente</label>
            <SelectCercabile value={filtri.agenteId} onChange={e => setFiltri(f => ({ ...f, agenteId: (e.target as any).value }))} style={sel} cercaSempre>
              <option value="">Tutti gli agenti</option>
              {agentiLista.map((a: any) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal: string, al: string) => setFiltri(f => ({ ...f, dal, al }))} />
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e => setFiltri(f => ({ ...f, formato: e.target.value }))} style={sel}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <button onClick={generaReport} disabled={generating}
          style={{ padding: '9px 24px', background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: generating ? .7 : 1 }}>
          {generating ? 'Generazione...' : 'Genera Report'}
        </button>
      </div>

      {/* Anteprima a schermo: totale + tabella per agente */}
      {(loading && !d) ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Caricamento…</div> : d?.error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>{d.error}</div>
      ) : !d?.agenti?.length ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999', background: '#fff', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 16 }}>Nessun agente nel periodo. Assegna il compenso dalla scheda dell&apos;agente (Impostazioni → Staff).</div>
      ) : (
        <>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#166534' }}>Totale da dare agli agenti</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#16a34a' }}>{eur(d.totale)}</span>
          </div>
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Agente</th><th style={th}>Metodo</th><th style={th}>Spedizioni</th><th style={th}>Margine agente</th><th style={{ ...th, textAlign: 'right' }}>Da dargli</th>
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
              {/* Riga TOTALE in fondo alla tabella (come nei file PDF/Excel): prima c'era solo il
                  riquadro verde in alto, e in fondo alla tabella il totale mancava. */}
              <tfoot>
                <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                  <td style={{ ...td, fontWeight: 800 }}>TOTALE</td>
                  <td style={td}></td>
                  <td style={{ ...td, fontWeight: 700 }}>{d.agenti.reduce((a: number, x: any) => a + (Number(x.numSpedizioni) || 0), 0)}</td>
                  <td style={td}></td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: 15 }}>{eur(d.totale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 16px' }}>Calcolato sui movimenti reali dei clienti dell&apos;agente (rettifiche e resi compresi). Il &quot;Margine agente&quot; è il guadagno dell&apos;agente sui suoi clienti (prezzo cliente − costo del suo listino), non il tuo margine di master; &quot;—&quot; se all&apos;agente non è assegnato un listino.</p>
        </>
      )}

      {/* Elenco report generati — come Report Spedizioni */}
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', fontSize: 12, fontWeight: 400, color: '#666' }}>
          Report generati — Mostra{' '}
          <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPagina(1) }}
            style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, color: '#1a1a1a', background: '#fff' }}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>{' '}elementi
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['ID', 'Data', 'Filtri', 'Formato', 'Utente', 'Size', 'Status', 'Scarica'].map(h => (
                <th key={h} style={{ textAlign: 'left' as const, padding: '9px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, color: '#1a1a1a', borderBottom: '1px solid #d1d5db' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center' as const, color: '#1a1a1a', fontSize: 13 }}>Nessun report generato</td></tr>
            ) : reportsPaginate.map((r: any, i: number) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #d1d5db' }}>
                <td style={{ padding: '9px 14px', color: '#1a1a1a', fontWeight: 600 }}>{reports.length - ((paginaCorr - 1) * perPage + i)}</td>
                <td style={{ padding: '9px 14px', color: '#1a1a1a', fontSize: 12 }}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{ padding: '9px 14px', color: '#f97316', fontSize: 12 }}>
                  {String(r.filtri || '').split(' ').map((f: string, i: number) => <div key={i}>{f}</div>)}
                </td>
                <td style={{ padding: '9px 14px' }}>
                  <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{r.formato}</span>
                </td>
                <td style={{ padding: '9px 14px', color: '#1a1a1a', fontWeight: 500 }}>{r.utente || '—'}</td>
                <td style={{ padding: '9px 14px', color: '#1a1a1a', fontSize: 12 }}>{r.size_bytes ? `${Math.max(1, Math.round(r.size_bytes / 1024))} KB` : '—'}</td>
                <td style={{ padding: '9px 14px', color: '#16a34a', fontSize: 12, fontWeight: 500 }}>{r.status || '—'}</td>
                <td style={{ padding: '9px 14px' }}>
                  {r.file_url
                    ? <a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{ color: '#f97316', fontWeight: 600, fontSize: 13, cursor: 'pointer', textDecoration: 'none' }}>Scarica</a>
                    : <span style={{ color: '#9ca3af', fontSize: 12 }}>non conservato</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #e5e7eb', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#666' }}>{reports.length === 0 ? 0 : ((paginaCorr - 1) * perPage + 1)}-{Math.min(paginaCorr * perPage, reports.length)} di {reports.length}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaCorr <= 1} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 5, background: '#fff', fontSize: 12, cursor: paginaCorr <= 1 ? 'default' : 'pointer', color: paginaCorr <= 1 ? '#ccc' : '#1a1a1a' }}>Precedente</button>
            <button onClick={() => setPagina(p => Math.min(totalePagine, p + 1))} disabled={paginaCorr >= totalePagine} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 5, background: '#fff', fontSize: 12, cursor: paginaCorr >= totalePagine ? 'default' : 'pointer', color: paginaCorr >= totalePagine ? '#ccc' : '#1a1a1a' }}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}
