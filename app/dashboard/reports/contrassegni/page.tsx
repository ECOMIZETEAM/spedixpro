'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportContrassegniPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [archivioZip, setArchivioZip] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId: '', vettore: '', contratto: '',
    statoSpedizione: '', statoContrassegni: '', periodoRimborso: '',
    dalSpedizione: new Date().toISOString().split('T')[0],
    alSpedizione: new Date().toISOString().split('T')[0],
    dalEsito: new Date(Date.now() - 3*24*60*60*1000).toISOString().split('T')[0],
    alEsito: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=contrassegni').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dalSpedizione||'') + ' alla_data=' + (filtri.alSpedizione||'')
      + (filtri.statoContrassegni ? ' stato=' + filtri.statoContrassegni : '')
    const r = await fetch('/api/reports/salva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'contrassegni', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    })
    const j = await r.json()
    if (!j.success) { alert('Errore salvataggio report: ' + (j.error||'')); return }
    const lista = await fetch('/api/reports/lista?tipo=contrassegni').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.dalSpedizione) params.set('dal', filtri.dalSpedizione)
    if (filtri.alSpedizione) params.set('al', filtri.alSpedizione + 'T23:59:59')
    params.set('contrassegno', 'si')
    const res = await fetch(`/api/spedizioni/lista?${params}`)
    let spedizioni = await res.json()
    // Filtro per stato contrassegno (stessa logica della lista spedizioni)
    if (filtri.statoContrassegni === 'da_pagare') spedizioni = spedizioni.filter((s:any) => Number(s.contrassegno)>0 && s.stato_contrassegno!=='in_distinta' && s.stato_contrassegno!=='pagato')
    else if (filtri.statoContrassegni === 'in_attesa') spedizioni = spedizioni.filter((s:any) => s.stato_contrassegno==='in_distinta')
    else if (filtri.statoContrassegni === 'pagato') spedizioni = spedizioni.filter((s:any) => s.stato_contrassegno==='pagato')
    if (!spedizioni.length) { alert('Nessuna spedizione con contrassegno trovata per i filtri selezionati'); setGenerating(false); return }
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14)
    doc.text(`Report Contrassegni — ${filtri.dalSpedizione} / ${filtri.alSpedizione}`, 14, 15)
    const totContrassegni = spedizioni.reduce((acc: number, s: any) => acc + Number(s.contrassegno||0), 0)
    doc.setFontSize(10)
    doc.text(`Totale contrassegni: €${totContrassegni.toFixed(2)} — ${spedizioni.length} spedizioni`, 14, 22)
    autoTable(doc, {
      startY: 28,
      head: [['N. Spedizione','Cliente','Destinatario','Città','Data','Stato','Contrassegno €','Totale €']],
      body: spedizioni.map((s: any) => [
        s.numero, s.clienti?.ragione_sociale||s.mitt_nome, s.dest_nome,
        `${s.dest_citta} (${s.dest_provincia})`,
        new Date(s.created_at).toLocaleDateString('it-IT'),
        s.stato.replace(/_/g,' '),
        `€${Number(s.contrassegno).toFixed(2)}`,
        `€${Number(s.costo_totale).toFixed(2)}`
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [249, 115, 22] },
    })
    // Non scarico subito: salvo il report nel registro (come Report Spedizioni),
    // il download avviene poi dalla lista tramite il link "Scarica".
    const nomeBase = `report_contrassegni_${filtri.dalSpedizione}_${filtri.alSpedizione}`
    if (archivioZip) {
      const { default: JSZip } = await import('jszip' as any)
      const zip = new JSZip()
      const pdfBytes = doc.output('arraybuffer')
      zip.file('report_contrassegni.pdf', pdfBytes)
      const zipB64 = await zip.generateAsync({ type: 'base64' })
      await salvaReport('data:application/zip;base64,' + zipB64, nomeBase + '.zip', 'zip')
    } else {
      await salvaReport(doc.output('datauristring'), nomeBase + '.pdf', 'pdf')
    }
    setGenerating(false)
  }

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Contrassegni PDF</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti i vettori</option>
              <option value="sda">SDA</option><option value="gls">GLS</option>
              <option value="brt">BRT</option><option value="poste">Poste Italiane</option>
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div><label style={lbl}>Stato spedizione</label>
            <select value={filtri.statoSpedizione} onChange={e=>setF('statoSpedizione',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="consegnata">Consegnata</option>
              <option value="in_lavorazione">In Lavorazione</option>
            </select>
          </div>
          <div><label style={lbl}>Stato Contrassegni</label>
            <select value={filtri.statoContrassegni} onChange={e=>setF('statoContrassegni',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="da_pagare">Da pagare</option>
              <option value="in_attesa">In attesa</option>
              <option value="pagato">Pagato</option>
            </select>
          </div>
          <div><label style={lbl}>Periodo di rimborso</label>
            <select value={filtri.periodoRimborso} onChange={e=>setF('periodoRimborso',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="giornaliero">Giornaliero</option>
              <option value="settimanale">Settimanale</option>
              <option value="mensile">Mensile</option>
            </select>
          </div>
        </div>
        <div style={{marginBottom:'10px'}}>
          <label style={lbl}>Data inserimento Spedizione</label>
          <DateRangePicker dal={filtri.dalSpedizione} al={filtri.alSpedizione} onChange={(dal,al)=>setFiltri(f=>({...f,dalSpedizione:dal,alSpedizione:al}))} />
        </div>
        <div style={{marginBottom:'14px'}}>
          <label style={lbl}>Data esito contrassegno</label>
          <DateRangePicker dal={filtri.dalEsito} al={filtri.alEsito} onChange={(dal,al)=>setFiltri(f=>({...f,dalEsito:dal,alEsito:al}))} />
        </div>
        <div style={{marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}>
          <input type="checkbox" checked={archivioZip} onChange={e=>setArchivioZip(e.target.checked)} id="zip"/>
          <label htmlFor="zip" style={{fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>Archivio ZIP</label>
        </div>
        <button onClick={generaReport} disabled={generating}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'10px'}}>
        <span style={{fontSize:'13px',color:'#1a1a1a'}}>Mostra</span>
        <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'5px',fontSize:'13px',color:'#1a1a1a',background:'#fff'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
        <span style={{fontSize:'13px',color:'#1a1a1a'}}>elementi</span>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead><tr style={{background:'#f9fafb'}}>
            {['ID','Data','Filtri','Formato','Utente','Status','Scarica'].map(h=>(
              <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={7} style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Nessun report generato</td></tr>
            ) : reportsPaginate.map((r:any,i:number)=>(
              <tr key={r.id} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',fontWeight:'600'}}>{reports.length-i}</td>
                <td style={{padding:'9px 14px',fontSize:'12px'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>{String(r.filtri||'').split(' ').map((f:string,idx:number)=><div key={idx}>{f}</div>)}</td>
                <td style={{padding:'9px 14px'}}><span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span></td>
                <td style={{padding:'9px 14px'}}>{r.utente}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontWeight:'500'}}>{r.status}</td>
                <td style={{padding:'9px 14px'}}>{r.file_url
                  ? <a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{color:'#f97316',fontWeight:'600',fontSize:'13px',cursor:'pointer',textDecoration:'none'}}>Scarica</a>
                  : <span style={{color:'#999',fontSize:'13px'}}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap'}}>
          
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n)=>(
              <button key={n} onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',cursor:'pointer'}}>{n}</button>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}