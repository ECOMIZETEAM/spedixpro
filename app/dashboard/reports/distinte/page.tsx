'use client'
import { useState, useEffect } from 'react'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportDistintePage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId: '',
    dal: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato: 'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=distinte').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

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
      writeFile(wb, `report_distinte_${filtri.dal}.${formato==='xlsx'?'xlsx':'csv'}`)
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
      doc.save(`report_distinte_${filtri.dal}.pdf`)
    }
    await fetch('/api/reports/spedizioni', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ formato: filtri.formato, filtri, tipo: 'distinte' })
    })
    const d = await fetch('/api/reports/lista?tipo=distinte').then(r=>r.json())
    setReports(d||[])
    setGenerating(false)
  }

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
          <div><label style={lbl}>Dalla Data</label>
            <input type="date" value={filtri.dal} onChange={e=>setF('dal',e.target.value)} style={{...inp,width:'100%'}}/>
          </div>
          <div><label style={lbl}>Alla Data</label>
            <input type="date" value={filtri.al} onChange={e=>setF('al',e.target.value)} style={{...inp,width:'100%'}}/>
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
            ) : reports.map((r:any,i:number)=>(
              <tr key={r.id} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',fontWeight:'600'}}>{reports.length-i}</td>
                <td style={{padding:'9px 14px',fontSize:'12px'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>{Object.entries(r.filtri||{}).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join(', ')}</td>
                <td style={{padding:'9px 14px'}}><span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span></td>
                <td style={{padding:'9px 14px'}}>{r.utente_nome}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontWeight:'500'}}>{r.stato}</td>
                <td style={{padding:'9px 14px'}}><span style={{color:'#f97316',fontWeight:'600',cursor:'pointer'}} onClick={generaReport}>Scarica</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}