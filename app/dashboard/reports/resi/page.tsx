'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { giornoRoma } from '@/lib/date-roma'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const giornoIt = (v: any) => v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
const euro = (v: any) => v == null ? '—' : `€${Number(v).toFixed(2)}`

import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
export default function ReportResiPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [erroreStorico, setErroreStorico] = useState('')
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState(() => ({
    clienteId:'',
    dal: giornoRoma(),
    al: giornoRoma(),
    formato:'PDF'
  }))

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    caricaStorico()
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Lo storico dei report: se la rotta risponde con un errore lo si dice, invece di mostrare
  // "Nessun report generato" come se non ce ne fossero.
  async function caricaStorico() {
    const d = await fetch('/api/reports/lista?tipo=resi').then(r=>r.json()).catch((e:any)=>({ error: String(e?.message||e) }))
    setErroreStorico(d && !Array.isArray(d) && d.error ? String(d.error) : '')
    setReports(Array.isArray(d) ? d : [])
  }

  // Prima il file veniva solo scaricato al volo e nell'elenco finiva una riga senza allegato:
  // niente da riscaricare in seguito. Qui il file viene caricato davvero sul bucket privato
  // (via /api/reports/salva, che scrive file_path + link a /api/file).
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'resi', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    await caricaStorico()
  }

  // I RESI ADDEBITATI NEL PERIODO, NON LE SPEDIZIONI CREATE NEL PERIODO E OGGI IN RESO.
  // Prima: stato `reso_mittente` + data della spedizione, e il totale era il nolo. MULTIEXPRESS
  // 1-14/10 vedeva 184 righe contro 532 resi addebitati in quei giorni (364 su spedizioni di settembre
  // o prima; misurato il 15/10). Ora il periodo e' la data dell'addebito del reso e l'importo e'
  // quello addebitato al diretto (cliente, o sotto-master di prima linea): lo calcola
  // /api/reports/resi dai movimenti.
  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      const res = await fetch(`/api/reports/resi?${params}`)
      const resi = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(resi)) {
        await dialog.alert({ title: 'Errore', message: (resi && resi.error) || `I resi non si sono caricati (errore ${res.status}).` })
        return
      }
      if (!resi.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessun reso addebitato nel periodo.' }); return }
      const totResi = Math.round(resi.reduce((acc: number, r: any) => acc + Number(r.importo_reso||0), 0) * 100) / 100
      const cliente = (r: any) => r.cliente || '—'
      const formato = filtri.formato.toLowerCase()
      if (formato === 'xlsx' || formato === 'csv') {
        const { utils, writeFile } = await import('xlsx')
        const rows = resi.map((r:any) => ({
          'N. Spedizione': r.numero, 'Cliente': cliente(r), 'Rete (sotto-master)': r.master_rete || '',
          'Destinatario': r.dest_nome, 'Città': r.dest_citta, 'Provincia': r.dest_provincia,
          'Contratto': r.contratto || '',
          'Data spedizione': giornoIt(r.created_at), 'Data addebito reso': giornoIt(r.data_addebito),
          'Stato spedizione': String(r.stato||'').replace(/_/g,' '),
          'Reso addebitato (€)': r.importo_reso == null ? '' : Number(r.importo_reso),
        }))
        const ws = utils.json_to_sheet(rows)
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'Resi')
        const nomeFile = `report_resi_${filtri.dal}_${filtri.al}.${formato==='xlsx'?'xlsx':'csv'}`
        writeFile(wb, nomeFile)
        // stesso foglio riscritto in base64: e' la copia che finisce nell'archivio
        const XLSX = await import('xlsx')
        const b64 = XLSX.write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' })
        await salvaReport(b64, nomeFile, formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ orientation: 'landscape', compress: true })
        doc.setFontSize(14)
        doc.text(`Report Resi — addebitati dal ${giornoIt(filtri.dal + 'T12:00:00Z')} al ${giornoIt(filtri.al + 'T12:00:00Z')}`, 14, 15)
        doc.setFontSize(9)
        doc.text(`${resi.length} resi. Importo = reso addebitato al tuo cliente diretto o al sotto-master di prima linea.`, 14, 22)
        autoTable(doc, {
          startY: 27,
          head:[['N. Spedizione','Cliente','Destinatario','Città','Contratto','Data spedizione','Addebito reso','Stato','Reso €']],
          body: resi.map((r:any)=>[
            r.numero, cliente(r) + (r.master_rete ? `\nRete: ${r.master_rete}` : ''), r.dest_nome,
            `${r.dest_citta||''}${r.dest_provincia ? ` (${r.dest_provincia})` : ''}`, r.contratto || '—',
            giornoIt(r.created_at), giornoIt(r.data_addebito), String(r.stato||'').replace(/_/g,' '),
            euro(r.importo_reso),
          ]),
          styles:{fontSize:7}, headStyles:{fillColor:[249,115,22]},
        })
        const pageH = doc.internal.pageSize.getHeight()
        const pageW = doc.internal.pageSize.getWidth()
        let fy = (doc as any).lastAutoTable.finalY + 16
        if (fy + 12 > pageH - 12) { doc.addPage(); fy = 24 }
        doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30)
        doc.text('TOTALE ADDEBITATO', pageW - 110, fy)
        doc.text(`EUR ${totResi.toFixed(2)}`, pageW - 14, fy, {align:'right'})
        const nomeFile = `report_resi_${filtri.dal}_${filtri.al}.pdf`
        doc.save(nomeFile)
        await salvaReport(doc.output('datauristring'), nomeFile, 'pdf')
      }
      // La vecchia POST a /api/reports/spedizioni non spediva il file: creava la riga vuota.
      // L'elenco ora lo ricarica salvaReport, una volta sola.
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (e?.message || e) })
    } finally {
      // Il bottone torna cliccabile anche quando qualcosa va storto: prima restava su "Generazione...".
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Resi</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i Clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Data addebito reso</label>
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
      {erroreStorico && <div style={{background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:'6px',padding:'8px 12px',fontSize:'12px',marginBottom:'10px'}}>Storico dei report non caricato: {erroreStorico}</div>}
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
