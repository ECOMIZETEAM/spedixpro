'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const th = {textAlign:'left' as const,padding:'8px 10px',fontSize:'11px',fontWeight:700,textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #e5e7eb',whiteSpace:'nowrap' as const}
const td = {padding:'8px 10px',fontSize:'12.5px',color:'#1a1a1a',borderBottom:'1px solid #f1f5f9'}
const fmtE = (n:number)=> '€ ' + Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2, maximumFractionDigits:2})

export default function ReportRicarichePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [anteprima, setAnteprima] = useState<{righe:any[]; totale:number; cliente:string; tutti:boolean}|null>(null)
  const [filtri, setFiltri] = useState({
    clienteId:'',
    dal: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString('sv-SE'),
    al: new Date().toLocaleDateString('sv-SE'),
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=ricariche').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  async function carica() {
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch('/api/reports/ricariche?' + params.toString())
    return res.json()
  }

  // Mostra a video senza generare il file: cosi' si controlla prima di scaricare.
  async function vediAnteprima() {
    setGenerating(true)
    try {
      const { righe, totale, cliente, tuttiClienti } = await carica()
      setAnteprima({ righe: righe||[], totale: Number(totale||0), cliente: cliente?.ragione_sociale || '', tutti: !!tuttiClienti })
      if (!righe?.length) await dialog.alert({ title:'Nessun risultato', message:'Nessun accredito nel periodo selezionato.' })
    } catch { await dialog.alert({ title:'Errore', message:'Errore nel caricamento.' }) }
    setGenerating(false)
  }

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo:'ricariche', filtri:filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title:'Errore', message:'Errore salvataggio report: ' + (j.error||'') }); return }
    const lista = await fetch('/api/reports/lista?tipo=ricariche').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const { righe, totale, master, cliente, tuttiClienti } = await carica()
      if (!righe || !righe.length) { await dialog.alert({ title:'Nessun risultato', message:'Nessun accredito nel periodo selezionato.' }); setGenerating(false); return }
      setAnteprima({ righe, totale: Number(totale||0), cliente: cliente?.ragione_sociale||'', tutti: !!tuttiClienti })
      const dataIt = (s:string)=> new Date(s).toLocaleDateString('it-IT')
      const fmt = filtri.formato.toLowerCase()

      if (fmt === 'xlsx' || fmt === 'csv') {
        const XLSX = await import('xlsx')
        const rows = righe.map((r:any)=>({
          Data: dataIt(r.data), Cliente: r.cliente, Tipo: r.tipo,
          Descrizione: r.descrizione, Riferimento: r.riferimento,
          Importo: Number(r.importo).toFixed(2),
          'Saldo dopo': r.saldo_dopo==null ? '' : Number(r.saldo_dopo).toFixed(2),
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ricariche')
        const b64 = XLSX.write(wb, { bookType: fmt==='csv'?'csv':'xlsx', type:'base64' })
        await salvaReport(b64, 'storico_ricariche_'+filtri.dal+'.'+(fmt==='xlsx'?'xlsx':'csv'), filtri.formato)
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
        doc.text(master?.nome || '', 196, 22, { align:'right' })
        doc.setFontSize(9); doc.setFont('helvetica','normal')
        const ind = [master?.indirizzo, master?.cap, master?.citta, master?.provincia].filter(Boolean).join(', ')
        let hy = 30
        if (ind) { doc.text(ind, 196, hy, { align:'right' }); hy += 5 }
        if (master?.email || master?.email_sede) { doc.text('e-mail : ' + (master?.email_sede||master?.email||''), 196, hy, { align:'right' }); hy += 5 }
        const piva = master?.piva || master?.partita_iva
        if (piva) { doc.text('PIVA ' + piva, 196, hy, { align:'right' }); hy += 5 }
        doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(40,40,40)
        doc.text('Storico ricariche e accrediti', 14, 52)
        doc.setFontSize(11); doc.text(cliente?.ragione_sociale || '', 14, 59)
        doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90)
        doc.text('( ' + dataIt(filtri.dal) + ' - ' + dataIt(filtri.al) + ' )', 14, 66)
        doc.setDrawColor(200,200,200); doc.line(14, 72, 196, 72)
        const conCliente = !!tuttiClienti
        autoTable(doc, {
          startY: 78,
          styles: { fontSize: 8, cellPadding: 2, textColor: [80,80,80] },
          headStyles: { fillColor:[255,255,255], textColor:[80,80,80], fontStyle:'bold', lineWidth:0 },
          head: [conCliente ? ['Data','Cliente','Tipo','Descrizione','Importo'] : ['Data','Tipo','Descrizione','Riferimento','Importo']],
          body: righe.map((r:any)=> conCliente
            ? [dataIt(r.data), r.cliente, r.tipo, String(r.descrizione||'').slice(0,52), Number(r.importo).toFixed(2)+' EUR']
            : [dataIt(r.data), r.tipo, String(r.descrizione||'').slice(0,52), String(r.riferimento||'').slice(0,22), Number(r.importo).toFixed(2)+' EUR']),
        })
        const fy = (doc as any).lastAutoTable.finalY + 12
        doc.setDrawColor(22,163,74); doc.setLineWidth(0.8); doc.line(14, fy-4, 196, fy-4)
        doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(22,163,74)
        doc.text('TOTALE ACCREDITATO', 20, fy+4)
        doc.text('EUR ' + Number(totale||0).toFixed(2), 196, fy+4, { align:'right' })
        const pdfB64 = doc.output('datauristring')
        await salvaReport(pdfB64, 'storico_ricariche_'+filtri.dal+'.pdf', 'PDF')
      }
    } catch { await dialog.alert({ title:'Errore', message:'Errore nella generazione del report.' }) }
    setGenerating(false)
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Storico Ricariche e Accrediti</h1>
        <p style={{color:'#666',fontSize:'13px',marginTop:'4px'}}>Tutti i soldi accreditati ai clienti: ricariche, rimborsi, storni, rimesse contrassegni e rettifiche a favore.</p>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr 0.8fr auto auto',gap:'12px',alignItems:'end'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Periodo</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option><option value="XLSX">Excel</option><option value="CSV">CSV</option>
            </select>
          </div>
          <button onClick={vediAnteprima} disabled={generating}
            style={{padding:'9px 18px',background:'#fff',color:'#f97316',border:'1px solid #f97316',borderRadius:'6px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:generating?0.7:1,whiteSpace:'nowrap'}}>
            Vedi a schermo
          </button>
          <button onClick={generaReport} disabled={generating}
            style={{padding:'9px 22px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:generating?0.7:1,whiteSpace:'nowrap'}}>
            {generating?'Attendere…':'Genera Report'}
          </button>
        </div>
      </div>

      {anteprima && anteprima.righe.length > 0 && (
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden',marginBottom:'16px'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px'}}>
            <span style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a'}}>{anteprima.cliente} · {anteprima.righe.length} accrediti</span>
            <span style={{fontSize:'15px',fontWeight:800,color:'#15803d'}}>Totale {fmtE(anteprima.totale)}</span>
          </div>
          <div style={{overflowX:'auto',maxHeight:'460px',overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={th}>Data</th>
                {anteprima.tutti && <th style={th}>Cliente</th>}
                <th style={th}>Tipo</th><th style={th}>Descrizione</th>
                <th style={{...th,textAlign:'right'}}>Importo</th>
                <th style={{...th,textAlign:'right'}}>Saldo dopo</th>
              </tr></thead>
              <tbody>
                {anteprima.righe.map((r:any,i:number)=>(
                  <tr key={i}>
                    <td style={{...td,whiteSpace:'nowrap'}}>{new Date(r.data).toLocaleDateString('it-IT')}</td>
                    {anteprima.tutti && <td style={td}>{r.cliente}</td>}
                    <td style={td}><span style={{background:'#f0fdf4',color:'#15803d',padding:'2px 8px',borderRadius:'999px',fontSize:'11px',fontWeight:700}}>{r.tipo}</span></td>
                    <td style={td}>{r.descrizione}</td>
                    <td style={{...td,textAlign:'right',fontWeight:700,color:'#15803d'}}>{fmtE(r.importo)}</td>
                    <td style={{...td,textAlign:'right',color:'#666'}}>{r.saldo_dopo==null?'—':fmtE(r.saldo_dopo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
