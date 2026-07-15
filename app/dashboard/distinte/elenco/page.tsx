'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

export default function ElencoDistintePage() {
  const [distinte, setDistinte] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [dal, setDal] = useState('')
  const [al, setAl] = useState('')
  const [selezionate, setSelezionate] = useState<Set<string>>(new Set())
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)

  useEffect(() => { carica() }, [dal, al])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (dal) params.set('dal', dal)
    if (al) params.set('al', al)
    const res = await fetch('/api/distinte?' + params.toString())
    const d = await res.json()
    setDistinte(Array.isArray(d) ? d : [])
    setLoading(false)
  }

  function toggle(id: string) {
    setSelezionate(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s })
  }

  async function confermaSelezionate() {
    if (!selezionate.size) { alert('Seleziona almeno una distinta'); return }
    const res = await fetch('/api/distinte/conferma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distinteIds: Array.from(selezionate) })
    })
    const d = await res.json()
    if (d.success) { setSelezionate(new Set()); await carica() }
    else { alert('Errore: ' + (d.error || 'conferma fallita')) }
  }

  async function stampaPDF(dist: any) {
    const res = await fetch('/api/distinte/dettaglio?id=' + dist.id)
    const righe = await res.json()
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    const dataDist = dist.data ? new Date(dist.data).toLocaleDateString('it-IT') : ''
    const nomeContr = (dist.corrieri?.nome_contratto || 'CORRIERE').toUpperCase()
    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text('Bordero ' + nomeContr + ' numero ' + dist.numero + ' Del ' + dataDist, 105, 18, { align: 'center' })
    autoTable(doc, {
      startY: 28,
      head: [['Spedizioni', 'Destinatario', 'Indirizzo Cap localita', 'Rif. Numerico', 'Imp. Assic.', 'Imp. C/Assegno', 'Colli', 'Peso']],
      body: (Array.isArray(righe) ? righe : []).map((r: any) => [
        r.numero || '',
        r.dest_nome || '',
        ((r.dest_indirizzo || '') + '\n' + (r.dest_cap || '') + ' ' + (r.dest_citta || '') + ' (' + (r.dest_provincia || '') + ')'),
        r.rif_destinatario || '',
        (Number(r.assicurazione || 0)).toFixed(2) + ' EUR',
        (Number(r.contrassegno || 0)).toFixed(2) + ' EUR',
        r.colli || 1,
        (Number(r.peso_reale || 0)).toFixed(0) + ' kg',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
    })
    doc.save('Bordero_' + dist.numero + '.pdf')
  }

  async function esportaExcel(dist: any) {
    const res = await fetch('/api/distinte/dettaglio?id=' + dist.id)
    const righe = await res.json()
    const { utils, writeFile } = await import('xlsx')
    const ws = utils.json_to_sheet((Array.isArray(righe) ? righe : []).map((r: any) => ({
      Spedizioni: r.numero, Destinatario: r.dest_nome, Indirizzo: r.dest_indirizzo,
      CAP: r.dest_cap, Citta: r.dest_citta, Provincia: r.dest_provincia,
      Contrassegno: Number(r.contrassegno || 0), Colli: r.colli || 1, Peso: Number(r.peso_reale || 0),
    })))
    const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Distinta ' + dist.numero)
    writeFile(wb, 'Distinta_' + dist.numero + '.xlsx')
  }

  const filtrate = distinte.filter(d => !cerca ||
    String(d.numero || '').toLowerCase().includes(cerca.toLowerCase()) ||
    String(d.cliente_label || d.clienti?.ragione_sociale || '').toLowerCase().includes(cerca.toLowerCase()))

  const totalePagine = Math.max(1, Math.ceil(filtrate.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const distintePaginate = filtrate.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  const inp = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff' } as const
  const th = { padding: '9px 12px', textAlign: 'left' as const, fontSize: '11px', fontWeight: '700', color: '#1a1a1a', borderBottom: '1px solid #d1d5db', whiteSpace: 'nowrap' as const }
  const td = { padding: '9px 12px', fontSize: '12px', color: '#1a1a1a' }
  const bIco = { padding: '5px 9px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', marginLeft: '4px' } as const

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Lista Distinte</h1>
        <span style={{display:'block',marginTop:'4px',fontSize:'12px',fontWeight:'400',color:'#666'}}>
          Mostra{' '}
          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}}
            style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>{' '}elementi
        </span>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', padding: '14px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Data</div><DateRangePicker dal={dal} al={al} onChange={(d1,d2)=>{setDal(d1);setAl(d2)}} /></div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <button onClick={confermaSelezionate} style={{ padding: '8px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Conferma Selezionate</button>
          <div><div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Cerca</div><input value={cerca} onChange={e => {setCerca(e.target.value);setPagina(1)}} placeholder="Numero o cliente..." style={{ ...inp, width: '220px' }} /></div>
        </div>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}></th>
                {['Nr', 'Cliente', 'Contratto', 'Data', 'Totale Ldv', 'Prezzo totale', 'Confermata al vettore', 'Data conferma', 'Azioni'].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: '20px' }}>Caricamento...</td></tr>
              ) : !filtrate.length ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: '20px' }}>Nessuna distinta creata</td></tr>
              ) : distintePaginate.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={td}><input type="checkbox" checked={selezionate.has(d.id)} onChange={() => toggle(d.id)} /></td>
                  <td style={{ ...td, fontWeight: '700' }}>{d.numero}</td>
                  <td style={td}>{d.cliente_label || d.clienti?.ragione_sociale || '-'}</td>
                  <td style={td}>{d.corrieri?.nome_contratto || '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.created_at ? new Date(d.created_at).toLocaleString('it-IT') : '-'}</td>
                  <td style={td}>{d.totale_ldv || 0}</td>
                  <td style={td}>{Number(d.prezzo_totale || 0).toFixed(2)} {'\u20AC'}</td>
                  <td style={td}>{d.confermata_vettore ? <span style={{ background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>Confermati</span> : <span style={{ background: '#f59e0b', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>In attesa</span>}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.data_conferma ? new Date(d.data_conferma).toLocaleString('it-IT') : '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={bIco} onClick={() => stampaPDF(d)} title="Stampa PDF">{'\uD83D\uDDA8'}</button>
                    <button style={{ ...bIco, background: '#15803d' }} onClick={() => esportaExcel(d)} title="Excel">{'\uD83D\uDCCA'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalePagine > 0 && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#666'}}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, filtrate.length)} di {filtrate.length}</span>
            <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
              <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
              {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(
                <span key={n} style={{display:'flex',alignItems:'center'}}>
                  {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>{'\u2026'}</span>}
                  <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
                </span>
              ))}
              <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
            </div>
          </div>
        )}
        <div style={{ padding: '10px 16px', fontSize: '12px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0' }}>Risultati: {filtrate.length} distinte</div>
      </div>
    </div>
  )
}