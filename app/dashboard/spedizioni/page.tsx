'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'3px'}

const STATI: Record<string,{bg:string,color:string,label:string}> = {
  in_lavorazione:{bg:'#fffbeb',color:'#d97706',label:'In Lavorazione'},
  spedita:{bg:'#eff6ff',color:'#2563eb',label:'Spedita'},
  in_transito:{bg:'#f0fdf4',color:'#16a34a',label:'In transito'},
  in_consegna:{bg:'#ecfdf5',color:'#059669',label:'In Consegna'},
  consegnata:{bg:'#f0fdf4',color:'#16a34a',label:'Consegnata'},
  in_giacenza:{bg:'#faf5ff',color:'#7c3aed',label:'In Giacenza'},
  reso_mittente:{bg:'#fef2f2',color:'#dc2626',label:'Reso al mittente'},
  annullata:{bg:'#f5f5f5',color:'#1a1a1a',label:'Annullata'},
  non_consegnato:{bg:'#fef2f2',color:'#dc2626',label:'Non consegnato'},
}

const FILTRI_DEFAULT = {
  clienteId:'', negozio:'', vettore:'', contratto:'', stato:'', id_ordine:'',
  numero:'', dal:'', al:'', contrassegno:'', stato_contrassegni:'',
  assicurazione:'', dest_citta:'', dest_cap:'', contenuto:'', fatturato:'', agente:''
}

