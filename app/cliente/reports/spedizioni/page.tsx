'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

const STATI = ['in_lavorazione','spedita','in_transito','in_consegna','consegnata','in_giacenza','reso_mittente','annullata','non_consegnato']

export default function ReportSpedizioniPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [filtri, setFiltri] = useState({
    clienteId: '', tipoContratto: '', vettore: '', contratto: '',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    agente: '', provincia: '', stato: '', contrassegno: '', formato: 'PDF'
  })

  useEffect(() => {
    caricaReports()
  }, [])

  async function caricaReports() {
    const res = await fetch('/api/cliente/reports/lista?tipo=spedizioni')
    const data = await res.json()
    setReports(Array.isArray(data) ? data : [])
  }

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const _pagReports = reports.slice((paginaCorr-1)*perPage, paginaCorr*perPage)

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const r = await fetch('/api/reports/salva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'spedizioni', filtri: filtriTxt, formato, fileBase64, nomeFile })
    })
    const j = await r.json()
    if (!j.success) { alert('Errore salvataggio report: ' + (j.error||'')); return }
    const lista = await fetch('/api/reports/lista?tipo=spedizioni').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }
  async function generaReport() {
    setGenerating(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.stato) params.set('stato', filtri.stato)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al + 'T23:59:59')
    if (filtri.contrassegno) params.set('contrassegno', filtri.contrassegno)
    if (filtri.provincia) params.set('provincia', filtri.provincia)

    const res = await fetch(`/api/cliente/reports/spedizioni?${params}`)
    const spedizioni = await res.json()

    if (!spedizioni.length) { alert('Nessuna spedizione trovata con i filtri selezionati'); setGenerating(false); return }

    const formato = filtri.formato.toLowerCase()

    if (formato === 'xlsx' || formato === 'csv') {
      const { utils, writeFile } = await import('xlsx')
      const rows = spedizioni.map((s: any) => ({
        'N. Spedizione': s.numero,
        'Cliente': s.clienti?.ragione_sociale || s.mitt_nome,
        'Destinatario': s.dest_nome,
        'Città': s.dest_citta,
        'Provincia': s.dest_provincia,
        'CAP': s.dest_cap,
        'Paese': s.dest_paese,
        'Peso (kg)': s.peso_reale,
        'Colli': s.colli,
        'Contrassegno (€)': s.contrassegno,
        'Assicurazione (€)': s.assicurazione,
        'Data': new Date(s.created_at).toLocaleDateString('it-IT'),
        'Stato': s.stato,
        'Totale (€)': s.costo_totale,
        'Tracking': s.tracking_number,
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Spedizioni')
      const XLSX = await import('xlsx')
      const b64 = XLSX.write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' })
      await salvaReport(b64, 'report_spedizioni_' + filtri.dal + '_' + filtri.al + '.' + (formato === 'xlsx' ? 'xlsx' : 'csv'), formato)
    } else if (formato === 'pdf') {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(14)
      doc.text(`Report Spedizioni — ${filtri.dal} / ${filtri.al}`, 14, 15)
      doc.setFontSize(10)
      doc.text(`Totale: ${spedizioni.length} spedizioni`, 14, 22)
      autoTable(doc, {
        startY: 28,
        head: [['N. Spedizione','Cliente','Destinatario','Città','Peso','Colli','Contrassegno','Data','Stato','Totale €']],
        body: spedizioni.map((s: any) => [
          s.numero, s.clienti?.ragione_sociale||s.mitt_nome, s.dest_nome,
          `${s.dest_citta} (${s.dest_provincia})`, `${s.peso_reale}kg`, s.colli,
          Number(s.contrassegno)>0?`€${s.contrassegno}`:'—',
          new Date(s.created_at).toLocaleDateString('it-IT'),
          s.stato.replace(/_/g,' '), `€${Number(s.costo_totale).toFixed(2)}`
        ]),
        styles: { fontSize: 7 },
        headStyles: { fillColor: [249, 115, 22] },
      })
      // Riepilogo subtotale/IVA/totale
      const subtotale = spedizioni.reduce((acc: number, s: any) => acc + Number(s.costo_totale||0), 0)
      const iva = subtotale * 0.22
      const totale = subtotale + iva
      const finalY = (doc as any).lastAutoTable.finalY + 20
      const pageW = doc.internal.pageSize.getWidth()
      const col1 = pageW - 120
      const col2 = pageW - 20
      // Linea separatore
      doc.setDrawColor(200,200,200)
      doc.line(col1 - 10, finalY - 4, col2, finalY - 4)
      // Subtotale
      doc.setFontSize(9)
      doc.setTextColor(100,100,100)
      doc.setFont('helvetica','normal')
      doc.text('SUBTOTALE', col1, finalY)
      doc.text(`€ ${subtotale.toFixed(2)}`, col2, finalY, {align:'right'})
      // IVA
      doc.text('Iva (22%)', col1, finalY + 10)
      doc.text(`€ ${iva.toFixed(2)}`, col2, finalY + 10, {align:'right'})
      // Linea verde totale
      doc.setDrawColor(34,197,94)
      doc.setLineWidth(0.8)
      doc.line(col1 - 10, finalY + 16, col2, finalY + 16)
      // Totale verde
      doc.setFontSize(11)
      doc.setTextColor(22,163,74)
      doc.setFont('helvetica','bold')
      doc.text('TOTALE', col1, finalY + 24)
      doc.text(`€ ${totale.toFixed(2)}`, col2, finalY + 24, {align:'right'})
      const pdfB64 = doc.output('datauristring')
      await salvaReport(pdfB64, 'report_spedizioni_' + filtri.dal + '_' + filtri.al + '.pdf', 'pdf')
    } else if (formato === 'zip') {
      const { default: JSZip } = await import('jszip' as any)
      const zip = new JSZip()
      const csv = ['N. Spedizione,Cliente,Destinatario,Città,Peso,Colli,Contrassegno,Data,Stato,Totale']
      spedizioni.forEach((s: any) => {
        csv.push(`${s.numero},${s.clienti?.ragione_sociale||s.mitt_nome},${s.dest_nome},${s.dest_citta},${s.peso_reale},${s.colli},${s.contrassegno},${new Date(s.created_at).toLocaleDateString('it-IT')},${s.stato},${s.costo_totale}`)
      })
      zip.file('spedizioni.csv', csv.join('\n'))
      const blob = await zip.generateAsync({type:'blob'})
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `report_spedizioni_${filtri.dal}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }

    // Salva nel registro report
    await fetch('/api/cliente/reports/spedizioni', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ formato: filtri.formato, filtri })
    })
    await caricaReports()
    setGenerating(false)
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Spedizioni PDF</h1>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px',display:'flex',alignItems:'center',gap:'6px'}}>🔍 Nuovo report</div>

        {/* Riga 1 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Tipo Contratto</label>
            <select value={filtri.tipoContratto} onChange={e=>setF('tipoContratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="credito_scalare">Credito a scalare</option>
              <option value="fattura_mensile">Fattura mensile</option>
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option><option value="gls">GLS</option>
              <option value="brt">BRT</option><option value="poste">Poste Italiane</option>
              <option value="dhl">DHL</option>
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
        </div>

        {/* Riga 2 */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Agente</label>
            <select value={filtri.agente} onChange={e=>setF('agente',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div><label style={lbl}>Provincia</label>
            <select value={filtri.provincia} onChange={e=>setF('provincia',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              {['AG','AL','AN','AO','AR','AP','AT','AV','BA','BT','BL','BN','BG','BI','BO','BZ','BS','BR','CA','CL','CB','CE','CT','CZ','CH','CO','CS','CR','KR','CN','EN','FM','FE','FI','FG','FC','FR','GE','GO','GR','IM','IS','SP','AQ','LT','LE','LC','LI','LO','LU','MC','MN','MS','MT','ME','MI','MO','MB','NA','NO','NU','OG','OT','OR','PD','PA','PR','PV','PG','PU','PE','PC','PI','PT','PN','PZ','PO','RG','RA','RC','RE','RI','RN','RO','SA','SS','SV','SI','SR','SO','TA','TE','TR','TO','TP','TN','TV','TS','UD','VA','VE','VB','VC','VR','VV','VI','VT'].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {STATI.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
            </select>
          </div>
        </div>

        {/* Riga 3 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 6fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Contrassegno</label>
            <select value={filtri.contrassegno} onChange={e=>setF('contrassegno',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="si">Con contrassegno</option>
              <option value="no">Senza contrassegno</option>
            </select>
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
              <option value="ZIP">ZIP</option>
            </select>
          </div>
          <div></div>
        </div>

        <button onClick={generaReport} disabled={generating}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'8px',margin:'16px 0 10px'}}>
        <span style={{fontSize:'12.5px',color:'#1a1a1a'}}>Mostra</span>
        <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'6px 8px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
        <span style={{fontSize:'12.5px',color:'#1a1a1a'}}>elementi</span>
      </div>

      {/* Lista report generati */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead>
            <tr style={{background:'#f9fafb'}}>
              {['ID','Data','Filtri','Formato','Utente','Size','Status','Scarica'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={8} style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessun report generato</td></tr>
            ) : _pagReports.map((r:any, ri:number) => { const i = (paginaCorr-1)*perPage + ri; return (
              <tr key={r.id} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'600'}}>{reports.length - i}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>
                  {String(r.filtri||'').split(' ').map((f: string, i: number)=><div key={i}>{f}</div>)}
                </td>
                <td style={{padding:'9px 14px'}}>
                  <span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span>
                </td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'500'}}>{r.utente_nome}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{r.size||'—'}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontSize:'12px',fontWeight:'500'}}>{r.stato}</td>
                <td style={{padding:'9px 14px'}}>
                  <a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{color:'#f97316',fontWeight:'600',fontSize:'13px',cursor:'pointer',textDecoration:'none'}}>Scarica</a>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        {totalePagine > 1 && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'6px',padding:'14px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length:totalePagine},(_, i)=>i+1).filter(n=>n===1||n===totalePagine||Math.abs(n-paginaCorr)<=2).map((n)=>(
              <button key={n} onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',cursor:'pointer'}}>{n}</button>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
          </div>
        )}
      </div>
    </div>
  )
}