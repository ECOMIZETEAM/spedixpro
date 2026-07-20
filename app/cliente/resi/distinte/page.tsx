'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import DateRangePicker from '@/app/components/DateRangePicker'
export default function ResiDistinteCliente() {
  const dialog = useDialog()
  const [distinte, setDistinte] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [busy, setBusy] = useState('')
  const [perPagina, setPerPagina] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [dal, setDal] = useState('')
  const [al, setAl] = useState('')
  useEffect(() => { carica() }, [])
  function carica() {
    setLoading(true)
    fetch('/api/cliente/resi/distinte').then(r=>r.json()).then(d=>{setDistinte(Array.isArray(d)?d:[]);setLoading(false)}).catch(()=>setLoading(false))
  }
  let filtrate = distinte.filter(d => !cerca || String(d.numero||'').toLowerCase().includes(cerca.toLowerCase()))
  if (dal) filtrate = filtrate.filter(d => new Date(d.created_at) >= new Date(dal))
  if (al) filtrate = filtrate.filter(d => new Date(d.created_at) <= new Date(al+'T23:59:59'))
  const totPagine = Math.max(1, Math.ceil(filtrate.length / perPagina))
  const paginaCorr = Math.min(pagina, totPagine)
  const visibili = filtrate.slice((paginaCorr-1)*perPagina, paginaCorr*perPagina)
  function estraiVoci(v:any):any[] {
    if (!v) return []
    if (Array.isArray(v)) return v
    if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p)?p:[] } catch { return [] } }
    return []
  }
  async function stampa(d:any) {
    setBusy(d.id+'-pdf')
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF()
      const dataStr = new Date(d.created_at).toLocaleDateString('it-IT')
      doc.setFontSize(15)
      doc.text('Distinta Reso N. '+d.numero+' del '+dataStr, 105, 16, {align:'center'})
      const voci = estraiVoci(d.voci)
      autoTable(doc, {
        startY: 26, styles:{fontSize:8,cellPadding:2}, headStyles:{fillColor:[255,255,255],textColor:[0,0,0],fontStyle:'bold',lineWidth:0.1},
        head: [['Spedizione','Destinatario']],
        body: voci.length ? voci.map((r:any)=>[
          r.numero || r.numero_spedizione || r.tracking || '',
          r.dest_nome || r.destinatario || r.nome || '',
        ]) : [['—','Nessun dettaglio disponibile']],
      })
      let y = (doc as any).lastAutoTable.finalY + 10
      doc.setFont('helvetica','bold'); doc.setFontSize(11)
      doc.text('Totale LDV: '+(d.totale_ldv||0), 14, y); y+=7
      doc.text('Totale: € '+Number(d.totale||0).toFixed(2), 14, y)
      doc.save('distinta_reso_'+d.numero+'.pdf')
    } catch(e){ await dialog.alert({ title: 'Errore', message: 'Errore nella stampa del PDF.' }) }
    setBusy('')
  }
  async function esporta(d:any) {
    setBusy(d.id+'-xlsx')
    try {
      const { utils, writeFile } = await import('xlsx')
      const voci = estraiVoci(d.voci)
      const rows = voci.length ? voci.map((r:any)=>({
        Spedizione: r.numero || r.numero_spedizione || r.tracking || '',
        Destinatario: r.dest_nome || r.destinatario || r.nome || '',
      })) : [{ Spedizione:'', Destinatario:'' }]
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Reso')
      writeFile(wb, 'distinta_reso_'+d.numero+'.xlsx')
    } catch(e){ await dialog.alert({ title: 'Errore', message: 'Errore nell\'esportazione.' }) }
    setBusy('')
  }
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const th = {textAlign:'left' as const,padding:'10px 12px',fontSize:'11px',fontWeight:'700' as const,color:'#1a1a1a',borderBottom:'1px solid #e8e8e8',whiteSpace:'nowrap' as const}
  const td = {padding:'10px 12px',fontSize:'12px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5',whiteSpace:'nowrap' as const}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Lista Distinte di Reso</h1>
      </div>
      <div style={card}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Filtri</div>
        <div style={{padding:'16px',display:'flex',gap:'16px',alignItems:'end',flexWrap:'wrap'}}>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Data distinte</label>
            <DateRangePicker dal={dal} al={al} onChange={(d, a) => { setDal(d); setAl(a) }} />
          </div>
        </div>
      </div>
      <div style={card}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Lista Distinte di Reso</span>
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#666'}}>Mostra</span>
            <select value={perPagina} onChange={e=>{setPerPagina(Number(e.target.value));setPagina(1)}} style={{padding:'5px 8px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a'}}>
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
            </select>
            <span style={{fontSize:'12px',color:'#666'}}>elementi</span>
            <input value={cerca} onChange={e=>{setCerca(e.target.value);setPagina(1)}} placeholder="Cerca..." style={{marginLeft:'12px',padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a'}}/>
          </div>
        </div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna distinta di reso disponibile</div>
        ) : (
          <>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={th}>Nr</th><th style={th}>Data</th><th style={th}>Totale Ldv</th><th style={th}>Totale</th><th style={th}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map(d=>(
                  <tr key={d.id}>
                    <td style={td}><span style={{background:'#f97316',color:'#fff',padding:'4px 10px',borderRadius:'6px',fontWeight:'700',fontSize:'12px'}}>{d.numero}</span></td>
                    <td style={td}>{new Date(d.created_at).toLocaleDateString('it-IT')} {new Date(d.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={td}>{d.totale_ldv||0}</td>
                    <td style={td}>€ {Number(d.totale||0).toFixed(2)}</td>
                    <td style={td}>
                      <button onClick={()=>stampa(d)} disabled={busy===d.id+'-pdf'} title="Stampa PDF" style={{padding:'6px 10px',border:'none',borderRadius:'6px',background:'#f97316',color:'#fff',cursor:'pointer',marginRight:'6px',fontSize:'12px'}}>{busy===d.id+'-pdf'?'...':'🖨'}</button>
                      <button onClick={()=>esporta(d)} disabled={busy===d.id+'-xlsx'} title="Esporta Excel" style={{padding:'6px 10px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',color:'#1a1a1a',cursor:'pointer',fontSize:'12px'}}>{busy===d.id+'-xlsx'?'...':'⬇'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'12px',color:'#666'}}>
            <span>Risultati da {(paginaCorr-1)*perPagina+1} a {Math.min(paginaCorr*perPagina, filtrate.length)} di {filtrate.length} elementi</span>
            <div style={{display:'flex',gap:'6px'}}>
              <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',cursor:'pointer',fontSize:'12px'}}>Precedente</button>
              <span style={{padding:'5px 12px',background:'#f97316',color:'#fff',borderRadius:'6px'}}>{paginaCorr}</span>
              <button onClick={()=>setPagina(p=>Math.min(totPagine,p+1))} disabled={paginaCorr>=totPagine} style={{padding:'5px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',cursor:'pointer',fontSize:'12px'}}>Successivo</button>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  )
}