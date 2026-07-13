'use client'
import { useState, useEffect, useRef } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}

export default function DistinteContrassegniPage() {
  const [distinte, setDistinte] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [codFiles, setCodFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [cerca, setCerca] = useState('')
  const [modalPagamento, setModalPagamento] = useState<any>(null)
  const [metodoPagamento, setMetodoPagamento] = useState('')
  const [suddividi, setSuddividi] = useState(false)
  const [righePag, setRighePag] = useState<{metodo:string,importo:string}[]>([{metodo:'',importo:''},{metodo:'',importo:''}])
  const [confermando, setConfermando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [filtri, setFiltri] = useState({
    clienteId:'', stato:'',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    carica()
    fetch('/api/contrassegni/cod-files').then(r=>r.json()).then(d=>setCodFiles(d||[]))
  }, [])

  // ricarica le distinte quando cambiano i filtri
  useEffect(() => { carica() }, [filtri])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.stato) params.set('stato', filtri.stato)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch('/api/contrassegni/distinte?' + params.toString())
    const data = await res.json()
    setDistinte(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { utils, read } = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const righe = utils.sheet_to_json(ws)
      const res = await fetch('/api/contrassegni/upload-cod', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ nomeFile: file.name, righe })
      })
      const data = await res.json()
      if (data.success) {
        alert('File processato! Spedizioni: ' + data.spedizioniProcessate + ' Errori: ' + data.errori)
        fetch('/api/contrassegni/cod-files').then(r=>r.json()).then(d=>setCodFiles(d||[]))
      }
    } catch(err) { alert('Errore caricamento file') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function estraiRighe(d: any) {
    return (d.distinte_contrassegni_righe || []).map((r: any) => ({
      numero: r.numero_spedizione || '',
      mittente: r.spedizioni?.mitt_nome || '',
      destinatario: r.spedizioni?.dest_nome || r.spedizioni?.rif_destinatario || '',
      data: r.spedizioni?.created_at ? new Date(r.spedizioni.created_at).toLocaleDateString('it-IT') : '',
      iniziale: Number(r.importo_cod || 0),
      rimborsato: Number(r.importo_cod || 0),
    }))
  }
  async function stampaPDF(d: any) {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    const righe = estraiRighe(d)
    const dataDist = d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : ''
    doc.setFontSize(15); doc.setFont('helvetica','bold')
    doc.text('Distinta contrassegni N. ' + d.numero + ' del ' + dataDist, 105, 20, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica','normal')
    doc.text('Cliente ' + (d.clienti?.ragione_sociale || ''), 14, 32)
    autoTable(doc, {
      startY: 40,
      head: [['Spedizioni','Rif. Mittente','Destinatario','Data Spedizione','Contr. iniziale','Contr. rimborsato']],
      body: righe.map((r: any) => [r.numero, r.mittente, r.destinatario, r.data, r.iniziale.toFixed(2) + ' €', r.rimborsato.toFixed(2) + ' €']),
      styles: { fontSize: 9 }, headStyles: { fillColor: [255,255,255], textColor: [0,0,0], fontStyle: 'bold' },
    })
    const endY = (doc as any).lastAutoTable.finalY + 12
    doc.setFont('helvetica','bold'); doc.setFontSize(11)
    doc.text('Totale iniziale contrassegni: ' + Number(d.totale_iniziale||0).toFixed(2) + ' €', 14, endY)
    doc.text('Totale contrassegni rimborsati: ' + Number(d.totale_rimborsato||0).toFixed(2) + ' €', 14, endY + 8)
    doc.save('Distinta_contrassegni_' + d.numero + '.pdf')
  }
  async function esportaExcel(d: any) {
    const { utils, writeFile } = await import('xlsx')
    const righe = estraiRighe(d)
    const ws = utils.json_to_sheet(righe.map((r: any) => ({ Spedizioni: r.numero, 'Rif. Mittente': r.mittente, Destinatario: r.destinatario, 'Data Spedizione': r.data, 'Contr. iniziale': r.iniziale, 'Contr. rimborsato': r.rimborsato })))
    const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Distinta ' + d.numero)
    writeFile(wb, 'Distinta_contrassegni_' + d.numero + '.xlsx')
  }
  function chiudiModalPagamento() {
    setModalPagamento(null); setMetodoPagamento(''); setSuddividi(false)
    setRighePag([{metodo:'',importo:''},{metodo:'',importo:''}])
  }
  async function confermaPagamento() {
    const totale = Number(modalPagamento?.totale_iniziale || 0)
    let payload: any
    if (suddividi) {
      const righe = righePag.map(r => ({ metodo: r.metodo, importo: Number(r.importo) }))
        .filter(r => r.metodo && r.importo > 0)
      if (!righe.length) { alert('Inserisci almeno una modalità con importo'); return }
      const somma = Math.round(righe.reduce((s,r)=>s+r.importo,0)*100)/100
      if (Math.abs(somma - totale) > 0.02) { alert(`La somma delle modalità (€${somma.toFixed(2)}) deve corrispondere al totale (€${totale.toFixed(2)})`); return }
      payload = { pagamenti: righe }
    } else {
      if (!metodoPagamento) { alert('Seleziona il tipo di pagamento'); return }
      payload = { metodoPagamento }
    }
    setConfermando(true)
    const res = await fetch('/api/contrassegni/distinte/' + modalPagamento.id, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    setConfermando(false)
    if (data.success) { chiudiModalPagamento(); carica() }
    else alert(data.error || 'Errore durante la conferma')
  }

  const distinteFiltrate = cerca
    ? distinte.filter(d => d.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase()) || String(d.numero).includes(cerca))
    : distinte

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Distinte contrassegni</h1></div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:'16px',marginBottom:'16px'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'12px'}}>Carica il file con i contrassegni ricevuto dal corriere.</div>
          <div style={{fontSize:'12px',color:'#1a1a1a',marginBottom:'6px',fontWeight:'600'}}>Seleziona file: XLS, XLSX, CSV</div>
          <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" onChange={uploadFile} style={{fontSize:'12px',marginBottom:'8px',display:'block',color:'#1a1a1a'}}/>
          <div style={{fontSize:'11px',color:'#1a1a1a',marginBottom:'12px'}}>Il file deve contenere obbligatoriamente 2 colonne: <strong>LDV, ImportoCOD</strong></div>
          <button onClick={()=>fileRef.current?.click()} disabled={uploading}
            style={{padding:'7px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:uploading?0.7:1}}>
            {uploading?'Caricamento...':'Carica file CSV'}
          </button>
        </div>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>File processati</div>
          {!codFiles.length ? (
            <div style={{padding:'20px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessun file caricato</div>
          ) : (
            <div style={{overflowX:'auto' as const, maxHeight:'300px', overflowY:'auto' as const}}>
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'11px'}}>
                <thead><tr style={{background:'#f9fafb'}}>
                  {['File','Data','Righe','Sped.','COD file','COD sist.','COD da pag.','COD dist.','Err.'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'6px 8px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {codFiles.map((f:any)=>(
                    <tr key={f.id} style={{borderBottom:'1px solid #d1d5db'}}>
                      <td style={{padding:'6px 8px',color:'#f97316',fontWeight:'500',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{f.nome_file}</td>
                      <td style={{padding:'6px 8px',color:'#1a1a1a',whiteSpace:'nowrap' as const}}>{new Date(f.created_at).toLocaleString('it-IT')}</td>
                      <td style={{padding:'6px 8px'}}>{f.righe_file}</td>
                      <td style={{padding:'6px 8px'}}>{f.spedizioni_processate}</td>
                      <td style={{padding:'6px 8px'}}>€{Number(f.cod_file).toFixed(2)}</td>
                      <td style={{padding:'6px 8px'}}>€{Number(f.cod_sistema).toFixed(2)}</td>
                      <td style={{padding:'6px 8px'}}><span style={{background:'#fef9c3',color:'#92400e',padding:'2px 6px',borderRadius:'4px',fontWeight:'700'}}>€{Number(f.cod_da_pagare).toFixed(2)}</span></td>
                      <td style={{padding:'6px 8px'}}>€{Number(f.cod_in_distinte).toFixed(2)}</td>
                      <td style={{padding:'6px 8px'}}>{f.errori>0?<span style={{background:'#dc2626',color:'#fff',padding:'2px 5px',borderRadius:'4px',fontWeight:'700'}}>{f.errori}</span>:<span style={{color:'#16a34a',fontWeight:'700'}}>0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>▼ Filtri</div>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr 1fr',gap:'12px',alignItems:'end'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Data distinta</div>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal:string,al:string)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Cliente</div>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Stato distinta</div>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="in_lavorazione">In lavorazione</option>
              <option value="pagata">Pagata</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'14px',fontWeight:'700',color:'#1a1a1a'}}>Distinte contrassegni</span>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',width:'160px',color:'#1a1a1a'}}/>
          </div>
        </div>
        <div style={{padding:'8px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
          <select style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a'}}><option>10</option><option>25</option><option>50</option></select>
          <span style={{fontSize:'12px',color:'#1a1a1a'}}>elementi</span>
        </div>
        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead><tr style={{background:'#f9fafb'}}>
              {['Nr','Cliente','Data creazione','Totale iniziale contr.','Totale contr. rimborsati','Metodo pagamento','Stato','Data pagamento','Azioni'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {!distinteFiltrate.length ? (
                <tr><td colSpan={9} style={{padding:'30px',textAlign:'center' as const,color:'#f97316',fontSize:'13px'}}>Nessun dato disponibile nella tabella</td></tr>
              ) : distinteFiltrate.map((d:any)=>(
                <tr key={d.id} style={{borderBottom:'1px solid #d1d5db'}}>
                  <td style={{padding:'9px 14px',fontWeight:'700',color:'#f97316'}}>{d.numero}</td>
                  <td style={{padding:'9px 14px',color:d.stato==='pagata'?'#f97316':'#1a1a1a',fontWeight:'500'}}>{d.clienti?.ragione_sociale || d.target_master?.nome || '—'}</td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(d.created_at).toLocaleString('it-IT')}</td>
                  <td style={{padding:'9px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(d.totale_iniziale).toFixed(2)}</td>
                  <td style={{padding:'9px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(d.totale_rimborsato).toFixed(2)}</td>
                  <td style={{padding:'9px 14px'}}>
                    {d.metodo_pagamento && <span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{d.metodo_pagamento.toUpperCase()}</span>}
                  </td>
                  <td style={{padding:'9px 14px'}}>
                    <span style={{background:d.stato==='pagata'?'#f0fdf4':'#fffbeb',color:d.stato==='pagata'?'#16a34a':'#d97706',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>
                      {d.stato==='pagata'?'Pagata':'In lavorazione'}
                    </span>
                  </td>
                  <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{d.data_pagamento?new Date(d.data_pagamento).toLocaleDateString('it-IT'):'—'}</td>
                  <td style={{padding:'9px 14px'}}>
                    <div style={{display:'flex',gap:'6px',flexWrap:'wrap' as const}}>
                      {d.stato!=='pagata' && (
                        <button onClick={()=>{setModalPagamento(d);setMetodoPagamento('')}}
                          style={{padding:'4px 10px',background:'#f0fdf4',color:'#15803d',border:'1px solid #86efac',borderRadius:'4px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                          ✓ Pagata
                        </button>
                      )}
                      <button onClick={()=>stampaPDF(d)} style={{padding:'4px 10px',background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'4px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>🖨️ Stampa</button>
                      <button onClick={()=>esportaExcel(d)} style={{padding:'4px 10px',background:'#f0fdf4',color:'#15803d',border:'1px solid #86efac',borderRadius:'4px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>📊 Excel</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{padding:'10px 16px',borderTop:'1px solid #d1d5db',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px',color:'#1a1a1a'}}>
          <span>Risultati da 0 a {distinteFiltrate.length} di {distinteFiltrate.length} elementi</span>
          <div style={{display:'flex',gap:'6px'}}>
            <button style={{padding:'4px 12px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:'pointer'}}>Precedente</button>
            <button style={{padding:'4px 12px',border:'1px solid #d1d5db',borderRadius:'4px',background:'#fff',fontSize:'12px',cursor:'pointer'}}>Successivo</button>
          </div>
        </div>
      </div>

      {modalPagamento && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={chiudiModalPagamento}>
          <div style={{background:'#fff',borderRadius:'8px',width:'420px',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #d1d5db',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:'700',fontSize:'15px',color:'#1a1a1a'}}>Conferma pagamento distinta</span>
              <button onClick={chiudiModalPagamento} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'#1a1a1a'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              <div style={{fontSize:'13px',color:'#1a1a1a',lineHeight:1.9,marginBottom:'16px',background:'#f9fafb',borderRadius:'6px',padding:'12px'}}>
                <div><strong>Distinta N.</strong> {modalPagamento.numero}</div>
                <div><strong>Cliente:</strong> {modalPagamento.clienti?.ragione_sociale}</div>
                <div><strong>Totale:</strong> € {Number(modalPagamento.totale_iniziale).toFixed(4)}</div>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12.5px',color:'#1a1a1a',cursor:'pointer',marginBottom:'12px'}}>
                <input type="checkbox" checked={suddividi} onChange={e=>setSuddividi(e.target.checked)} style={{width:'15px',height:'15px',accentColor:'#f97316'}}/>
                Suddividi il pagamento in più modalità
              </label>

              {!suddividi ? (
                <div style={{marginBottom:'16px'}}>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Tipo pagamento</label>
                  <select value={metodoPagamento} onChange={e=>setMetodoPagamento(e.target.value)}
                    style={{padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',width:'100%',color:'#1a1a1a'}}>
                    <option value="">Seleziona...</option>
                    <option value="contanti">Contanti</option>
                    <option value="assegno">Assegno</option>
                    <option value="sepa">SEPA</option>
                    <option value="compensata">Compensata</option>
                    <option value="bonifico">Bonifico</option>
                  </select>
                </div>
              ) : (
                <div style={{marginBottom:'16px'}}>
                  {righePag.map((r, i) => (
                    <div key={i} style={{display:'flex',gap:'8px',marginBottom:'8px'}}>
                      <select value={r.metodo} onChange={e=>setRighePag(p=>p.map((x,j)=>j===i?{...x,metodo:e.target.value}:x))}
                        style={{padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',flex:1,color:'#1a1a1a'}}>
                        <option value="">Modalità...</option>
                        <option value="contanti">Contanti</option>
                        <option value="assegno">Assegno</option>
                        <option value="sepa">SEPA</option>
                        <option value="compensata">Compensata</option>
                        <option value="bonifico">Bonifico</option>
                      </select>
                      <input type="number" step="0.01" min="0" placeholder="€ importo" value={r.importo}
                        onChange={e=>setRighePag(p=>p.map((x,j)=>j===i?{...x,importo:e.target.value}:x))}
                        style={{padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',width:'110px',color:'#1a1a1a'}}/>
                      {righePag.length > 2 && (
                        <button onClick={()=>setRighePag(p=>p.filter((_,j)=>j!==i))}
                          style={{padding:'0 10px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',fontSize:'14px',cursor:'pointer'}}>✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={()=>setRighePag(p=>[...p,{metodo:'',importo:''}])}
                    style={{background:'none',border:'none',color:'#f97316',fontSize:'12px',fontWeight:'600',cursor:'pointer',padding:'2px 0'}}>+ Aggiungi modalità</button>
                  {(() => {
                    const somma = righePag.reduce((s,r)=>s+(Number(r.importo)||0),0)
                    const tot = Number(modalPagamento.totale_iniziale||0)
                    const resto = Math.round((tot - somma)*100)/100
                    const ok = Math.abs(resto) <= 0.02
                    return (
                      <div style={{marginTop:'8px',fontSize:'12px',fontWeight:'600',color: ok ? '#16a34a' : '#dc2626'}}>
                        Ripartito € {somma.toFixed(2)} / € {tot.toFixed(2)} {ok ? '✓' : `— residuo € ${resto.toFixed(2)}`}
                      </div>
                    )
                  })()}
                </div>
              )}
              <div style={{display:'flex',justifyContent:'space-between',gap:'10px'}}>
                <button onClick={chiudiModalPagamento}
                  style={{padding:'8px 20px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a'}}>
                  Chiudi
                </button>
                <button onClick={confermaPagamento} disabled={confermando}
                  style={{padding:'8px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:confermando?0.7:1}}>
                  {confermando?'Conferma...':'Conferma'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}