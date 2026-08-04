'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { inviaReport } from '@/lib/report-client'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportFatturePage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId:'',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=fatture').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il report veniva solo scaricato al volo e "registrato" senza allegare nulla: nell'elenco
  // restava una riga con il tasto Scarica che non puntava a niente. Ora il file viaggia in base64
  // verso /api/reports/salva, che lo mette sul bucket riservato e scrive file_path/file_url.
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'fatture', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    // Qui non c'e' il DialogProvider: l'errore va in console, senza rompere il download gia' avvenuto.
    if (!j.success) { console.error('Errore salvataggio report fatture:', j.error || ''); return }
    const lista = await fetch('/api/reports/lista?tipo=fatture').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text(`Report Fatture — ${filtri.dal} / ${filtri.al}`, 14, 15)
    autoTable(doc, {
      startY:25,
      head:[['Cliente','Periodo','Formato']],
      body:[[filtri.clienteId||'Tutti i Clienti',`${filtri.dal} - ${filtri.al}`,filtri.formato]],
      styles:{fontSize:9}, headStyles:{fillColor:[249,115,22]}
    })
    doc.save(`report_fatture_${filtri.dal}.pdf`)
    // Il file prodotto qui e' sempre un PDF (jsPDF), qualunque sia la voce scelta nel menu Formato:
    // registro quindi 'pdf', altrimenti il bucket salverebbe il PDF con il content-type sbagliato e
    // il download dall'elenco non si aprirebbe.
    const pdfB64 = doc.output('datauristring')
    await salvaReport(pdfB64, `report_fatture_${filtri.dal}.pdf`, 'pdf')
    setGenerating(false)
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Fatture</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
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
              <option value="PDF">PDF</option><option value="XLSX">Excel</option><option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <button onClick={generaReport} disabled={generating} style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
