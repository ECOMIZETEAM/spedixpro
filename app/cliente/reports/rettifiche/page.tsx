'use client'
import { useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
export default function ReportRettificheCliente() {
  const dialog = useDialog()
  const [dal, setDal] = useState(new Date(Date.now()-30*24*60*60*1000).toISOString().split('T')[0])
  const [al, setAl] = useState(new Date().toISOString().split('T')[0])
  const [vettore, setVettore] = useState('tutti')
  const [formato, setFormato] = useState('PDF')
  const [generating, setGenerating] = useState(false)
  async function genera() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (dal) params.set('dal', dal)
      if (al) params.set('al', al)
      const res = await fetch('/api/cliente/reports/rettifiche?' + params.toString())
      const { righe, master, cliente } = await res.json()
      if (!righe || !righe.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna rettifica trovata nel periodo.' }); setGenerating(false); return }
      const fmt = formato.toLowerCase()
      if (fmt === 'xlsx' || fmt === 'csv') {
        const { utils, writeFile } = await import('xlsx')
        const rows = righe.map((r:any)=>({
          'N. Spedizione':r.numero, 'Peso dichiarato':r.pesoDichiarato, 'Peso/volume dichiarato':r.pesoVolDichiarato,
          'Peso reale':r.pesoReale, 'Peso/volume reale':r.pesoVolReale,
          'Costo iniziale':r.costoIniziale.toFixed(2), 'Costo finale':r.costoFinale.toFixed(2), 'Differenza':r.differenza.toFixed(2),
        }))
        const ws = utils.json_to_sheet(rows)
        const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Rettifiche')
        writeFile(wb, 'report_rettifiche_'+dal+'.'+(fmt==='xlsx'?'xlsx':'csv'))
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF()
        if (master?.logo_url) {
          try {
            const img = await fetch(master.logo_url).then(r=>r.blob()).then(b=>new Promise<string>((res)=>{const fr=new FileReader();fr.onload=()=>res(fr.result as string);fr.readAsDataURL(b)}))
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
        doc.text(cliente.ragione_sociale || '', 14, 52)
        doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90)
        doc.text('( ' + new Date(dal).toLocaleDateString('it-IT') + ' - ' + new Date(al).toLocaleDateString('it-IT') + ' )', 14, 60)
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
            r.costoIniziale.toFixed(2)+' €', r.costoFinale.toFixed(2)+' €', r.differenza.toFixed(2)+' €',
          ]),
        })
        doc.save('report_rettifiche_'+dal+'.pdf')
      }
    } catch(e) { await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report.' }) }
    setGenerating(false)
  }
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const lbl = {fontSize:'12px',fontWeight:'700' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'6px'}
  const inp = {padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Rettifiche</h1>
      </div>
      <div style={card}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Nuovo report</div>
        <div style={{padding:'20px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'20px',alignItems:'end'}}>
          <div style={{gridColumn:'span 1'}}>
            <label style={lbl}>Data (dal)</label>
            <input type="date" value={dal} onChange={e=>setDal(e.target.value)} style={inp}/>
            <label style={{...lbl,marginTop:'8px'}}>al</label>
            <input type="date" value={al} onChange={e=>setAl(e.target.value)} style={inp}/>
          </div>
          <div>
            <label style={lbl}>Vettore</label>
            <select value={vettore} onChange={e=>setVettore(e.target.value)} style={inp}>
              <option value="tutti">Tutti</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Formato</label>
            <select value={formato} onChange={e=>setFormato(e.target.value)} style={inp}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel</option>
              <option value="CSV">CSV</option>
            </select>
          </div>
        </div>
      </div>
      <button onClick={genera} disabled={generating} style={{padding:'10px 22px',border:'none',borderRadius:'6px',background:'#f97316',color:'#fff',fontSize:'14px',fontWeight:'700',cursor:'pointer',opacity:generating?0.6:1}}>
        {generating ? 'Generazione...' : 'Genera Report'}
      </button>
    </div>
  )
}