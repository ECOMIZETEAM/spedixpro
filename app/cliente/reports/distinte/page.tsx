'use client'
import { useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import DateRangePicker from '@/app/components/DateRangePicker'
import { giornoRoma } from '@/lib/date-roma'

const dataIt = (g: string) => (g || '').slice(0, 10).split('-').reverse().join('/')
const NOTA_ANNULLATE = 'Le spedizioni annullate sono contate a parte; quelle rimborsate non entrano nel totale.'

export default function ReportDistinteCliente() {
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
      const res = await fetch('/api/cliente/reports/distinte?' + params.toString())
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (j?.error || 'errore ' + res.status) }); return }
      const { distinte, master, cliente } = j
      if (!distinte || !distinte.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna distinta trovata nel periodo.' }); return }
      const totSped = distinte.reduce((a: number, d: any) => a + Number(d.spedizioni || 0), 0)
      const totAnn = distinte.reduce((a: number, d: any) => a + Number(d.annullate || 0), 0)
      const totale = Math.round(distinte.reduce((a: number, d: any) => a + Number(d.totale || 0), 0) * 100) / 100
      const fmt = formato.toLowerCase()
      if (fmt === 'xlsx' || fmt === 'csv') {
        const { utils, writeFile } = await import('xlsx')
        const rows: any[] = distinte.map((d: any) => ({
          'Numero Distinta': d.numero, 'Cliente': cliente.ragione_sociale,
          'Spedizioni': d.spedizioni, 'di cui annullate': d.annullate, 'Totale (€)': Number(d.totale||0).toFixed(2),
          'Data e Ora': new Date(d.data).toLocaleString('it-IT'),
        }))
        rows.push({})
        rows.push({ 'Numero Distinta': 'TOTALE', 'Spedizioni': totSped, 'di cui annullate': totAnn, 'Totale (€)': totale.toFixed(2) })
        if (totAnn) rows.push({ 'Numero Distinta': NOTA_ANNULLATE })
        const ws = utils.json_to_sheet(rows)
        const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Distinte')
        writeFile(wb, 'report_distinte_' + dal + '_' + al + '.' + (fmt==='xlsx'?'xlsx':'csv'))
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ compress: true })
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
          styles: { fontSize: 9, cellPadding: 3, textColor: [80,80,80] },
          headStyles: { fillColor: [255,255,255], textColor: [80,80,80], fontStyle: 'bold', lineWidth: 0 },
          columnStyles: { 0:{cellWidth:32}, 1:{cellWidth:42}, 2:{cellWidth:24}, 3:{cellWidth:24}, 4:{cellWidth:28}, 5:{cellWidth:32} },
          head: [['Numero Distinta','Cliente','Spedizioni','Annullate','Totale','Data e Ora']],
          body: [
            ...distinte.map((d: any) => [
              String(d.numero), cliente.ragione_sociale,
              String(d.spedizioni), String(d.annullate || 0), Number(d.totale||0).toFixed(2) + ' €',
              new Date(d.data).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
            ]),
            [{ content: 'TOTALE', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: String(totSped), styles: { fontStyle: 'bold' } },
              { content: String(totAnn), styles: { fontStyle: 'bold' } }, { content: totale.toFixed(2) + ' €', styles: { fontStyle: 'bold' } }, ''],
          ] as any,
        })
        if (totAnn) {
          let y = (doc as any).lastAutoTable.finalY + 8
          if (y > doc.internal.pageSize.getHeight() - 10) { doc.addPage(); y = 20 }
          doc.setFontSize(8); doc.setTextColor(120,120,120)
          doc.text(NOTA_ANNULLATE, 14, y)
        }
        doc.save('report_distinte_' + dal + '_' + al + '.pdf')
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
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Distinte</h1>
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
      </div>
      <button onClick={genera} disabled={generating} style={{padding:'10px 22px',border:'none',borderRadius:'6px',background:'#f97316',color:'#fff',fontSize:'14px',fontWeight:'700',cursor:'pointer',opacity:generating?0.6:1}}>
        {generating ? 'Generazione...' : 'Genera Report'}
      </button>
    </div>
  )
}
