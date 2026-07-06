'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function GiacenzePage() {
  const [giacenze, setGiacenze] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [modal, setModal] = useState<any>(null)
  const [istruzioni, setIstruzioni] = useState('')
  const [elaborando, setElaborando] = useState(false)
  const [esito, setEsito] = useState<any>(null)
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [filtri, setFiltri] = useState({
    clienteId:'', vettore:'', contratto:'',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    stato:''
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
    carica()
  }, [])

  async function carica() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
    if (filtri.stato) params.set('stato', filtri.stato)
    if (filtri.dal) params.set('dal', filtri.dal)
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch(`/api/giacenze?${params}`)
    const data = await res.json()
    setGiacenze(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  const giacenzeFiltrate = cerca
    ? giacenze.filter(g =>
        g.numero?.toLowerCase().includes(cerca.toLowerCase()) ||
        g.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        g.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase())
      )
    : giacenze

  const totalePagine = Math.max(1, Math.ceil(giacenzeFiltrate.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const giacenzePaginate = giacenzeFiltrate.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  function calcolaGiorni(g: any) {
    const data = g.giacenza_data ? new Date(g.giacenza_data) : new Date(g.created_at)
    return Math.max(1, Math.ceil((new Date().getTime() - data.getTime()) / (1000 * 60 * 60 * 24)))
  }

  function calcolaCosto(g: any) {
    const giorni = calcolaGiorni(g)
    const costoG = parseFloat(g.giacenza_costo_giornaliero || 0)
    const costoR = parseFloat(g.giacenza_costo_riconsegna || 0)
    return (costoG * giorni) + costoR
  }

  async function svincola() {
    if (!modal) return
    setElaborando(true)
    const res = await fetch('/api/giacenze', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ spedizioneId: modal.id, istruzioni, azione: 'svincola' })
    })
    const data = await res.json()
    setElaborando(false)
    if (data.success) {
      setEsito(data)
      carica()
    }
  }

  const statoStyle: Record<string,{bg:string,color:string}> = {
    aperta: {bg:'#dc2626',color:'#fff'},
    svincolata: {bg:'#16a34a',color:'#fff'},
    chiusa: {bg:'#6b7280',color:'#fff'},
  }

  return (
    <div>
      <div style={{marginBottom:'16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Lista Giacenze</h1>
      </div>

      {/* Filtri */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>▼ Filtri</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:'10px',marginBottom:'10px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i Clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option><option value="gls">GLS</option>
              <option value="brt">BRT</option><option value="poste">Poste Italiane</option>
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div><label style={lbl}>Data Spedizione:</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              <option value="aperta">Aperta</option>
              <option value="svincolata">Svincolata</option>
              <option value="chiusa">Chiusa</option>
            </select>
          </div>
        </div>
        <button onClick={carica}
          style={{padding:'7px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>
          ▼ Filtra
        </button>
      </div>

      {/* Tabella */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📋 Giacenze <span style={{color:'#1a1a1a',fontWeight:'400',fontSize:'12px'}}>({giacenzeFiltrate.length} risultati)</span></span>
            <span style={{display:'block',marginTop:'4px',fontSize:'12px',fontWeight:'400',color:'#666'}}>
              Mostra{' '}
              <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}}
                style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>{' '}elementi
            </span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'600'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)}
              placeholder="N. spedizione, destinatario..."
              style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'220px',color:'#1a1a1a'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'60px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !giacenzeFiltrate.length ? (
          <div style={{padding:'60px',textAlign:'center' as const,color:'#1a1a1a'}}>
            <div style={{fontSize:'36px',marginBottom:'12px'}}>📦</div>
            <div style={{fontWeight:'500'}}>Nessuna giacenza trovata</div>
          </div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  {['N. Spedizione','Mittente','Contratto','Destinatario','Motivo','Data e Ora','Totale','Contrassegno','Stato','Azioni'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {giacenzePaginate.map(g => {
                  const stSt = statoStyle[g.giacenza_stato||'aperta'] || statoStyle['aperta']
                  const giorni = calcolaGiorni(g)
                  const costo = calcolaCosto(g)
                  return (
                    <tr key={g.id} style={{borderBottom:'1px solid #d1d5db'}}>
                      <td style={{padding:'9px 12px'}}>
                        <a href={`#`} style={{fontWeight:'700',color:'#f97316',fontSize:'13px',textDecoration:'none'}}>{g.numero}</a>
                      </td>
                      <td style={{padding:'9px 12px',fontSize:'12px'}}>
                        <div style={{fontWeight:'500',color:'#1a1a1a'}}>{g.mitt_nome}</div>
                        {g.clienti?.ragione_sociale && <div style={{fontSize:'11px',color:'#1a1a1a'}}>{g.clienti.ragione_sociale}</div>}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{g.corrieri?.nome_contratto||'—'}</td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{color:'#1a1a1a',fontWeight:'500'}}>{g.dest_nome}</div>
                        <div style={{color:'#1a1a1a',fontSize:'11px'}}>{g.dest_citta}</div>
                      </td>
                      <td style={{padding:'9px 12px',color:'#f97316',fontSize:'12px',fontWeight:'500'}}>{g.giacenza_motivo||'INIZIO GIACENZA'}</td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>
                        {new Date(g.created_at).toLocaleDateString('it-IT')} {new Date(g.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>
                        {costo > 0 ? <span style={{color:'#dc2626',fontWeight:'600'}}>€ {costo.toFixed(2)}</span> : '0.00 €'}
                        {giorni > 1 && <div style={{fontSize:'10px',color:'#1a1a1a'}}>{giorni} giorni</div>}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>
                        {Number(g.contrassegno)>0 ? <span style={{background:'#fef9c3',color:'#854d0e',padding:'2px 6px',borderRadius:'4px',fontSize:'11px'}}>€{Number(g.contrassegno).toFixed(2)}</span> : '—'}
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <span style={{background:stSt.bg,color:stSt.color,padding:'3px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600',whiteSpace:'nowrap' as const}}>
                          {g.giacenza_stato==='aperta'?'Aperta - In attesa di istruzioni':g.giacenza_stato==='svincolata'?'Svincolata':'Chiusa'}
                        </span>
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        {g.giacenza_stato!=='chiusa' && (
                          <button onClick={()=>{setModal(g);setIstruzioni('');setEsito(null)}}
                            style={{padding:'4px 10px',background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'4px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                            ✏️ Gestisci
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
            {totalePagine > 0 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
                <span style={{fontSize:'12px',color:'#666'}}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, giacenzeFiltrate.length)} di {giacenzeFiltrate.length}</span>
                <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                  <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
                  {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(
                    <span key={n} style={{display:'flex',alignItems:'center'}}>
                      {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>…</span>}
                      <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
                    </span>
                  ))}
                  <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
                </div>
              </div>
            )}
      </div>

      {/* Modal Gestisci Giacenza */}
      {modal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>{setModal(null);setEsito(null)}}>
          <div style={{background:'#fff',borderRadius:'10px',width:'550px',maxWidth:'95vw',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontWeight:'700',color:'#1a1a1a',fontSize:'15px'}}>Gestisci Giacenza — {modal.numero}</span>
              <button onClick={()=>{setModal(null);setEsito(null)}} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'#1a1a1a'}}>✕</button>
            </div>
            <div style={{padding:'20px'}}>
              {esito ? (
                <div>
                  <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',padding:'16px',marginBottom:'16px',fontSize:'13px',color:'#16a34a',textAlign:'center' as const}}>
                    <div style={{fontSize:'28px',marginBottom:'8px'}}>✅</div>
                    <div style={{fontWeight:'700',marginBottom:'4px'}}>Svincolo effettuato!</div>
                    {esito.costoAddebitato > 0 && (
                      <div style={{color:'#1a1a1a',marginTop:'8px'}}>
                        <strong>Addebito cliente:</strong> € {esito.costoAddebitato.toFixed(2)} ({esito.giorni} giorni giacenza)
                      </div>
                    )}
                  </div>
                  <button onClick={()=>{setModal(null);setEsito(null)}} style={{width:'100%',padding:'10px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
                    Chiudi
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{background:'#f9fafb',borderRadius:'8px',padding:'14px',marginBottom:'16px',border:'1px solid #d1d5db',fontSize:'13px'}}>
                    <div style={{fontWeight:'700',marginBottom:'8px',color:'#1a1a1a'}}>📦 Dettagli Giacenza</div>
                    <div style={{color:'#1a1a1a',lineHeight:1.8}}>
                      <div><strong>Destinatario:</strong> {modal.dest_nome}</div>
                      <div><strong>Indirizzo:</strong> {modal.dest_indirizzo}, {modal.dest_citta} ({modal.dest_provincia})</div>
                      <div><strong>Motivo:</strong> {modal.giacenza_motivo||'INIZIO GIACENZA'}</div>
                      <div><strong>Cliente:</strong> {modal.clienti?.ragione_sociale||'—'}</div>
                      <div><strong>Giorni in giacenza:</strong> {calcolaGiorni(modal)}</div>
                      {calcolaCosto(modal) > 0 && (
                        <div><strong>Costo da addebitare:</strong> <span style={{color:'#dc2626',fontWeight:'700'}}>€ {calcolaCosto(modal).toFixed(2)}</span></div>
                      )}
                    </div>
                  </div>
                  <div style={{marginBottom:'16px'}}>
                    <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Istruzioni per il corriere</label>
                    <textarea value={istruzioni} onChange={e=>setIstruzioni(e.target.value)}
                      rows={3} placeholder="es. Riconsegnare al destinatario, lasciare al vicino, ecc."
                      style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',resize:'vertical' as const,boxSizing:'border-box' as const}}/>
                  </div>
                  <div style={{display:'flex',gap:'10px'}}>
                    <button onClick={svincola} disabled={elaborando}
                      style={{flex:1,padding:'10px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:elaborando?0.7:1}}>
                      {elaborando?'Svincolo in corso...':'✅ Svincola'}
                    </button>
                    <button onClick={async()=>{
                      await fetch('/api/giacenze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spedizioneId:modal.id,azione:'chiudi'})})
                      setModal(null); carica()
                    }} style={{padding:'10px 16px',background:'#f5f5f5',color:'#1a1a1a',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                      Chiudi giacenza
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}