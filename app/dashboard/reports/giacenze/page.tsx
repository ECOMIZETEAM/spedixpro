'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportGiacenzePage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    clienteId: '', vettore: '', contratto: '', stato: '', agente: '', formato: 'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[]))
    fetch('/api/staff').then(r=>r.json()).then(d=>setStaff(Array.isArray(d)?d.filter((u:any)=>{const ru=(u.ruolo||'').toLowerCase();return ru!=='cliente'&&ru!=='master'}):[]))
    fetch('/api/reports/lista?tipo=giacenze').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const r = await fetch('/api/reports/salva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'giacenze', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    })
    const j = await r.json()
    if (!j.success) { alert('Errore salvataggio report: ' + (j.error||'')); return }
    const lista = await fetch('/api/reports/lista?tipo=giacenze').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al + 'T23:59:59')
    params.set('stato', 'in_giacenza')

    const res = await fetch(`/api/spedizioni/lista?${params}`)
    let spedizioni = await res.json()
    // Filtro vettore client-side (stessa logica della lista spedizioni)
    if (filtri.vettore) spedizioni = spedizioni.filter((s:any) => String(s.corrieri?.nome_contratto||'').split(' ')[0] === filtri.vettore)
    // Filtro agente: match sul campo agente del cliente (= "Nome Cognome")
    if (filtri.agente) spedizioni = spedizioni.filter((s:any) => (s.clienti?.agente||'') === filtri.agente)

    if (!spedizioni.length) { alert('Nessuna giacenza trovata'); setGenerating(false); return }

    const formato = filtri.formato.toLowerCase()
    if (formato === 'xlsx' || formato === 'csv') {
      const { utils, writeFile } = await import('xlsx')
      const rows = spedizioni.map((s: any) => ({
        'N. Spedizione': s.numero, 'Cliente': s.clienti?.ragione_sociale||s.mitt_nome,
        'Destinatario': s.dest_nome, 'Città': s.dest_citta, 'Provincia': s.dest_provincia,
        'Data': new Date(s.created_at).toLocaleDateString('it-IT'),
        'Stato': s.stato, 'Totale (€)': s.costo_totale,
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Giacenze')
      const XLSX = await import('xlsx'); const b64str = XLSX.write(wb, { bookType: formato==='csv'?'csv':'xlsx', type: 'base64' })
      await salvaReport(b64str, `report_giacenze_${filtri.dal}.${formato==='xlsx'?'xlsx':'csv'}`, formato)
    } else {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(14)
      doc.text(`Report Giacenze — ${filtri.dal} / ${filtri.al}`, 14, 15)
      doc.setFontSize(10)
      doc.text(`Totale: ${spedizioni.length} spedizioni in giacenza`, 14, 22)
      const totGiacenze = spedizioni.reduce((acc: number, s: any) => acc + Number(s.costo_totale||0), 0)
      autoTable(doc, {
        startY: 28,
        head: [['N. Spedizione','Cliente','Destinatario','Città','Provincia','Data','Stato','Totale €']],
        body: spedizioni.map((s: any) => [
          s.numero, s.clienti?.ragione_sociale||s.mitt_nome, s.dest_nome,
          s.dest_citta, s.dest_provincia, new Date(s.created_at).toLocaleDateString('it-IT'),
          s.stato.replace(/_/g,' '), `€${Number(s.costo_totale).toFixed(2)}`
        ]),
        styles: { fontSize: 7 },
        headStyles: { fillColor: [249, 115, 22] },
      })
      const pageH = doc.internal.pageSize.getHeight()
      const pageW = doc.internal.pageSize.getWidth()
      let fy = (doc as any).lastAutoTable.finalY + 16
      if (fy + 12 > pageH - 12) { doc.addPage(); fy = 24 }
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30)
      doc.text('TOTALE', pageW - 80, fy)
      doc.text(`EUR ${totGiacenze.toFixed(2)}`, pageW - 14, fy, {align:'right'})
      const pdfB64 = doc.output('datauristring')
      await salvaReport(pdfB64, `report_giacenze_${filtri.dal}.pdf`, 'pdf')
    }

    setGenerating(false)
  }

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Giacenze</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{marginBottom:'12px'}}>
          <label style={lbl}>Data</label>
          <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {Array.from(new Set(corrieri.map((c:any)=>String(c.nome_contratto||'').split(' ')[0]))).filter(Boolean).map((v:any)=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              <option value="in_giacenza">In Giacenza</option>
            </select>
          </div>
          <div><label style={lbl}>Agente</label>
            <select value={filtri.agente} onChange={e=>setF('agente',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {staff.map((u:any)=>{const nome=[u.nome,u.cognome].filter(Boolean).join(' ');return <option key={u.id} value={nome}>{nome||u.email||u.id}</option>})}
            </select>
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
        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
          <span style={{fontSize:'12px',color:'#666'}}>Mostra</span>
          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
          <span style={{fontSize:'12px',color:'#666'}}>elementi</span>
        </div>
        
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
                <td style={{padding:'9px 14px',fontWeight:'600'}}>{reports.length-i}</td>
                <td style={{padding:'9px 14px',fontSize:'12px'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>{Object.entries(r.filtri||{}).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join(', ')}</td>
                <td style={{padding:'9px 14px'}}><span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span></td>
                <td style={{padding:'9px 14px'}}>{r.utente_nome}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontWeight:'500'}}>{r.stato}</td>
                <td style={{padding:'9px 14px'}}><a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{color:'#f97316',fontWeight:'600',fontSize:'13px',cursor:'pointer',textDecoration:'none'}}>Scarica</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'6px',padding:'12px'}}>
          <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
          {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n)=>(
            <button key={n} onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',cursor:'pointer'}}>{n}</button>
          ))}
          <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
        </div>
      </div>
    </div>
  )
}