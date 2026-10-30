'use client'
import { useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import DateRangePicker from '@/app/components/DateRangePicker'
import { giornoRoma } from '@/lib/date-roma'

const dataIt = (g: string) => (g || '').slice(0, 10).split('-').reverse().join('/')

// Gli importi sono quelli ADDEBITATI sul credito: la spesa si registra gia' comprensiva dell'IVA,
// quando il master la applica, e l'aliquota non resta scritta. Prima il PDF scriveva "Iva (22%)"
// con accanto 0,00: un'IVA che non c'era. Ora non si scrive nessuna aliquota.
const NOTA_IVA = 'Importi come addebitati sul credito (IVA compresa, se applicata).'

export default function ReportConsumabiliCliente() {
  const dialog = useDialog()
  // Default = oggi, giorno di ROMA (con toISOString() fra mezzanotte e le 2 "oggi" era ieri).
  const [dal, setDal] = useState(giornoRoma())
  const [al, setAl] = useState(giornoRoma())
  const [formato, setFormato] = useState('PDF')
  const [generating, setGenerating] = useState(false)
  async function genera() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (dal) params.set('dal', dal)
      if (al) params.set('al', al)
      const res = await fetch('/api/cliente/reports/consumabili?' + params.toString())
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (j?.error || 'errore ' + res.status) }); return }
      const { righe, master, cliente } = j
      if (!righe || !righe.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessun consumabile trovato nel periodo.' }); return }
      const totale = Math.round(righe.reduce((a: number, r: any) => a + Number(r.importo || 0), 0) * 100) / 100
      const fmt = formato.toLowerCase()
      if (fmt === 'xlsx' || fmt === 'csv') {
        const { utils, writeFile } = await import('xlsx')
        const rows: any[] = righe.map((r:any)=>({
          Data: dataIt(r.data), Tipo: r.tipo, Descrizione: r.descrizione, Importo: r.importo,
        }))
        rows.push({})
        rows.push({ Descrizione: 'TOTALE', Importo: totale })
        rows.push({ Descrizione: NOTA_IVA })
        const ws = utils.json_to_sheet(rows)
        const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Consumabili')
        writeFile(wb, 'report_consumabili_'+dal+'_'+al+'.'+(fmt==='xlsx'?'xlsx':'csv'))
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
        doc.text('( ' + dataIt(dal) + ' - ' + dataIt(al) + ' )', 14, 60)
        doc.setDrawColor(200,200,200); doc.line(14, 68, 196, 68)
        autoTable(doc, {
          startY: 74,
          styles: { fontSize: 9, cellPadding: 2.5, textColor: [80,80,80] },
          headStyles: { fillColor: [255,255,255], textColor: [80,80,80], fontStyle: 'bold', lineWidth: 0 },
          columnStyles: { 3: { halign: 'right' } },
          head: [['Data','Tipo','Descrizione','Importo']],
          body: righe.map((r: any) => [
            dataIt(r.data), r.tipo, r.descrizione, Number(r.importo).toFixed(2)+' €',
          ]),
        })
        let y = (doc as any).lastAutoTable.finalY + 14
        if (y + 20 > doc.internal.pageSize.getHeight()) { doc.addPage(); y = 20 }
        doc.setDrawColor(80,180,80); doc.line(28, y-8, 182, y-8)
        doc.setFontSize(15); doc.setTextColor(60,160,60); doc.setFont('helvetica','bold')
        doc.text('TOTALE', 30, y); doc.text('€ '+totale.toLocaleString('it-IT',{minimumFractionDigits:2}), 100, y)
        doc.setFontSize(8); doc.setTextColor(120,120,120); doc.setFont('helvetica','normal')
        doc.text(NOTA_IVA, 30, y + 8)
        doc.save('report_consumabili_'+dal+'_'+al+'.pdf')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report: ' + (e?.message || e) })
    } finally {
      setGenerating(false)
    }
  }
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const lbl = {fontSize:'12px',fontWeight:'700' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'6px'}
  const inp = {padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Consumabili</h1>
      </div>
      <div style={card}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Nuovo report</div>
        <div style={{padding:'20px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'20px'}}>
          <DateRangePicker dal={dal} al={al} onChange={(d,a)=>{setDal(d);setAl(a)}} />
          <div>
            <label style={lbl}>Formato</label>
            <select value={formato} onChange={e=>setFormato(e.target.value)} style={inp}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel</option>
              <option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <div style={{padding:'0 20px 16px',fontSize:'12px',color:'#888'}}>
          Materiale di consumo e servizi di magazzino addebitati nel periodo. Le rettifiche hanno il loro report; giacenze, resi e correzioni del credito sono nella Lista Movimenti.
        </div>
      </div>
      <button onClick={genera} disabled={generating} style={{padding:'10px 22px',border:'none',borderRadius:'6px',background:'#f97316',color:'#fff',fontSize:'14px',fontWeight:'700',cursor:'pointer',opacity:generating?0.6:1}}>
        {generating ? 'Generazione...' : 'Genera Report'}
      </button>
    </div>
  )
}
