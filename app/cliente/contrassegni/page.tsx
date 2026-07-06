'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
export default function ContrassegniCliente() {
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
    fetch('/api/cliente/contrassegni/lista').then(r=>r.json()).then(d=>{setDistinte(Array.isArray(d)?d:[]);setLoading(false)}).catch(()=>setLoading(false))
  }
  let filtrate = distinte.filter(d => !cerca || String(d.numero||'').toLowerCase().includes(cerca.toLowerCase()))
  if (dal) filtrate = filtrate.filter(d => new Date(d.dataCreazione) >= new Date(dal))
  if (al) filtrate = filtrate.filter(d => new Date(d.dataCreazione) <= new Date(al+'T23:59:59'))
  const totPagine = Math.max(1, Math.ceil(filtrate.length / perPagina))
  const paginaCorr = Math.min(pagina, totPagine)
  const visibili = filtrate.slice((paginaCorr-1)*perPagina, paginaCorr*perPagina)
  async function dettaglio(id:string){ const r = await fetch('/api/cliente/contrassegni/dettaglio?id='+id); return await r.json() }
  async function stampa(id:string, numero:string) {
    setBusy(id+'-pdf')
    try {
      const { distinta, clienteNome, righe } = await dettaglio(id)
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF()
      const dataStr = new Date(distinta.created_at).toLocaleDateString('it-IT')
      doc.setFontSize(15)
      doc.text('Distinta contrassegni N. '+numero+' del '+dataStr, 105, 16, {align:'center'})
      doc.setFontSize(10)
      doc.text('Cliente '+(clienteNome||''), 14, 26)
      autoTable(doc, {
        startY: 32, styles:{fontSize:8,cellPadding:2}, headStyles:{fillColor:[255,255,255],textColor:[0,0,0],fontStyle:'bold',lineWidth:0.1},
        head: [['Spedizioni','Destinatario','Data Spedizione','Contr. iniziale','Contr. rimborsato']],
        body: (righe||[]).map((r:any)=>[
          r.numeroSpedizione||'', (r.destinatario||'')+(r.citta?(' - '+r.citta):''),
          r.dataSpedizione?new Date(r.dataSpedizione).toLocaleDateString('it-IT'):'',
          Number(r.contrIniziale||0).toFixed(2)+' €', Number(r.contrRimborsato||0).toFixed(2)+' €',
        ]),
      })
      const totIniziale = (righe||[]).reduce((a:number,r:any)=>a+(Number(r.contrIniziale)||0),0)
      let y = (doc as any).lastAutoTable.finalY + 10
      doc.setFont('helvetica','bold'); doc.setFontSize(11)
      doc.text('Totale iniziale contrassegni: '+totIniziale.toFixed(2)+' €', 14, y)
      doc.save('distinta_contrassegni_'+numero+'.pdf')
    } catch(e){ alert('Errore stampa PDF') }
    setBusy('')
  }
  async function esporta(id:string, numero:string, tipo:'csv'|'xlsx') {
    setBusy(id+'-'+tipo)
    try {
      const { righe } = await dettaglio(id)
      const { utils, writeFile } = await import('xlsx')
      const rows = (righe||[]).map((r:any)=>({
        Spedizione:r.numeroSpedizione, Destinatario:r.destinatario, Citta:r.citta,
        DataSpedizione:r.dataSpedizione?new Date(r.dataSpedizione).toLocaleDateString('it-IT'):'',
        ContrIniziale:r.contrIniziale, ContrRimborsato:r.contrRimborsato,
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Contrassegni')
      writeFile(wb, 'distinta_contrassegni_'+numero+'.'+tipo)
    } catch(e){ alert('Errore esportazione') }
    setBusy('')
  }
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const th = {textAlign:'left' as const,padding:'10px 12px',fontSize:'11px',fontWeight:'700' as const,color:'#1a1a1a',borderBottom:'1px solid #e8e8e8',whiteSpace:'nowrap' as const}
  const td = {padding:'10px 12px',fontSize:'12px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5',whiteSpace:'nowrap' as const}
  const linkBtn = {border:'none',background:'transparent',color:'#f97316',cursor:'pointer',fontSize:'12px',marginRight:'8px'}
  function badgeStato(s:string){
    const map:Record<string,{bg:string,c:string,t:string}> = {
      pagata:{bg:'#16a34a',c:'#fff',t:'Pagata'}, in_lavorazione:{bg:'#f59e0b',c:'#fff',t:'In lavorazione'}, compensata:{bg:'#e5e7eb',c:'#374151',t:'compensata'},
    }
    return map[s] || {bg:'#e5e7eb',c:'#374151',t:s||''}
  }
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Contrassegni</h1>
      </div>
      <div style={{...card, overflow:'visible'}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Filtri</div>
        <div style={{padding:'16px',display:'flex',gap:'16px',alignItems:'end',flexWrap:'wrap'}}>
          <div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Data distinta</label>
            <DateRangePicker dal={dal} al={al} onChange={(d1,d2)=>{setDal(d1);setAl(d2)}} />
          </div>
        </div>
      </div>
      <div style={card}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Distinte di pagamento contrassegni</span>
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
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna distinta contrassegni disponibile</div>
        ) : (
          <>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={th}>Nr</th><th style={th}>Data creazione</th><th style={th}>Totale contrassegni</th><th style={th}>Metodo pagamento</th><th style={th}>Stato</th><th style={th}>Data pagamento</th><th style={th}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map(d=>{ const st=badgeStato(d.stato); return (
                  <tr key={d.id}>
                    <td style={td}>{d.numero}</td>
                    <td style={td}>{new Date(d.dataCreazione).toLocaleDateString('it-IT')} {new Date(d.dataCreazione).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={td}>€ {Number(d.totale||0).toFixed(2)}</td>
                    <td style={td}>{d.metodoPagamento||''}</td>
                    <td style={td}><span style={{background:st.bg,color:st.c,padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{st.t}</span></td>
                    <td style={td}>{d.dataPagamento?new Date(d.dataPagamento).toLocaleDateString('it-IT'):''}</td>
                    <td style={td}>
                      <button style={linkBtn} onClick={()=>stampa(d.id,d.numero)} disabled={busy===d.id+'-pdf'}>🖨 Stampa</button>
                      <button style={linkBtn} onClick={()=>esporta(d.id,d.numero,'csv')} disabled={busy===d.id+'-csv'}>CSV</button>
                      <button style={linkBtn} onClick={()=>esporta(d.id,d.numero,'xlsx')} disabled={busy===d.id+'-xlsx'}>Excel</button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
          </>
        )}
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'12px',color:'#666'}}>
          <span>Risultati da {(paginaCorr-1)*perPagina+1} a {Math.min(paginaCorr*perPagina, filtrate.length)} di {filtrate.length} elementi</span>
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length: totPagine}, (_,i)=>i+1)
              .filter(n => n===1 || n===totPagine || Math.abs(n-paginaCorr)<=2)
              .map((n,idx,arr)=>(
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