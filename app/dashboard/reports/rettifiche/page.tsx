'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

// 'YYYY-MM-DD' → 'gg/mm/aaaa' senza passare da new Date(), che legge il giorno come mezzanotte UTC.
const dataIt = (g: string) => (g || '').slice(0, 10).split('-').reverse().join('/')
const kg = (n: number | null) => n == null ? '—' : n.toFixed(2) + ' kg'
const eur = (n: number | null) => n == null ? '—' : n.toFixed(2) + ' EUR'
// jsPDF con i caratteri standard conosce solo la codifica WinAnsi: una freccia (le "Correzione peso/misure
// 8.2kg → 30kg") faceva uscire tutta la cella spaziata lettera per lettera e fuori dalla colonna.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const perPdf = (s: any) => Array.from(String(s ?? '').replace(/→/g, '->')).filter(ch => ch.charCodeAt(0) <= 0xFF || WINANSI_EXTRA.includes(ch)).join('')

export default function ReportRettifichePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  // Il periodo e' quello dell'ADDEBITO (data del movimento), non della spedizione: una rettifica arriva
  // giorni dopo (mediana 5,9), e con "oggi-oggi" sulla data spedizione il report non trovava quasi niente.
  // Giorni di Roma: toISOString() dava il giorno UTC, cioe' ieri fra mezzanotte e le 2.
  const [filtri, setFiltri] = useState({
    clienteId:'', vettore:'',
    dal: giornoRoma().slice(0, 8) + '01',
    al: giornoRoma(),
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/reports/lista?tipo=rettifiche').then(r=>r.json()).then(d=>setReports(d||[])).catch(()=>{})
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))
  // Vettore FISICO del contratto: con la prima parola del nome i "Q GLS ..." e i "PF CK ..." di QUICK non
  // erano GLS, e "Poste"/"POSTE" comparivano due volte.
  const vettori = Array.from(new Set(corrieri.map((c:any)=>vettoreFisico({ tipo: c.tipo, nome_contratto: c.nome_contratto })))).filter(Boolean).sort()

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'rettifiche', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    const lista = await fetch('/api/reports/lista?tipo=rettifiche').then(x=>x.json())
    setReports(lista || [])  // un { error } arriva a ReportTable, che lo mostra
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      if (filtri.vettore) params.set('vettore', filtri.vettore)
      const res = await fetch('/api/reports/rettifiche?' + params.toString())
      const j = await res.json().catch(() => ({}))
      // Un errore della lettura non e' "nessuna rettifica": prima il report usciva vuoto e basta.
      if (!res.ok) { await dialog.alert({ title: 'Errore', message: j?.error || ('Errore ' + res.status) }); return }
      const { righe, totale, master, cliente, tuttiClienti } = j
      if (!righe || !righe.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna rettifica addebitata nel periodo.' }); return }
      const conCliente = !!tuttiClienti
      const fmt = filtri.formato.toLowerCase()
      if (fmt === 'xlsx' || fmt === 'csv') {
        const XLSX = await import('xlsx')
        // Numeri veri, non testo: prima i costi uscivano come "12.50" e Excel non li sommava.
        const rows = righe.map((r:any)=>({
          'N. Spedizione': r.numero,
          'Data addebito': dataIt(r.data),
          ...(conCliente ? { 'Cliente': r.cliente } : {}),
          'Vettore': r.vettore,
          'Peso dichiarato (kg)': r.pesoDichiarato, 'Peso/volume dichiarato (kg)': r.pesoVolDichiarato,
          'Peso reale (kg)': r.pesoReale, 'Peso/volume reale (kg)': r.pesoVolReale,
          'Costo iniziale': r.costoIniziale, 'Costo finale': r.costoFinale,
          'Causale': r.causale,
          'Differenza': r.differenza,
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rettifiche')
        const b64 = XLSX.write(wb, { bookType: fmt==='csv'?'csv':'xlsx', type: 'base64' })
        await salvaReport(b64, 'report_rettifiche_'+filtri.dal+'.'+(fmt==='xlsx'?'xlsx':'csv'), fmt)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // Orizzontale: con la causale (e il cliente, se sono tutti) in verticale le colonne non ci stanno.
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ orientation: 'landscape', compress: true })
        const dx = 283
        if (master?.logo_url) {
          try {
            const img = await fetch(master.logo_url).then(r=>r.blob()).then(b=>new Promise<string>((resolve)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result as string);fr.readAsDataURL(b)}))
            doc.addImage(img, 'PNG', 14, 12, 55, 22)
          } catch {}
        }
        doc.setFontSize(15); doc.setFont('helvetica','bold'); doc.setTextColor(60,60,60)
        doc.text(master?.nome || '', dx, 22, { align: 'right' })
        doc.setFontSize(9); doc.setFont('helvetica','normal')
        const ind = [master?.indirizzo, master?.cap, master?.citta, master?.provincia].filter(Boolean).join(', ')
        let hy = 30
        if (ind) { doc.text(ind, dx, hy, { align: 'right' }); hy += 5 }
        if (master?.email || master?.email_sede) { doc.text('e-mail : ' + (master?.email_sede||master?.email||''), dx, hy, { align: 'right' }); hy += 5 }
        const piva = master?.piva || master?.partita_iva
        if (piva) { doc.text('PIVA ' + piva, dx, hy, { align: 'right' }); hy += 5 }
        doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(40,40,40)
        doc.text(perPdf(cliente?.ragione_sociale), 14, 52)
        doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90)
        doc.text('Rettifiche addebitate ( ' + dataIt(filtri.dal) + ' - ' + dataIt(filtri.al) + ' )', 14, 60)
        doc.setDrawColor(200,200,200); doc.line(14, 66, dx, 66)
        autoTable(doc, {
          startY: 72,
          styles: { fontSize: 7.5, cellPadding: 1.8, textColor: [80,80,80] },
          headStyles: { fillColor: [255,255,255], textColor: [80,80,80], fontStyle: 'bold', lineWidth: 0 },
          head: [['N. Spedizione','Data', ...(conCliente ? ['Cliente'] : []), 'Peso dich.','Peso/vol dich.','Peso reale','Peso/vol reale','Costo iniziale','Costo finale','Causale','Differenza']],
          body: righe.map((r: any) => [
            r.numero, dataIt(r.data), ...(conCliente ? [perPdf(r.cliente)] : []),
            kg(r.pesoDichiarato), kg(r.pesoVolDichiarato), kg(r.pesoReale), kg(r.pesoVolReale),
            eur(r.costoIniziale), eur(r.costoFinale), perPdf(r.causale), eur(r.differenza),
          ]),
        })
        const fy = (doc as any).lastAutoTable.finalY + 12
        doc.setDrawColor(22,163,74); doc.setLineWidth(0.8); doc.line(14, fy - 4, dx, fy - 4)
        doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(22,163,74)
        doc.text('TOTALE', 20, fy + 4)
        doc.text('EUR ' + Number(totale || 0).toFixed(2), dx, fy + 4, { align: 'right' })
        const pdfB64 = doc.output('datauristring')
        await salvaReport(pdfB64, 'report_rettifiche_'+filtri.dal+'.pdf', 'pdf')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report: ' + (e?.message || '') })
    } finally { setGenerating(false) }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Rettifiche</h1>
        <p style={{color:'#666',fontSize:'13px',marginTop:'4px'}}>Le rettifiche davvero addebitate (ripesature, supplementi, correzioni di peso), per data dell&apos;addebito. Differenza positiva = addebito, negativa = accredito.</p>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Data addebito</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {vettori.map((v:string)=><option key={v} value={v}>{v}</option>)}
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
