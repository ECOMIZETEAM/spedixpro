'use client'
import { useState, useEffect, useRef } from 'react'

import { useDialog } from '@/app/components/DialogProvider'
export default function RettificaCostiPage() {
  const dialog = useDialog()
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

  // Anteprima delle RIPESATURE del fornitore: e' un file diverso da quello dei pesi, e la rotta lo
  // riconosce da sola dalle colonne. Qui si tiene il risultato per mostrarlo, senza toccare il
  // flusso del file dei pesi, che continua a funzionare come prima.
  const [ripesature, setRipesature] = useState<any>(null)
  const [caricandoRip, setCaricandoRip] = useState(false)
  // Quali gruppi sono aperti. RAGGRUPPATE PER DESTINATARIO DIRETTO: un master vede i suoi
  // sotto-master e i suoi clienti diretti, non l'elenco piatto di tutta la rete sotto. Con 106
  // spedizioni su sei destinatari, l'elenco piatto e' illeggibile e non si capisce chi paga cosa.
  const [aperti, setAperti] = useState<Record<string, boolean>>({})

  // Il caricamento vero: si rimanda lo STESSO file con conferma, cosi' i numeri che si scrivono
  // sono ricalcolati adesso e non quelli che il browser si e' tenuto in tasca dall'anteprima.
  async function caricaRipesature() {
    if (!ripesature?.fileRighe) return
    setCaricandoRip(true)
    try {
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: ripesature.nomeFile, righe: ripesature.fileRighe, conferma: true }),
      })
      const d = await res.json()
      if (d?.error) await dialog.alert({ title: 'Errore', message: d.error })
      else {
        await dialog.alert({
          title: 'Rettifiche create',
          message: `Create ${d.creato} rettifiche.` + (d.doppioniRespinti ? ` ${d.doppioniRespinti} erano già state caricate e sono state respinte.` : ''),
        })
        setRipesature(null)
        await caricaFiles()
      }
    } catch { await dialog.alert({ title: 'Errore', message: 'Errore di rete.' }) }
    setCaricandoRip(false)
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
      // SI LEGGONO I TESTI, NON I NUMERI GIA' INTERPRETATI.
      //
      // Di suo questa libreria converte le celle in numeri usando le convenzioni inglesi: l'importo
      // "1,02" del file del fornitore diventa CENTODUE, perche' legge la virgola come separatore
      // delle migliaia. Il totale del file veniva 35.635 euro invece di 356,35 — cento volte tanto,
      // e nessun errore da nessuna parte.
      // Con raw:false arriva la cella com'e' scritta e i separatori li interpretiamo noi, che
      // sappiamo quali colonne usano la virgola (gli euro) e quali il punto (i chili).
      const righe = utils.sheet_to_json(ws, { raw: false })
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: file.name, righe })
      })
      const data = await res.json()
      if (data?.tipo === 'ripesature') {
        // Si tengono le righe lette: il caricamento vero le rimanda al server, che rifa' i conti.
        setRipesature({ ...data, fileRighe: righe, nomeFile: file.name })
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
        return
      }
      setRipesature(null)
      if (data.success) {
        await caricaFiles()
        await caricaRettifiche(data.fileId)
        setFileSelezionato(data.fileId)
      }
    } catch(err) { await dialog.alert({ title: 'Errore', message: 'Errore nel caricamento del file.' }) }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function cancellaRettifiche() {
    if (!selectedIds.length) { await dialog.alert({ title: 'Nessuna selezione', message: 'Seleziona almeno una rettifica.' }); return }
    if (!await dialog.confirm({ title: 'Cancellare le rettifiche?', message: 'Cancellare le ' + selectedIds.length + ' rettifiche selezionate? Non verrà scalato alcun credito.', danger: true, confirmText: 'Cancella' })) return
    const res = await fetch('/api/rettifiche', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rettificaIds: selectedIds })
    })
    const data = await res.json()
    if (data.success) {
      setSelectedIds([])
      await caricaFiles()
      await caricaRettifiche(fileSelezionato || undefined)
    } else { await dialog.alert({ title: 'Errore', message: data.error || 'Cancellazione fallita.' }) }
  }
  async function confermaRettifiche() {
    if (!selectedIds.length) { await dialog.alert({ title: 'Nessuna selezione', message: 'Seleziona almeno una rettifica.' }); return }
    if (!await dialog.confirm({ title: 'Confermare le rettifiche?', message: 'Confermi le ' + selectedIds.length + ' rettifiche selezionate? Il credito verrà scalato ai clienti.', confirmText: 'Conferma' })) return
    setConfermando(true)
    const res = await fetch('/api/rettifiche', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rettificaIds: selectedIds })
    })
    const data = await res.json()
    setConfermando(false)
    if (data.success) {
      await dialog.alert({ title: 'Rettifiche confermate', message: data.rettificate + ' rettifiche confermate. Credito aggiornato.' })
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

  // Un gruppo per destinatario: il master a cui e' indirizzata, oppure il cliente se e' diretto.
  const gruppi = (() => {
    const map = new Map<string, { nome: string; tipo: 'master' | 'cliente'; righe: any[]; totale: number }>()
    for (const r of rettificheFiltrate) {
      const nome = r.masters?.nome || r.clienti?.ragione_sociale || '(senza destinatario)'
      const chiave = (r.target_master_id || r.cliente_id || 'x') + '|' + nome
      if (!map.has(chiave)) map.set(chiave, { nome, tipo: r.target_master_id ? 'master' : 'cliente', righe: [], totale: 0 })
      const g = map.get(chiave)!
      g.righe.push(r)
      g.totale += Number(r.differenza || 0)
    }
    return [...map.entries()].sort((a, b) => Math.abs(b[1].totale) - Math.abs(a[1].totale))
  })()

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Importa file</h1>
      </div>

      {/* RIPESATURE DEL FORNITORE — riconosciute dal file, non da una voce di menu a parte.
          L'importo NON scende uguale lungo la catena: ogni livello viene riprezzato sul proprio
          listino con il collo vero, per questo c'e' una riga per livello. Al detentore del
          contratto puo' costare un euro e al cliente due e settanta, ed e' giusto cosi'.
          Per ora si guarda soltanto: nessuna rettifica creata, nessun credito toccato. */}
      {ripesature && (
        <div style={{marginBottom:'20px'}}>
          <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'10px',padding:'12px 15px',marginBottom:'14px',fontSize:'13px',color:'#92400e',lineHeight:1.6}}>
            <strong>Ripesature del fornitore.</strong> {ripesature.totali.nelFile} righe nel file ={' '}
            <strong>{ripesature.totali.spedizioni} spedizioni</strong> (i colli di una stessa spedizione
            portano lo stesso importo e vengono contati una volta sola).
            {ripesature.totali.giaCaricate > 0 && <> Di queste, <strong>{ripesature.totali.giaCaricate} erano già state caricate</strong> e sono escluse.</>}
            {ripesature.totali.nonTrovate > 0 && <> {ripesature.totali.nonTrovate} non risultano fra le nostre spedizioni.</>}
            <br/>Costo del fornitore: <strong>€ {Number(ripesature.totali.addebitoFornitore).toFixed(2)}</strong>.
            {' '}<span style={{fontWeight:700}}>Nessuna rettifica è stata creata: questa è solo un'anteprima.</span>
            <div style={{marginTop:'12px'}}>
              <button onClick={caricaRipesature} disabled={caricandoRip}
                style={{background:caricandoRip?'#d5d5d5':'#f97316',color:'#fff',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:700,cursor:caricandoRip?'default':'pointer'}}>
                {caricandoRip ? 'Sto caricando…' : 'Carica le rettifiche'}
              </button>
              <span style={{fontSize:'12px',color:'#92400e',marginLeft:'10px'}}>
                Le rettifiche vengono create verso i tuoi <strong>destinatari diretti</strong>. Da lì
                ognuno decide se accettarle e se propagarle alla propria rete.
              </span>
            </div>
          </div>
          <div style={{background:'#fff',border:'1px solid #e8e8e8',borderRadius:'10px',overflow:'hidden'}}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:'860px'}}>
                <thead><tr>
                  {['Spedizione','Collo riscontrato','Chi paga','Addebitato','Dovuto','Differenza'].map((h,i)=>(
                    <th key={h} style={{textAlign:i>2?'right':'left',padding:'9px 12px',fontSize:'11px',fontWeight:700,textTransform:'uppercase',color:'#666',borderBottom:'1px solid #e8e8e8',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {(ripesature.righe||[]).filter((r:any)=>r.trovata).map((r:any)=>(r.livelli||[]).map((l:any,i:number)=>(
                    <tr key={r.ldv+'-'+i}>
                      {i===0 && (<>
                        <td style={{padding:'8px 12px',fontSize:'12.5px',borderBottom:'1px solid #e8e8e8',verticalAlign:'top'}} rowSpan={r.livelli.length}>
                          <div style={{fontWeight:700}}>{r.ldv}</div>
                          <div style={{fontSize:'11.5px',color:'#8a8a8a'}}>{r.destinatario}</div>
                        </td>
                        <td style={{padding:'8px 12px',fontSize:'12.5px',borderBottom:'1px solid #e8e8e8',verticalAlign:'top'}} rowSpan={r.livelli.length}>
                          <div>{r.pesoPrima} → <strong>{r.pesoDopo} kg</strong>{r.colli>1?' · '+r.colli+' colli':''}</div>
                          <div style={{fontSize:'11.5px',color:'#8a8a8a'}}>{r.misure}</div>
                          <div style={{fontSize:'11.5px',color:'#15803d'}}>fornitore € {Number(r.addebitoFornitore).toFixed(2)}</div>
                        </td>
                      </>)}
                      <td style={{padding:'8px 12px',fontSize:'12.5px',borderBottom:'1px solid #f5f5f5'}}>{l.chi}</td>
                      <td style={{padding:'8px 12px',fontSize:'12.5px',borderBottom:'1px solid #f5f5f5',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>€ {Number(l.pagato).toFixed(2)}</td>
                      <td style={{padding:'8px 12px',fontSize:'12.5px',borderBottom:'1px solid #f5f5f5',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{l.dovuto==null?'—':'€ '+Number(l.dovuto).toFixed(2)}</td>
                      <td style={{padding:'8px 12px',fontSize:'12.5px',borderBottom:'1px solid #f5f5f5',textAlign:'right',fontWeight:700,fontVariantNumeric:'tabular-nums',color:l.differenza==null?'#8a8a8a':l.differenza>=0?'#15803d':'#b91c1c'}}>
                        {l.differenza==null?'n/d':(l.differenza>=0?'+':'')+'€ '+Number(l.differenza).toFixed(2)}
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
            <button onClick={cancellaRettifiche} disabled={selectedIds.length===0}
              style={{padding:'7px 16px',background:selectedIds.length>0?'#fef2f2':'#e5e7eb',color:selectedIds.length>0?'#dc2626':'#9ca3af',border:selectedIds.length>0?'1px solid #fecaca':'1px solid #e5e7eb',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:selectedIds.length>0?'pointer':'not-allowed'}}>
              Cancella selezionati
            </button>
          </div>
        </div>
        <div style={{padding:'8px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a'}}>Mostra</span>
            <select style={{padding:'3px 8px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}><option>50</option><option>100</option></select>
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
                {gruppi.map(([chiave, g]) => (
                  <tr key={'g-'+chiave} onClick={()=>setAperti(p=>({...p,[chiave]:!p[chiave]}))}
                    style={{background:'#f3f4f6',cursor:'pointer'}}>
                    <td style={{padding:'9px 10px',borderBottom:'1px solid #d1d5db'}} onClick={e=>e.stopPropagation()}>
                      <input type="checkbox"
                        checked={g.righe.filter((r:any)=>r.stato==='da_rettificare').every((r:any)=>selectedIds.includes(r.id)) && g.righe.some((r:any)=>r.stato==='da_rettificare')}
                        onChange={e=>{
                          const ids = g.righe.filter((r:any)=>r.stato==='da_rettificare').map((r:any)=>r.id)
                          setSelectedIds(prev => e.target.checked ? [...new Set([...prev,...ids])] : prev.filter(i=>!ids.includes(i)))
                        }}/>
                    </td>
                    <td colSpan={9} style={{padding:'9px 10px',borderBottom:'1px solid #d1d5db',fontSize:'12.5px',fontWeight:700,color:'#1a1a1a'}}>
                      <span style={{display:'inline-block',width:'14px',color:'#6b7280'}}>{aperti[chiave]?'▾':'▸'}</span>
                      {g.nome}
                      <span style={{fontWeight:400,color:'#6b7280',marginLeft:'8px'}}>
                        {g.tipo==='master'?'sotto-master':'cliente diretto'} · {g.righe.length} {g.righe.length===1?'rettifica':'rettifiche'}
                      </span>
                      <span style={{float:'right',fontWeight:700,color:g.totale<0?'#dc2626':'#15803d'}}>
                        € {Math.abs(g.totale).toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
                {gruppi.flatMap(([chiave,g]) => aperti[chiave] ? g.righe : []).map((r:any)=>{
                  const isSelected = selectedIds.includes(r.id)
                  const diff = Number(r.differenza || 0)
                  const isDaRett = r.stato === 'da_rettificare'
                  return (
                    <tr key={r.id} style={{borderBottom:'1px solid #d1d5db',background:isSelected?'#fff7ed':'#fff'}}>
                      <td style={{padding:'8px 10px'}}>
                        {isDaRett && <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(r.id)}/>}
                      </td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a',fontWeight:'500',fontSize:'12px'}}>{r.clienti?.ragione_sociale || (r.masters?.nome ? ('🏢 ' + r.masters.nome) : '—')}</td>
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