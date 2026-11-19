'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma } from '@/lib/date-roma'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const th = {textAlign:'left' as const,padding:'8px 10px',fontSize:'11px',fontWeight:700,textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #e5e7eb',whiteSpace:'nowrap' as const}
const td = {padding:'8px 10px',fontSize:'12.5px',color:'#1a1a1a',borderBottom:'1px solid #f1f5f9'}
const fmtE = (n:number)=> '€ ' + Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2, maximumFractionDigits:2})

// Tendina "Tipo". Predefinite le sole ricariche: prima il "Totale accreditato" sommava anche rimborsi di
// annullo, rimesse contrassegni e rettifiche a favore (MULTI 1-14/10/2026: 17.331,68 € di cui ricariche
// 15.887,86), e chi apriva lo Storico Ricariche leggeva come ricaricato quello che non lo era.
const TIPI = [
  { v: 'ricarica', l: 'Solo ricariche', titolo: 'Storico ricariche', totale: 'TOTALE RICARICHE' },
  { v: 'rimborso', l: 'Rimborsi', titolo: 'Rimborsi e storni', totale: 'TOTALE RIMBORSI' },
  { v: 'contrassegno', l: 'Rimesse contrassegni', titolo: 'Rimesse contrassegni', totale: 'TOTALE RIMESSE' },
  { v: 'rettifica', l: 'Rettifiche a favore', titolo: 'Rettifiche a favore', totale: 'TOTALE RETTIFICHE A FAVORE' },
  { v: 'tutti', l: 'Tutti gli accrediti', titolo: 'Storico ricariche e accrediti', totale: 'TOTALE ACCREDITATO' },
]
const tipoDi = (v: string) => TIPI.find(t => t.v === v) || TIPI[0]
// Giorno di Roma dell'istante (new Date(..).toLocaleDateString usa il fuso del PC, non quello italiano).
const dataIt = (iso:string)=> giornoRoma(new Date(iso)).split('-').reverse().join('/')
const giornoIt = (g:string)=> (g||'').slice(0,10).split('-').reverse().join('/')
// jsPDF con i caratteri standard conosce solo la codifica WinAnsi: una freccia (le "Correzione peso/misure
// 8.2kg → 30kg") faceva uscire tutta la cella spaziata lettera per lettera e fuori dalla colonna.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const perPdf = (s: any) => Array.from(String(s ?? '').replace(/→/g, '->')).filter(ch => ch.charCodeAt(0) <= 0xFF || WINANSI_EXTRA.includes(ch)).join('')

