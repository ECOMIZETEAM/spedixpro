'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

import { useDialog } from '@/app/components/DialogProvider'
export default function ReportRettifichePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId:'', vettore:'',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[]))
    fetch('/api/reports/lista?tipo=rettifiche').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const r = await fetch('/api/reports/salva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'rettifiche', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    })
    const j = await r.json()
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    const lista = await fetch('/api/reports/lista?tipo=rettifiche').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    if (!filtri.clienteId) { await dialog.alert({ title: 'Cliente mancante', message: 'Seleziona un cliente per generare il report rettifiche.' }); return }
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      if (filtri.vettore) params.set('vettore', filtri.vettore)
      const res = await fetch('/api/reports/rettifiche?' + params.toString())
      const { righe, master, cliente } = await res.json()
      if (!righe || !righe.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna rettifica trovata nel periodo.' }); setGenerating(false); return }
      const fmt = filtri.formato.toLowerCase()
      if (fmt === 'xlsx' || fmt === 'csv') {
        const XLSX = await import('xlsx')
        const rows = righe.map((r:any)=>({
          'N. Spedizione':r.numero, 'Peso dichiarato':r.pesoDichiarato, 'Peso/volume dichiarato':r.pesoVolDichiarato,
          'Peso reale':r.pesoReale, 'Peso/volume reale':r.pesoVolReale,
          'Costo iniziale':r.costoIniziale.toFixed(2), 'Costo finale':r.costoFinale.toFixed(2), 'Differenza':r.differenza.toFixed(2),
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rettifiche')
        const b64 = XLSX.write(wb, { bookType: fmt==='csv'?'csv':'xlsx', type: 'base64' })
        await salvaReport(b64, 'report_rettifiche_'+filtri.dal+'.'+(fmt==='xlsx'?'xlsx':'csv'), filtri.formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF()
        if (master?.logo_url) {
          try {
            const img = await fetch(master.logo_url).then(r=>r.blob()).then(b=>new Promise<string>((resolve)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result as string);fr.readAsDataURL(b)}))
            doc.addImage(img, 'PNG', 14, 12, 55, 22)
          } catch {}
        }
        doc.setFontSize(15); doc.setFont('helvetica','bold'); doc.setTextColor(60,60,60)
        doc.text(master?.nome || '', 196, 22, { align: 'right' })
        doc.setFontSize(9); doc.setFont('helvetica','normal')
        const ind = [master?.indirizzo, master?.cap, master?.citta, master?.provincia].filter(Boolean).join(', ')
        let hy = 30
        if (ind) { doc.text(ind, 196, hy, { align: 'right' }); hy += 5 }
        if (master?.email || master?.email_sede) { doc.text('e-mail : ' + (master?.email_sede||master?.email||''), 196, hy, { align: 'right' }); hy += 5 }
        const piva = master?.piva || master?.partita_iva
        if (piva) { doc.text('PIVA ' + piva, 196, hy, { align: 'right' }); hy += 5 }
        doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(40,40,40)
        doc.text(cliente?.ragione_sociale || '', 14, 52)
        doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90)
        doc.text('( ' + new Date(filtri.dal).toLocaleDateString('it-IT') + ' - ' + new Date(filtri.al).toLocaleDateString('it-IT') + ' )', 14, 60)
        doc.setDrawColor(200,200,200); doc.line(14, 68, 196, 68)
        autoTable(doc, {
          startY: 74,
          styles: { fontSize: 8, cellPadding: 2, textColor: [80,80,80] },
          headStyles: { fillColor: [255,255,255], textColor: [80,80,80], fontStyle: 'bold', lineWidth: 0 },
          head: [['N. Spedizione','Peso dich.','Peso/vol dich.','Peso reale','Peso/vol reale','Costo iniziale','Costo finale','Differenza']],
          body: righe.map((r: any) => [
            r.numero,
            r.pesoDichiarato.toFixed(2)+' kg', r.pesoVolDichiarato.toFixed(2)+' kg',
            r.pesoReale.toFixed(2)+' kg', r.pesoVolReale.toFixed(2)+' kg',
            r.costoIniziale.toFixed(2)+' EUR', r.costoFinale.toFixed(2)+' EUR', r.differenza.toFixed(2)+' EUR',
          ]),
        })
        const totDiff = righe.reduce((acc: number, r: any) => acc + Number(r.differenza||0), 0)
        const fy = (doc as any).lastAutoTable.finalY + 12
        doc.setDrawColor(22,163,74); doc.setLineWidth(0.8); doc.line(14, fy - 4, 196, fy - 4)
        doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(22,163,74)
        doc.text('TOTALE', 20, fy + 4)
        doc.text('EUR ' + totDiff.toFixed(2), 196, fy + 4, { align: 'right' })
        const pdfB64 = doc.output('datauristring')
        await salvaReport(pdfB64, 'report_rettifiche_'+filtri.dal+'.pdf', 'PDF')
      }
    } catch(e) { await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report.' }) }
    setGenerating(false)
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Rettifiche</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Seleziona cliente</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {Array.from(new Set(corrieri.map((c:any)=>String(c.nome_contratto||'').split(' ')[0]))).filter(Boolean).map((v:any)=><option key={v} value={v}>{v}</option>)}
            </select>
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