export default function SpedizioniPage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [spedizioniFiltrate, setSpedizioniFiltrate] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [trackingModal, setTrackingModal] = useState<any>(null)
  const [trackingData, setTrackingData] = useState<any>(null)
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [trackingTab, setTrackingTab] = useState<'tracking'|'colli'>('tracking')
  const [eliminando, setEliminando] = useState<string|null>(null)
  const [filtri, setFiltri] = useState(FILTRI_DEFAULT)

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[]))
    caricaTutte()
  }, [])

  async function caricaTutte() {
    setLoading(true)
    const res = await fetch('/api/spedizioni/lista')
    const data = await res.json()
    setSpedizioni(Array.isArray(data) ? data : [])
    setSpedizioniFiltrate(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  function applicaFiltri() {
    let filtered = [...spedizioni]
    if (filtri.clienteId) filtered = filtered.filter(s => s.cliente_id === filtri.clienteId)
    if (filtri.stato) filtered = filtered.filter(s => s.stato === filtri.stato)
    if (filtri.contratto) filtered = filtered.filter(s => s.corriere_id === filtri.contratto)
    if (filtri.vettore) filtered = filtered.filter(s => String(s.corrieri?.nome_contratto||'').split(' ')[0] === filtri.vettore)
    if (filtri.numero) filtered = filtered.filter(s => s.numero?.toLowerCase().includes(filtri.numero.toLowerCase()))
    if (filtri.id_ordine) filtered = filtered.filter(s => (s.note||'').toLowerCase().includes(filtri.id_ordine.toLowerCase()))
    if (filtri.dal) filtered = filtered.filter(s => new Date(s.created_at) >= new Date(filtri.dal))
    if (filtri.al) filtered = filtered.filter(s => new Date(s.created_at) <= new Date(filtri.al+'T23:59:59'))
    if (filtri.contrassegno==='si') filtered = filtered.filter(s => Number(s.contrassegno)>0)
    if (filtri.contrassegno==='no') filtered = filtered.filter(s => Number(s.contrassegno)===0)
    if (filtri.dest_citta) filtered = filtered.filter(s => s.dest_citta?.toLowerCase().includes(filtri.dest_citta.toLowerCase()))
    if (filtri.dest_cap) filtered = filtered.filter(s => s.dest_cap?.includes(filtri.dest_cap))
    if (filtri.contenuto) filtered = filtered.filter(s => s.contenuto?.toLowerCase().includes(filtri.contenuto.toLowerCase()))
    setSpedizioniFiltrate(filtered)
  }

  const spedizioniVisibili = cerca
    ? spedizioniFiltrate.filter(s =>
        s.numero?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.tracking_number?.toLowerCase().includes(cerca.toLowerCase())
      )
    : spedizioniFiltrate

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])
  }

  function toggleAll() {
    if (selectedIds.length===spedizioniVisibili.length) setSelectedIds([])
    else setSelectedIds(spedizioniVisibili.map(s=>s.id))
  }

    async function stampaSelezionati() {
    if (!selectedIds.length) return
    const res = await fetch('/api/spedizioni/etichette-bulk', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ ids: selectedIds })
    })
    if (!res.ok) { alert('Errore generazione PDF'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `etichette_${selectedIds.length}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
async function apriTracking(s: any) {
    setTrackingModal(s); setTrackingData(null); setTrackingLoading(true); setTrackingTab('tracking')
    const res = await fetch(`/api/spedizioni/tracking?id=${s.id}`)
    const data = await res.json()
    setTrackingData(data); setTrackingLoading(false)
  }

  async function elimina(id: string, numero: string) {
    if (!confirm(`Eliminare la spedizione ${numero}?`)) return
    setEliminando(id)
    await fetch(`/api/spedizioni/elimina?id=${id}`, { method: 'DELETE' })
    setEliminando(null)
    caricaTutte()
  }

  const btnFiltri = {padding:'7px 18px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700' as const,cursor:'pointer',whiteSpace:'nowrap' as const}

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Lista Spedizioni</h1>
        <a href="/dashboard/spedizioni/nuova" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuova Spedizione</a>
      </div>

      {/* FILTRI */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontWeight:'700',color:'#1a1a1a',marginBottom:'10px',fontSize:'12px'}}>▼ Filtri</div>

        {/* Riga 1 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:'8px',marginBottom:'8px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Negozio</label>
            <select value={filtri.negozio} onChange={e=>setF('negozio',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {Array.from(new Set(corrieri.map((c:any)=>String(c.nome_contratto||'').split(' ')[0]))).filter(Boolean).map((v:any)=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {corrieri.filter((c:any)=>!filtri.vettore || String(c.nome_contratto||'').split(' ')[0]===filtri.vettore).map((c:any)=><option key={c.id} value={c.id}>{c.nome_contratto}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {Object.entries(STATI).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div><label style={lbl}>ID Ordine</label>
            <input value={filtri.id_ordine} onChange={e=>setF('id_ordine',e.target.value)} style={inp}/>
          </div>
        </div>

        {/* Riga 2 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr 1fr',gap:'8px',marginBottom:'8px'}}>
          <div><label style={lbl}>N. Spedizione</label>
            <input value={filtri.numero} onChange={e=>setF('numero',e.target.value)} style={inp}/>
          </div>
          <div><label style={lbl}>Data Spedizione:</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Contrassegno:</label>
            <select value={filtri.contrassegno} onChange={e=>setF('contrassegno',e.target.value)} style={sel}>
              <option value="">Qualsiasi</option>
              <option value="si">Con contrassegno</option>
              <option value="no">Senza</option>
            </select>
          </div>
          <div><label style={lbl}>Stato Contrassegni:</label>
            <select value={filtri.stato_contrassegni} onChange={e=>setF('stato_contrassegni',e.target.value)} style={sel}>
              <option value="">Qualsiasi</option>
              <option value="pagato">Pagato</option>
              <option value="da_pagare">Da pagare</option>
            </select>
          </div>
          <div><label style={lbl}>Assicurazione:</label>
            <select value={filtri.assicurazione} onChange={e=>setF('assicurazione',e.target.value)} style={sel}>
              <option value="">Qualsiasi</option>
              <option value="si">Con assicurazione</option>
              <option value="no">Senza</option>
            </select>
          </div>
        </div>

        {/* Riga 3 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr auto',gap:'8px',alignItems:'end'}}>
          <div><label style={lbl}>Città</label>
            <input value={filtri.dest_citta} onChange={e=>setF('dest_citta',e.target.value)} style={inp}/>
          </div>
          <div><label style={lbl}>CAP</label>
            <input value={filtri.dest_cap} onChange={e=>setF('dest_cap',e.target.value)} style={inp}/>
          </div>
          <div><label style={lbl}>Contenuto</label>
            <input value={filtri.contenuto} onChange={e=>setF('contenuto',e.target.value)} style={inp}/>
          </div>
          <div><label style={lbl}>Fatturato:</label>
            <select value={filtri.fatturato} onChange={e=>setF('fatturato',e.target.value)} style={sel}>
              <option value="">Qualsiasi</option>
              <option value="si">Fatturato</option>
              <option value="no">Non fatturato</option>
            </select>
          </div>
          <div><label style={lbl}>Agente</label>
            <select value={filtri.agente} onChange={e=>setF('agente',e.target.value)} style={sel}>
              <option value="">Tutti</option>
            </select>
          </div>
          <div>
            <button onClick={applicaFiltri} style={btnFiltri}>▼ Filtra</button>
          </div>
        </div>
      </div>

      {/* TABELLA */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📋 Spedizioni <span style={{color:'#1a1a1a',fontWeight:'400',fontSize:'12px'}}>({spedizioniVisibili.length} risultati)</span></span>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <button onClick={stampaSelezionati} disabled={selectedIds.length===0}
              style={{padding:'6px 14px',background:selectedIds.length>0?'#f97316':'#e5e7eb',color:selectedIds.length>0?'#fff':'#9ca3af',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
              🖨️ Stampa Selezionati{selectedIds.length>0?` (${selectedIds.length})`:''}
            </button>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'600'}}>Cerca:</span>
              <input value={cerca} onChange={e=>setCerca(e.target.value)}
                placeholder="N. spedizione o destinatario..."
                style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'220px',color:'#1a1a1a',background:'#fff'}}/>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'60px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !spedizioniVisibili.length ? (
          <div style={{padding:'60px',textAlign:'center' as const,color:'#1a1a1a'}}>
            <div style={{fontSize:'36px',marginBottom:'12px'}}>📦</div>
            <div style={{fontWeight:'500'}}>Nessuna spedizione trovata</div>
          </div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  <th style={{padding:'9px 12px',borderBottom:'1px solid #d1d5db',width:'36px'}}>
                    <input type="checkbox" checked={selectedIds.length===spedizioniVisibili.length&&spedizioniVisibili.length>0} onChange={toggleAll}/>
                  </th>
                  {['N. Spedizione','Cliente','Destinatario','Peso','Colli','Contrassegno','Data e Ora','Stato','ID Ordine','Totale','Distinta N.','Azioni'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,letterSpacing:'0.4px',color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spedizioniVisibili.map(s => {
                  const st = STATI[s.stato] || STATI['annullata']
                  const isSelected = selectedIds.includes(s.id)
                  return (
                    <tr key={s.id} style={{borderBottom:'1px solid #d1d5db',background:isSelected?'#fff7ed':'#fff'}}>
                      <td style={{padding:'9px 12px'}}>
                        <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(s.id)}/>
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <button onClick={()=>apriTracking(s)} style={{fontWeight:'700',color:'#f97316',background:'none',border:'none',cursor:'pointer',fontSize:'13px',padding:0,textDecoration:'underline'}}>
                          {s.numero}
                        </button>
                      </td>
                      <td style={{padding:'9px 12px',fontSize:'12px'}}>
                        <div style={{fontWeight:'500',color:'#1a1a1a'}}>{s.mitt_nome}</div>
                        {s.clienti?.ragione_sociale&&<div style={{fontSize:'11px',color:'#1a1a1a'}}>{s.clienti.ragione_sociale}</div>}
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{color:'#1a1a1a',fontWeight:'500'}}>{s.dest_nome}</div>
                        <div style={{color:'#1a1a1a',fontSize:'11px'}}>{s.dest_citta}, {s.dest_provincia}({s.dest_cap}), {s.dest_paese}</div>
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.peso_reale}kg</td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.colli}</td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a'}}>
                        {Number(s.contrassegno)>0
                          ? <span style={{background:'#fef9c3',color:'#854d0e',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>€{Number(s.contrassegno).toFixed(2)}</span>
                          : '—'}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>
                        {new Date(s.created_at).toLocaleDateString('it-IT')} {new Date(s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <span style={{background:st.bg,color:st.color,padding:'3px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600',whiteSpace:'nowrap' as const}}>{st.label}</span>
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.note||'—'}</td>
                      <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>
                        € {Number(s.costo_totale||0).toFixed(2)}
                        {Number(s.contrassegno)>0&&<span style={{color:'#dc2626',fontSize:'10px',marginLeft:'3px'}}>R</span>}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>—</td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{display:'flex',gap:'4px'}}>
                          <a href={`/dashboard/spedizioni/${s.id}/etichetta`} style={{padding:'4px 8px',background:'#eff6ff',color:'#1d4ed8',borderRadius:'4px',fontSize:'14px',textDecoration:'none',border:'1px solid #bfdbfe'}} title="Etichetta">🖨️</a>
                  
                          <button onClick={()=>elimina(s.id,s.numero)} disabled={eliminando===s.id}
                            style={{padding:'4px 8px',background:'#fef2f2',color:'#dc2626',borderRadius:'4px',fontSize:'14px',border:'1px solid #fecaca',cursor:'pointer',opacity:eliminando===s.id?0.5:1}} title="Elimina">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL TRACKING */}
      {trackingModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={()=>{setTrackingModal(null);setTrackingData(null)}}>
          <div style={{background:'#fff',borderRadius:'10px',width:'750px',maxWidth:'95vw',maxHeight:'88vh',overflow:'hidden',display:'flex',flexDirection:'column' as const}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <span style={{fontWeight:'700',color:'#1a1a1a',fontSize:'15px'}}>{trackingData?.corriere||'...'} — {trackingModal.numero}</span>
                {(()=>{const st=STATI[trackingModal.stato];return st?<span style={{background:st.bg,color:st.color,padding:'3px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'600'}}>{st.label}</span>:null})()}
              </div>
              <button onClick={()=>{setTrackingModal(null);setTrackingData(null)}} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'#1a1a1a'}}>✕</button>
            </div>
            <div style={{display:'flex',borderBottom:'1px solid #d1d5db',padding:'0 20px'}}>
              <button onClick={()=>setTrackingTab('tracking')} style={{padding:'10px 16px',background:'none',border:'none',cursor:'pointer',fontSize:'13px',fontWeight:trackingTab==='tracking'?'700':'400',color:trackingTab==='tracking'?'#f97316':'#666',borderBottom:trackingTab==='tracking'?'2px solid #f97316':'2px solid transparent'}}>Tracking</button>
              <button onClick={()=>setTrackingTab('colli')} style={{padding:'10px 16px',background:'none',border:'none',cursor:'pointer',fontSize:'13px',fontWeight:trackingTab==='colli'?'700':'400',color:trackingTab==='colli'?'#f97316':'#666',borderBottom:trackingTab==='colli'?'2px solid #f97316':'2px solid transparent'}}>Colli</button>
            </div>
            <div style={{overflowY:'auto',flex:1,padding:'16px 20px'}}>
              {trackingTab==='tracking'&&(
                <>
                  <div style={{background:'#f9fafb',borderRadius:'8px',padding:'14px',marginBottom:'16px',border:'1px solid #d1d5db',fontSize:'13px'}}>
                    <div style={{fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>👤 Destinatario</div>
                    <div style={{lineHeight:1.8,color:'#1a1a1a'}}>
                      <div><strong>Nominativo:</strong> {trackingModal.dest_nome}</div>
                      <div><strong>Indirizzo:</strong> {trackingModal.dest_indirizzo}, {trackingModal.dest_cap}, {trackingModal.dest_citta} ({trackingModal.dest_provincia})</div>
                      {trackingModal.dest_telefono&&<div><strong>Tel:</strong> {trackingModal.dest_telefono}</div>}
                      {trackingModal.dest_email&&<div><strong>Email:</strong> {trackingModal.dest_email}</div>}
                      {trackingData?.contenuto&&<div><strong>Contenuto:</strong> {trackingData.contenuto}</div>}
                      {trackingData?.cliente&&<div><strong>Creato da:</strong> {trackingData.cliente}</div>}
                    </div>
                  </div>
                  <div style={{background:'#f9fafb',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
                    <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontWeight:'700',color:'#1a1a1a',fontSize:'13px'}}>🔄 Tracking</div>
                    {trackingLoading?(
                      <div style={{padding:'30px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento tracking...</div>
                    ):!trackingData?.eventi?.length?(
                      <div style={{padding:'30px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>
                        {trackingData?.error?`Errore: ${trackingData.error}`:'Nessun evento disponibile'}
                        {trackingData?.tracking_number&&<div style={{marginTop:'8px',fontSize:'12px',color:'#1a1a1a'}}>Tracking: {trackingData.tracking_number}</div>}
                      </div>
                    ):(
                      <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                        <tbody>
                          {trackingData.eventi.map((e:any,i:number)=>(
                            <tr key={i} style={{borderBottom:'1px solid #f0f0f0',background:i===0?'#fff7ed':'#fff'}}>
                              <td style={{padding:'10px 16px',color:'#1a1a1a',whiteSpace:'nowrap' as const,fontWeight:i===0?'600':'400',width:'160px'}}>
                                {e.date||e.data||e.datetime||e.timestamp||e.eventDate||'—'}
                              </td>
                              <td style={{padding:'10px 16px',color:'#1a1a1a',fontWeight:i===0?'700':'400'}}>
                                {e.description||e.descrizione||e.status||e.evento||e.message||e.eventDescription||JSON.stringify(e)}
                              </td>
                              <td style={{padding:'10px 16px',color:'#1a1a1a',width:'180px'}}>
                                {e.location||e.luogo||e.place||e.eventLocation||''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
              {trackingTab==='colli'&&(
                <div>
                  {!trackingData?.colli_dettaglio?.length?(
                    <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>
                      <div style={{fontSize:'32px',marginBottom:'12px'}}>📦</div>
                      Spedizione singolo collo
                      {trackingModal.tracking_number&&(
                        <div style={{marginTop:'12px',background:'#f9fafb',borderRadius:'8px',padding:'12px',border:'1px solid #d1d5db',fontSize:'13px'}}>
                          <strong>Tracking:</strong> {trackingModal.tracking_number}
                        </div>
                      )}
                    </div>
                  ):(
                    <div style={{display:'flex',flexDirection:'column' as const,gap:'12px'}}>
                      {trackingData.colli_dettaglio.map((c:any,i:number)=>(
                        <div key={i} style={{background:'#f9fafb',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px'}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                            <span style={{fontWeight:'700',color:'#1a1a1a',fontSize:'13px'}}>📦 Collo {c.numero} di {trackingData.colli_dettaglio.length}</span>
                            {c.lunghezza&&<span style={{fontSize:'12px',color:'#1a1a1a'}}>{c.lunghezza}×{c.larghezza}×{c.altezza} cm · {c.peso}kg</span>}
                          </div>
                          {c.etichetta_url&&(
                            <div style={{fontSize:'12px',color:'#1a1a1a'}}>
                              <strong>Tracking collo:</strong> {c.etichetta_url.includes('base64')?'PDF disponibile':c.etichetta_url}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}