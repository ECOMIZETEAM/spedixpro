'use client'
import { useState, useEffect } from 'react'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
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

  async function generaReport() {
    setGenerating(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.dalSpedizione) params.set('dal', filtri.dalSpedizione)
    if (filtri.alSpedizione) params.set('al', filtri.alSpedizione + 'T23:59:59')
    params.set('contrassegno', 'si')
    const res = await fetch(`/api/spedizioni/lista?${params}`)
    const spedizioni = await res.json()
    if (!spedizioni.length) { alert('Nessuna spedizione con contrassegno trovata'); setGenerating(false); return }
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
    if (archivioZip) {
      const { default: JSZip } = await import('jszip' as any)
      const zip = new JSZip()
      const pdfBytes = doc.output('arraybuffer')
      zip.file('report_contrassegni.pdf', pdfBytes)
      const blob = await zip.generateAsync({type:'blob'})
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `report_contrassegni_${filtri.dalSpedizione}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } else {
      doc.save(`report_contrassegni_${filtri.dalSpedizione}.pdf`)
    }
    await fetch('/api/reports/spedizioni', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ formato: archivioZip?'ZIP':'PDF', filtri, tipo: 'contrassegni' })
    })
    const d = await fetch('/api/reports/lista?tipo=contrassegni').then(r=>r.json())
    setReports(d||[])
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
              <option value="pagato">Pagato</option>
              <option value="da_pagare">Da pagare</option>
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
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <input type="date" value={filtri.dalSpedizione} onChange={e=>setF('dalSpedizione',e.target.value)} style={inp}/>
            <span style={{color:'#1a1a1a'}}>—</span>
            <input type="date" value={filtri.alSpedizione} onChange={e=>setF('alSpedizione',e.target.value)} style={inp}/>
          </div>
        </div>
        <div style={{marginBottom:'14px'}}>
          <label style={lbl}>Data esito contrassegno</label>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <input type="date" value={filtri.dalEsito} onChange={e=>setF('dalEsito',e.target.value)} style={inp}/>
            <span style={{color:'#1a1a1a'}}>—</span>
            <input type="date" value={filtri.alEsito} onChange={e=>setF('alEsito',e.target.value)} style={inp}/>
          </div>
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
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>{Object.entries(r.filtri||{}).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join(', ')}</td>
                <td style={{padding:'9px 14px'}}><span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span></td>
                <td style={{padding:'9px 14px'}}>{r.utente_nome}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontWeight:'500'}}>{r.stato}</td>
                <td style={{padding:'9px 14px'}}><span style={{color:'#f97316',fontWeight:'600',cursor:'pointer'}} onClick={generaReport}>Scarica</span></td>
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