export default function ReportRicarichePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [anteprima, setAnteprima] = useState<{righe:any[]; totale:number; totali:any[]; cliente:string; tutti:boolean; tipo:string}|null>(null)
  // Primo del mese e oggi nel calendario di Roma.
  const [filtri, setFiltri] = useState({
    clienteId:'', tipo:'ricarica',
    dal: giornoRoma().slice(0, 8) + '01',
    al: giornoRoma(),
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/reports/lista?tipo=ricariche').then(r=>r.json()).then(d=>setReports(d||[])).catch(()=>{})
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Lancia con il messaggio vero se la rotta risponde con un errore: prima un errore diventava
  // "Nessun accredito nel periodo".
  async function carica() {
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    params.set('tipo', filtri.tipo)
    const res = await fetch('/api/reports/ricariche?' + params.toString())
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j?.error || ('Errore ' + res.status))
    return j
  }

  // Mostra a video senza generare il file: cosi' si controlla prima di scaricare.
  async function vediAnteprima() {
    setGenerating(true)
    try {
      const { righe, totale, totali, cliente, tuttiClienti } = await carica()
      setAnteprima({ righe: righe||[], totale: Number(totale||0), totali: totali||[], cliente: cliente?.ragione_sociale || '', tutti: !!tuttiClienti, tipo: filtri.tipo })
      if (!righe?.length) await dialog.alert({ title:'Nessun risultato', message:'Nessun accredito di questo tipo nel periodo selezionato.' })
    } catch (e: any) { await dialog.alert({ title:'Errore', message: e?.message || 'Errore nel caricamento.' }) }
    finally { setGenerating(false) }
  }

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'') + ' tipo=' + filtri.tipo
    const j = await inviaReport({ tipo:'ricariche', filtri:filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title:'Errore', message:'Errore salvataggio report: ' + (j.error||'') }); return }
    const lista = await fetch('/api/reports/lista?tipo=ricariche').then(x=>x.json())
    setReports(lista || [])  // un { error } arriva a ReportTable, che lo mostra
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const { righe, totale, totali, master, cliente, tuttiClienti } = await carica()
      if (!righe || !righe.length) { await dialog.alert({ title:'Nessun risultato', message:'Nessun accredito di questo tipo nel periodo selezionato.' }); return }
      setAnteprima({ righe, totale: Number(totale||0), totali: totali||[], cliente: cliente?.ragione_sociale||'', tutti: !!tuttiClienti, tipo: filtri.tipo })
      const t = tipoDi(filtri.tipo)
      const fmt = filtri.formato.toLowerCase()

      if (fmt === 'xlsx' || fmt === 'csv') {
        const XLSX = await import('xlsx')
        // Numeri veri, non testo: prima gli importi uscivano come "12.50" e Excel non li sommava.
        const rows = righe.map((r:any)=>({
          Data: dataIt(r.data), Cliente: r.cliente, Tipo: r.tipo,
          Descrizione: r.descrizione, Riferimento: r.riferimento,
          Importo: Number(r.importo) || 0,
          'Saldo dopo': r.saldo_dopo==null ? null : Number(r.saldo_dopo),
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ricariche')
        // Totale per tipo in un foglio a parte (nel CSV, che ha un foglio solo, resta solo l'elenco).
        const tot = [...(totali||[]).map((x:any)=>({ Tipo: x.tipo, Movimenti: x.n, Importo: x.importo })), { Tipo: 'TOTALE', Movimenti: righe.length, Importo: Number(totale||0) }]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tot), 'Totali per tipo')
        const b64 = XLSX.write(wb, { bookType: fmt==='csv'?'csv':'xlsx', type:'base64' })
        await salvaReport(b64, 'storico_ricariche_'+filtri.dal+'.'+(fmt==='xlsx'?'xlsx':'csv'), fmt)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ compress: true })
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
        doc.text(t.titolo, 14, 52)
        doc.setFontSize(11); doc.text(perPdf(cliente?.ragione_sociale), 14, 59)
        doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90)
        doc.text('( ' + giornoIt(filtri.dal) + ' - ' + giornoIt(filtri.al) + ' )', 14, 66)
        doc.setDrawColor(200,200,200); doc.line(14, 72, 196, 72)
        const conCliente = !!tuttiClienti
        autoTable(doc, {
          startY: 78,
          styles: { fontSize: 8, cellPadding: 2, textColor: [80,80,80] },
          headStyles: { fillColor:[255,255,255], textColor:[80,80,80], fontStyle:'bold', lineWidth:0 },
          head: [conCliente ? ['Data','Cliente','Tipo','Descrizione','Importo'] : ['Data','Tipo','Descrizione','Riferimento','Importo']],
          body: righe.map((r:any)=> conCliente
            ? [dataIt(r.data), perPdf(r.cliente), r.tipo, perPdf(r.descrizione).slice(0,52), Number(r.importo).toFixed(2)+' EUR']
            : [dataIt(r.data), r.tipo, perPdf(r.descrizione).slice(0,52), perPdf(r.riferimento).slice(0,22), Number(r.importo).toFixed(2)+' EUR']),
        })
        let fy = (doc as any).lastAutoTable.finalY + 12
        // Con piu' tipi nel file, il totale si spezza tipo per tipo prima della somma.
        if ((totali||[]).length > 1) {
          autoTable(doc, {
            startY: fy - 4,
            styles: { fontSize: 9, cellPadding: 1.5, textColor: [60,60,60] },
            headStyles: { fillColor:[255,255,255], textColor:[60,60,60], fontStyle:'bold', lineWidth:0 },
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
            head: [['Totale per tipo','Movimenti','Importo']],
            body: totali.map((x:any)=>[x.tipo, String(x.n), Number(x.importo).toFixed(2)+' EUR']),
          })
          fy = (doc as any).lastAutoTable.finalY + 12
        }
        doc.setDrawColor(22,163,74); doc.setLineWidth(0.8); doc.line(14, fy-4, 196, fy-4)
        doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(22,163,74)
        doc.text(t.totale, 20, fy+4)
        doc.text('EUR ' + Number(totale||0).toFixed(2), 196, fy+4, { align:'right' })
        const pdfB64 = doc.output('datauristring')
        await salvaReport(pdfB64, 'storico_ricariche_'+filtri.dal+'.pdf', 'pdf')
      }
    } catch (e: any) { await dialog.alert({ title:'Errore', message: e?.message || 'Errore nella generazione del report.' }) }
    finally { setGenerating(false) }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Storico Ricariche e Accrediti</h1>
        <p style={{color:'#666',fontSize:'13px',marginTop:'4px'}}>Le ricariche di credito dei clienti. Dalla tendina Tipo anche gli altri accrediti: rimborsi, rimesse contrassegni e rettifiche a favore.</p>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr 1fr 0.8fr auto auto',gap:'12px',alignItems:'end'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Periodo</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Tipo</label>
            <select value={filtri.tipo} onChange={e=>setF('tipo',e.target.value)} style={sel}>
              {TIPI.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
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
            <span style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a'}}>{anteprima.cliente} · {tipoDi(anteprima.tipo).l} · {anteprima.righe.length} accrediti</span>
            <span style={{fontSize:'15px',fontWeight:800,color:'#15803d'}}>Totale {fmtE(anteprima.totale)}</span>
          </div>
          {anteprima.totali.length > 1 && (
            <div style={{padding:'8px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',gap:'16px',flexWrap:'wrap',fontSize:'12px',color:'#374151'}}>
              {anteprima.totali.map((x:any)=><span key={x.tipo}><b>{x.tipo}</b>: {fmtE(x.importo)} ({x.n})</span>)}
            </div>
          )}
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
                    <td style={{...td,whiteSpace:'nowrap'}}>{dataIt(r.data)}</td>
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
