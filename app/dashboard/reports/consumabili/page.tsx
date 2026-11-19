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

// Data dell'addebito nel giorno di Roma: data_acquisto della rotta e' il giorno UTC del movimento, e un
// consumabile registrato fra mezzanotte e le 2 finiva nel giorno prima.
const dataIt = (iso: string) => giornoRoma(new Date(iso)).split('-').reverse().join('/')
// jsPDF con i caratteri standard conosce solo la codifica WinAnsi: una freccia (le "Correzione peso/misure
// 8.2kg → 30kg") faceva uscire tutta la cella spaziata lettera per lettera e fuori dalla colonna.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const perPdf = (s: any) => Array.from(String(s ?? '').replace(/→/g, '->')).filter(ch => ch.charCodeAt(0) <= 0xFF || WINANSI_EXTRA.includes(ch)).join('')

export default function ReportConsumabiliPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  // Primo del mese di Roma: new Date(y, m, 1).toISOString() in Italia da' l'ultimo giorno del mese prima.
  const [filtri, setFiltri] = useState({
    clienteId:'',
    dal: giornoRoma().slice(0, 8) + '01',
    al: giornoRoma(),
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/reports/lista?tipo=consumabili').then(r=>r.json()).then(d=>setReports(d||[])).catch(()=>{})
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il report veniva solo scaricato al volo e poi "registrato" con una POST senza allegato:
  // in elenco restava una riga senza file da riscaricare. Ora il file va davvero sul bucket privato.
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'consumabili', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    const lista = await fetch('/api/reports/lista?tipo=consumabili').then(x=>x.json())
    setReports(lista || [])  // un { error } arriva a ReportTable, che lo mostra
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      // Solo i consumabili: la stessa rotta serve la Storia, che mostra anche rettifiche, giacenze e
      // resi. Senza questo il report di MULTI 1-14/10/2026 aveva 695 righe e nessun consumabile.
      params.set('solo', 'consumabile')
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      const res = await fetch(`/api/consumabili?${params}`)
      const movimenti = await res.json().catch(() => null)
      // Un errore non e' "nessun consumabile": prima finiva in un'eccezione muta e il bottone restava fermo.
      if (!res.ok || !Array.isArray(movimenti)) { await dialog.alert({ title: 'Errore', message: movimenti?.error || ('Errore ' + res.status) }); return }
      if (!movimenti.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessun consumabile addebitato nel periodo.' }); return }
      const totale = Math.round(movimenti.reduce((acc:number,m:any)=>acc+Number(m.totale||0),0) * 100) / 100
      const formato = filtri.formato.toLowerCase()
      // Quantita', prezzo unitario e IVA non si conservano: l'addebito salva solo descrizione e totale
      // (IVA compresa). Le colonne "Q.ta 1 / IVA 0%" di prima erano inventate: si mostra l'importo vero.
      if (formato === 'xlsx' || formato === 'csv') {
        const { utils, writeFile, write } = await import('xlsx')
        const rows = movimenti.map((m:any) => ({
          'Data': dataIt(m.created_at),
          'Cliente': m.clienti?.ragione_sociale||'—',
          'Descrizione': m.descrizione,
          'Importo addebitato (€)': Number(m.totale) || 0,
        }))
        const ws = utils.json_to_sheet(rows)
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'Consumabili')
        const nomeFile = `report_consumabili_${filtri.dal}.${formato==='xlsx'?'xlsx':'csv'}`
        writeFile(wb, nomeFile)
        // stesso workbook riscritto in base64: cosi' il file archiviato e' identico a quello scaricato
        const b64 = write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' })
        await salvaReport(b64, nomeFile, formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ compress: true })
        doc.setFontSize(14)
        doc.text(`Report Consumabili — ${filtri.dal.split('-').reverse().join('/')} / ${filtri.al.split('-').reverse().join('/')}`, 14, 15)
        doc.setFontSize(10)
        doc.text(`Totale addebitato: €${totale.toFixed(2)}`, 14, 22)
        autoTable(doc, {
          startY:28,
          head:[['Data','Cliente','Descrizione','Importo €']],
          body: movimenti.map((m:any)=>[
            dataIt(m.created_at),
            perPdf(m.clienti?.ragione_sociale||'—'), perPdf(m.descrizione),
            `€${Number(m.totale).toFixed(2)}`
          ]),
          styles:{fontSize:8}, headStyles:{fillColor:[249,115,22]},
        })
        doc.save(`report_consumabili_${filtri.dal}.pdf`)
        await salvaReport(doc.output('datauristring'), `report_consumabili_${filtri.dal}.pdf`, 'pdf')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report: ' + (e?.message || '') })
    } finally { setGenerating(false) }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Consumabili</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i Clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
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
