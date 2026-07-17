'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
export default function ListaDistinteCliente() {
  const dialog = useDialog()
  const [distinte, setDistinte] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [busy, setBusy] = useState('')
  const [perPagina, setPerPagina] = useState(10)
  const [pagina, setPagina] = useState(1)
  useEffect(() => { carica() }, [])
  function carica() {
    setLoading(true)
    fetch('/api/cliente/distinte/lista').then(r=>r.json()).then(d=>{setDistinte(Array.isArray(d)?d:[]);setLoading(false)}).catch(()=>setLoading(false))
  }
  const visibili = distinte.filter(d => !cerca || d.numero?.toLowerCase().includes(cerca.toLowerCase()) || (d.contratto||'').toLowerCase().includes(cerca.toLowerCase()))
  const totPagine = Math.max(1, Math.ceil(visibili.length / perPagina))
  const paginaCorr = Math.min(pagina, totPagine)
  const paginate = visibili.slice((paginaCorr-1)*perPagina, paginaCorr*perPagina)
  async function stampa(id:string, numero:string) {
    setBusy(id+'-pdf')
    try {
      const res = await fetch('/api/cliente/distinte/dettaglio?id='+id)
      const { distinta, spedizioni } = await res.json()
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const QRCode = (await import('qrcode')).default
      const doc = new jsPDF()
      const dataStr = new Date(distinta.data||distinta.created_at).toLocaleDateString('it-IT')
      doc.setFontSize(15)
      doc.text('Distinta N. '+numero+' del '+dataStr, 105, 16, {align:'center'})
      autoTable(doc, {
        startY: 26, styles:{fontSize:7,cellPadding:2}, headStyles:{fillColor:[255,255,255],textColor:[0,0,0],fontStyle:'bold',lineWidth:0.1},
        head: [['Spedizioni','Rif. Mittente','Destinatario','Rif.Dest.','Telefono','Peso','PesoVol.','Colli','Contr.','Assicurazione']],
        body: (spedizioni||[]).map((s:any)=>[
          s.numero||'', s.rif_mittente||'',
          [s.dest_nome,s.dest_indirizzo,[s.dest_cap,s.dest_citta,s.dest_provincia].filter(Boolean).join(', ')].filter(Boolean).join(', '),
          s.rif_destinatario||'', s.dest_telefono||'',
          String(s.peso_reale||''), String(s.peso_volume||''), String(s.colli||1),
          Number(s.contrassegno||0).toFixed(2)+' €', Number(s.assicurazione||0).toFixed(2)+' €',
        ]),
      })
      const totSped = (spedizioni||[]).length
      const totColli = (spedizioni||[]).reduce((a:number,s:any)=>a+(Number(s.colli)||0),0)
      const totContr = (spedizioni||[]).reduce((a:number,s:any)=>a+(Number(s.contrassegno)||0),0)
      let y = (doc as any).lastAutoTable.finalY + 10
      doc.setFontSize(10)
      doc.setFont('helvetica','bold')
      doc.text('Totale Spedizioni: '+totSped, 14, y); y+=6
      doc.text('Totale Colli: '+totColli, 14, y); y+=8
      doc.text('Totale Contrassegni: '+totContr.toFixed(2)+' €', 14, y); y+=10
      try {
        const qrUrl = await QRCode.toDataURL('DISTINTA:'+numero)
        doc.addImage(qrUrl, 'PNG', 14, y, 30, 30)
      } catch {}
      doc.save('distinta_'+numero+'.pdf')
    } catch(e) { await dialog.alert({ title: 'Errore', message: 'Errore nella stampa del PDF.' }) }
    setBusy('')
  }
  async function esporta(id:string, numero:string) {
    setBusy(id+'-xlsx')
    try {
      const res = await fetch('/api/cliente/distinte/dettaglio?id='+id)
      const { spedizioni } = await res.json()
      const { utils, writeFile } = await import('xlsx')
      const rows = (spedizioni||[]).map((s:any)=>({
        Spedizione:s.numero, Destinatario:s.dest_nome, Citta:s.dest_citta, CAP:s.dest_cap, Provincia:s.dest_provincia,
        Peso:s.peso_reale, Colli:s.colli, Contrassegno:s.contrassegno,
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Distinta')
      writeFile(wb, 'distinta_'+numero+'.xlsx')
    } catch(e) { await dialog.alert({ title: 'Errore', message: 'Errore nell\'esportazione.' }) }
    setBusy('')
  }
  const th = {textAlign:'left' as const,padding:'10px 12px',fontSize:'11px',fontWeight:'700' as const,color:'#1a1a1a',borderBottom:'1px solid #e8e8e8',whiteSpace:'nowrap' as const}
  const td = {padding:'10px 12px',fontSize:'12px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5',whiteSpace:'nowrap' as const}
  const btn = {padding:'6px 9px',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer',marginRight:'4px'}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Distinte Spedizioni</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Lista Distinte</span>
          <input value={cerca} onChange={e=>setCerca(e.target.value)} placeholder="Cerca..." style={{marginLeft:'auto',padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a'}}/>
        </div>
        <div style={{padding:'10px 16px',fontSize:'12px',color:'#1a1a1a'}}>Mostra{' '}<select value={perPagina} onChange={e=>{setPerPagina(Number(e.target.value));setPagina(1)}} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'5px',color:'#1a1a1a'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select>{' '}elementi</div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna distinta creata</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={th}>Nr</th><th style={th}>Vettore</th><th style={th}>Contratto</th><th style={th}>Data</th>
                  <th style={th}>Spedizioni</th><th style={th}>Colli</th><th style={th}>Contrassegni</th><th style={th}>Peso totale</th><th style={th}>Costo totale</th><th style={th}>Stampa/Esporta/Conferma</th>
                </tr>
              </thead>
              <tbody>
                {paginate.map(d=>(
                  <tr key={d.id}>
                    <td style={{...td}}><span style={{background:'#f97316',color:'#fff',padding:'4px 10px',borderRadius:'6px',fontWeight:'700',fontSize:'12px'}}>{d.numero}</span></td>
                    <td style={td}>{d.vettore}</td>
                    <td style={td}>{d.contratto}</td>
                    <td style={td}>{new Date(d.data).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{d.spedizioni}</td>
                    <td style={td}>{d.colli}</td>
                    <td style={td}>{Number(d.contrassegni||0).toFixed(2)} €</td>
                    <td style={td}>{Number(d.peso||0)} kg</td>
                    <td style={td}>{Number(d.costo||0).toFixed(2)} €</td>
                    <td style={td}>
                      <button onClick={()=>stampa(d.id,d.numero)} disabled={busy===d.id+'-pdf'} title="Stampa PDF" style={{...btn,background:'#6b7280',color:'#fff'}}>{busy===d.id+'-pdf'?'...':'🖨'}</button>
                      <button onClick={()=>esporta(d.id,d.numero)} disabled={busy===d.id+'-xlsx'} title="Esporta Excel" style={{...btn,background:'#e5e7eb',color:'#1a1a1a'}}>{busy===d.id+'-xlsx'?'...':'⬇'}</button>
                      <button title="Conferma" style={{...btn,background:'#06b6d4',color:'#fff'}}>✈</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'12px',color:'#666',borderTop:'1px solid #f0f0f0'}}>
          <span>Risultati da {visibili.length===0?0:(paginaCorr-1)*perPagina+1} a {Math.min(paginaCorr*perPagina, visibili.length)} di {visibili.length} elementi</span>
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length: totPagine}, (_,i)=>i+1).filter(n => n===1 || n===totPagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(
              <span key={n} style={{display:'flex',alignItems:'center'}}>
                {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>…</span>}
                <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
              </span>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(totPagine,p+1))} disabled={paginaCorr>=totPagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totPagine?'default':'pointer',color:paginaCorr>=totPagine?'#ccc':'#1a1a1a'}}>Successivo</button>
          </div>
        </div>
      </div>
    </div>
  )
}