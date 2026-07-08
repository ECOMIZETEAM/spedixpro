'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportDistintePage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId: '',
    dal: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato: 'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=distinte').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const r = await fetch('/api/reports/salva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'distinte', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    })
    const j = await r.json()
    if (!j.success) { alert('Errore salvataggio report: ' + (j.error||'')); return }
    const lista = await fetch('/api/reports/lista?tipo=distinte').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('cliente_id', filtri.clienteId)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch(`/api/resi/distinte?${params}`)
    const distinte = await res.json()
    if (!distinte.length) { alert('Nessuna distinta trovata'); setGenerating(false); return }
    const formato = filtri.formato.toLowerCase()
    if (formato === 'xlsx' || formato === 'csv') {
      const { utils, writeFile } = await import('xlsx')
      const rows = distinte.map((d: any) => ({
        'Nr': d.numero, 'Cliente': d.clienti?.ragione_sociale||'—',
        'Data': new Date(d.created_at).toLocaleDateString('it-IT'),
        'Totale LDV': d.totale_ldv, 'Totale (€)': d.totale,
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Distinte')
      const XLSX = await import('xlsx'); const b64str = XLSX.write(wb, { bookType: formato==='csv'?'csv':'xlsx', type: 'base64' })
      await salvaReport(b64str, `report_distinte_${filtri.dal}.${formato==='xlsx'?'xlsx':'csv'}`, formato)
    } else {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF()
      doc.setFontSize(14)
      doc.text(`Report Distinte — ${filtri.dal} / ${filtri.al}`, 14, 15)
      autoTable(doc, {
        startY: 25,
        head: [['Nr','Cliente','Data','Totale LDV','Totale €']],
        body: distinte.map((d: any) => [
          d.numero, d.clienti?.ragione_sociale||'—',
          new Date(d.created_at).toLocaleDateString('it-IT'),
          d.totale_ldv, `€${Number(d.totale).toFixed(2)}`
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [249, 115, 22] },
      })
      const totDistinte = distinte.reduce((acc: number, d: any) => acc + Number(d.totale||0), 0)
      const pageH = doc.internal.pageSize.getHeight()
      const pageW = doc.internal.pageSize.getWidth()
      let fy = (doc as any).lastAutoTable.finalY + 16
      if (fy + 12 > pageH - 12) { doc.addPage(); fy = 24 }
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30)
      doc.text('TOTALE', pageW - 80, fy)
      doc.text(`EUR ${totDistinte.toFixed(2)}`, pageW - 14, fy, {align:'right'})
      const pdfB64 = doc.output('datauristring')
      await salvaReport(pdfB64, `report_distinte_${filtri.dal}.pdf`, 'pdf')
    }
    setGenerating(false)
  }

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Distinte</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i Clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <button onClick={generaReport} disabled={generating}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'10px'}}>
        <span style={{fontSize:'13px',color:'#1a1a1a'}}>Mostra</span>
        <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
        <span style={{fontSize:'13px',color:'#1a1a1a'}}>elementi</span>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead><tr style={{background:'#f9fafb'}}>
            {['ID','Data','Filtri','Formato','Utente','Status','Scarica'].map(h=>(
              <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={7} style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Nessun report generato</td></tr>
            ) : reportsPaginate.map((r:any,i:number)=>(
              <tr key={r.id} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',fontWeight:'600',color:'#1a1a1a'}}>{reports.length-i}</td>
                <td style={{padding:'9px 14px',fontSize:'12px',color:'#1a1a1a'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{String(r.filtri||'').split(' ').map((f: string, idx: number)=><div key={idx}>{f}</div>)}</td>
                <td style={{padding:'9px 14px'}}><span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span></td>
                <td style={{padding:'9px 14px'}}>{r.utente_nome}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontWeight:'500'}}>{r.stato}</td>
                <td style={{padding:'9px 14px'}}><a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{color:'#f97316',fontWeight:'600',fontSize:'13px',cursor:'pointer',textDecoration:'none'}}>Scarica</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap'}}>
          
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n)=>(
              <button key={n} onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',cursor:'pointer'}}>{n}</button>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}