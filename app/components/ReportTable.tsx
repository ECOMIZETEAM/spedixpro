'use client'
import { useState } from 'react'

export default function ReportTable({ reports, onScarica }: { reports: any[], onScarica: () => void }) {
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
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
        <thead><tr style={{ background: '#f9fafb' }}>
          {['ID', 'Data', 'Filtri', 'Formato', 'Utente', 'Status', 'Scarica'].map(h => (
            <th key={h} style={{ textAlign: 'left' as const, padding: '9px 14px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' as const, color: '#1a1a1a', borderBottom: '1px solid #d1d5db' }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {!reports.length ? (
            <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center' as const, color: '#1a1a1a' }}>Nessun report generato</td></tr>
          ) : reportsPaginate.map((r: any, i: number) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #d1d5db' }}>
              <td style={{ padding: '9px 14px', fontWeight: '600' }}>{reports.length - ((paginaCorr - 1) * perPage + i)}</td>
              <td style={{ padding: '9px 14px', fontSize: '12px' }}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
              <td style={{ padding: '9px 14px', color: '#f97316', fontSize: '12px' }}>{Object.entries(r.filtri || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ')}</td>
              <td style={{ padding: '9px 14px' }}><span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>{r.formato}</span></td>
              <td style={{ padding: '9px 14px' }}>{r.utente_nome}</td>
              <td style={{ padding: '9px 14px', color: '#16a34a', fontWeight: '500' }}>{r.stato}</td>
              <td style={{ padding: '9px 14px' }}><span style={{ color: '#f97316', fontWeight: '600', cursor: 'pointer' }} onClick={onScarica}>Scarica</span></td>
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
  )
}