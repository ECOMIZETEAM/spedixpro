'use client'
import { useState, useEffect, useRef } from 'react'

export default function RettificaCostiPage() {
  const [rettifiche, setRettifiche] = useState<any[]>([])
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confermando, setConfermando] = useState(false)
  const [cerca, setCerca] = useState('')
  const [fileSelezionato, setFileSelezionato] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    caricaFiles()
    caricaRettifiche()
  }, [])

  async function caricaFiles() {
    const res = await fetch('/api/rettifiche/files')
    const data = await res.json()
    setFiles(Array.isArray(data) ? data : [])
  }

  async function caricaRettifiche(fileId?: string) {
    setLoading(true)
    const params = new URLSearchParams()
    if (fileId) params.set('fileId', fileId)
    const res = await fetch('/api/rettifiche?' + params.toString())
    const data = await res.json()
    setRettifiche(Array.isArray(data) ? data : [])
    setLoading(false)
  }

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
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: file.name, righe })
      })
      const data = await res.json()
      if (data.success) {
        await caricaFiles()
        await caricaRettifiche(data.fileId)
        setFileSelezionato(data.fileId)
      }
    } catch(err) { alert('Errore caricamento file') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confermaRettifiche() {
    if (!selectedIds.length) { alert('Seleziona almeno una rettifica'); return }
    if (!confirm('Confermi le ' + selectedIds.length + ' rettifiche selezionate? Il credito verrà scalato ai clienti.')) return
    setConfermando(true)
    const res = await fetch('/api/rettifiche', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rettificaIds: selectedIds })
    })
    const data = await res.json()
    setConfermando(false)
    if (data.success) {
      alert('✅ ' + data.rettificate + ' rettifiche confermate! Credito aggiornato.')
      setSelectedIds([])
      caricaRettifiche(fileSelezionato || undefined)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleAll() {
    const visibili = rettificheFiltrate.filter(r => r.stato === 'da_rettificare')
    if (selectedIds.length === visibili.length) setSelectedIds([])
    else setSelectedIds(visibili.map(r => r.id))
  }

  const rettificheFiltrate = cerca
    ? rettifiche.filter(r =>
        r.numero_spedizione?.toLowerCase().includes(cerca.toLowerCase()) ||
        r.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase())
      )
    : rettifiche

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Importa file</h1>
      </div>

      {/* Upload + File processati */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:'16px',marginBottom:'16px'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'4px'}}>1. Seleziona file <span style={{color:'#1a1a1a',fontWeight:'400',fontSize:'11px'}}>(*max 5.000 righe)</span></div>
          <div style={{fontSize:'12px',color:'#1a1a1a',marginBottom:'8px',fontWeight:'600',marginTop:'12px'}}>File: XLS, XLSX, CSV</div>
          <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" onChange={uploadFile}
            style={{fontSize:'12px',marginBottom:'12px',display:'block',color:'#1a1a1a'}}/>
          <button onClick={()=>fileRef.current?.click()} disabled={uploading}
            style={{padding:'7px 16px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:uploading?0.7:1}}>
            {uploading?'Caricamento...':'Carica file peso/volume'}
          </button>
        </div>

        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>File processati</div>
          {!files.length ? (
            <div style={{padding:'20px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessun file caricato</div>
          ) : (
            <div style={{overflowX:'auto' as const, maxHeight:'340px', overflowY:'auto' as const}}>
              <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
                <thead><tr style={{background:'#f9fafb'}}>
                  {['#','File','Data caricamento','N. Tot Spedizioni','N. processate','N. trovate','N. scartati','N. da rettificare'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'7px 10px',fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {files.map((f:any)=>(
                    <tr key={f.id} style={{borderBottom:'1px solid #d1d5db',cursor:'pointer',background:fileSelezionato===f.id?'#fff7ed':'#fff'}}
                      onClick={()=>{setFileSelezionato(f.id);caricaRettifiche(f.id)}}>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.numero}</td>
                      <td style={{padding:'7px 10px',color:'#f97316',fontWeight:'500',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{f.nome_file}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a',whiteSpace:'nowrap' as const}}>{new Date(f.created_at).toLocaleString('it-IT')}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_tot_spedizioni}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_processate}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_trovate}</td>
                      <td style={{padding:'7px 10px',color:'#1a1a1a'}}>{f.n_scartati}</td>
                      <td style={{padding:'7px 10px',fontWeight:'700',color:'#f97316'}}>{f.n_da_rettificare}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Tabella rettifiche */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'14px',fontWeight:'700',color:'#1a1a1a'}}>
            Spedizioni trovate
            {fileSelezionato && <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'400',marginLeft:'8px'}}>({rettificheFiltrate.length} righe)</span>}
          </span>
          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <button onClick={confermaRettifiche} disabled={confermando||selectedIds.length===0}
              style={{padding:'7px 16px',background:selectedIds.length>0?'#f97316':'#e5e7eb',color:selectedIds.length>0?'#fff':'#9ca3af',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
              {confermando?'Conferma...':'Conferma rettifiche' + (selectedIds.length>0?' ('+selectedIds.length+')':'')}
            </button>
            <button onClick={()=>setSelectedIds([])} disabled={selectedIds.length===0}
              style={{padding:'7px 16px',background:selectedIds.length>0?'#fef2f2':'#e5e7eb',color:selectedIds.length>0?'#dc2626':'#9ca3af',border:selectedIds.length>0?'1px solid #fecaca':'1px solid #e5e7eb',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
              Cancella selezionati
            </button>
          </div>
        </div>
        <div style={{padding:'8px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
            <select style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px'}}><option>50</option><option>100</option></select>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>elementi</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)}
              style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',width:'180px',color:'#1a1a1a'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !rettificheFiltrate.length ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>
            {fileSelezionato ? 'Nessuna rettifica trovata' : 'Carica un file per vedere le spedizioni'}
          </div>
        ) : (
          <div style={{overflowX:'auto' as const}}>
            <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={{padding:'8px 10px',borderBottom:'1px solid #d1d5db',width:'36px'}}>
                  <input type="checkbox"
                    checked={selectedIds.length===rettificheFiltrate.filter(r=>r.stato==='da_rettificare').length&&rettificheFiltrate.filter(r=>r.stato==='da_rettificare').length>0}
                    onChange={toggleAll}/>
                </th>
                {['Cliente','N. Spedizione','Peso iniziale','Peso/volume iniziale','Peso reale','Peso/volume reale','Costo iniziale','Costo finale','Differenza'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'8px 10px',fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rettificheFiltrate.map((r:any)=>{
                  const isSelected = selectedIds.includes(r.id)
                  const diff = Number(r.differenza || 0)
                  const isDaRett = r.stato === 'da_rettificare'
                  return (
                    <tr key={r.id} style={{borderBottom:'1px solid #d1d5db',background:isSelected?'#fff7ed':'#fff'}}>
                      <td style={{padding:'8px 10px'}}>
                        {isDaRett && <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(r.id)}/>}
                      </td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a',fontWeight:'500',fontSize:'12px'}}>{r.clienti?.ragione_sociale||'—'}</td>
                      <td style={{padding:'8px 10px',color:'#f97316',fontWeight:'600'}}>{r.numero_spedizione}</td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.peso_iniziale).toFixed(2)}</td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.peso_volume_iniziale).toFixed(2)}</td>
                      <td style={{padding:'8px 10px',color:Number(r.peso_reale)>Number(r.peso_iniziale)?'#dc2626':'#374151',fontWeight:Number(r.peso_reale)>Number(r.peso_iniziale)?'700':'400'}}>
                        {Number(r.peso_reale).toFixed(2)}
                      </td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.peso_volume_reale).toFixed(2)} kg</td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.costo_iniziale).toFixed(4)}</td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.costo_finale).toFixed(4)}</td>
                      <td style={{padding:'8px 10px'}}>
                        {r.stato==='ok' ? (
                          <span style={{color:'#16a34a',fontWeight:'700'}}>{diff.toFixed(4)}</span>
                        ) : diff !== 0 ? (
                          <span style={{color:diff<0?'#dc2626':'#16a34a',fontWeight:'700'}}>{diff.toFixed(4)}</span>
                        ) : (
                          <span style={{color:'#dc2626',fontWeight:'700',display:'flex',alignItems:'center',gap:'4px'}}>
                            Errore! 🔄
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}