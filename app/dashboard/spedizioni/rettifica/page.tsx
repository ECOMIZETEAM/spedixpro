'use client'
import { useState, useEffect, useRef } from 'react'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'

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
  const [avanz, setAvanz] = useState<{fatti:number;totale:number;da:number|null;etichetta:string}|null>(null)
  // Quali gruppi sono aperti. RAGGRUPPATE PER DESTINATARIO DIRETTO: un master vede i suoi
  // sotto-master e i suoi clienti diretti, non l'elenco piatto di tutta la rete sotto. Con 106
  // spedizioni su sei destinatari, l'elenco piatto e' illeggibile e non si capisce chi paga cosa.
  const [aperti, setAperti] = useState<Record<string, boolean>>({})

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    // SUBITO, prima ancora di leggere il file: e' il tratto in cui la schermata sembrava morta.
    setAvanz({ fatti: 0, totale: 0, da: null, etichetta: 'Sto leggendo il file' })
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
        body: JSON.stringify({ nomeFile: file.name, righe, da: 0, quante: 15 })
      })
      const data = await res.json()
      if (data?.tipo === 'ripesature') {
        // UN GESTO SOLO: si mette il file e le rettifiche nascono. Poi si sceglie A CHI e QUALI
        // dalla tabella qui sotto, che e' dove la decisione viene presa davvero.
        // Il passaggio in mezzo — "guarda l'anteprima, poi premi carica" — era una complicazione
        // inutile: la stessa scelta si fa gia' selezionando i gruppi e premendo Conferma, e fino a
        // quel momento non si muove un euro.
        let creati = data.creato || 0, gia = data.giaCaricate || 0, fornitore = data.costoFornitoreScalato || 0
        let da = (data.da || 0) + (data.quante || 0)
        const totale = data.totaleDaFare ?? 0
        const fileId = data.fileId
        let finito = !!data.finito
        setAvanz({ fatti: da, totale, da: Date.now(), etichetta: 'Sto ricalcolando le spedizioni' })
        while (!finito && da < totale) {
          const r2 = await fetch('/api/rettifiche/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nomeFile: file.name, righe, da, quante: 15, fileId }),
          })
          const d2 = await r2.json()
          if (d2?.error) break
          creati += d2.creato || 0; gia += d2.giaCaricate || 0; fornitore += d2.costoFornitoreScalato || 0
          const avanti = (d2.da || 0) + (d2.quante || 0)
          // Se il segnaposto non si muove il file non finirebbe mai di essere chiesto: meglio
          // fermarsi e dire quante ne sono entrate che restare a girare a vuoto.
          if (avanti <= da) break
          da = avanti
          finito = !!d2.finito
          setAvanz(a => a ? { ...a, fatti: da } : a)
        }
        setAvanz(null)
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
        await caricaFiles()
        // ACCUMULA, non sostituisce. Prima si restringeva la vista al SOLO file appena caricato
        // (caricaRettifiche(fileId)) e le rettifiche gia' in attesa da file precedenti — o accettate
        // in "Dal mio network" — sparivano dall'elenco: sembrava che il caricamento le avesse tolte.
        // Come per i contrassegni, dopo l'upload si mostrano TUTTE le pendenti insieme; il singolo
        // file resta rivedibile cliccandolo in "File processati".
        await caricaRettifiche(); setFileSelezionato('')
        await dialog.alert({
          title: 'Rettifiche create',
          message: `Create ${creati} rettifiche su ${totale} spedizioni nel file.`
            + (gia ? ` ${gia} erano già state caricate da un file precedente e sono state saltate.` : '')
            + (fornitore ? ` Il conto del fornitore, € ${fornitore.toFixed(2)}, è stato scalato dal tuo credito: è la fattura che hai già ricevuto.` : '')
            + ' Scegli a chi girarle e premi Conferma: fino a quel momento non viene scalato nulla a loro.',
        })
        return
      }
      setAvanz(null)
      if (data.success) {
        await caricaFiles()
        // Anche il file dei pesi: accumula tutte le pendenti, non solo quelle appena caricate.
        await caricaRettifiche(); setFileSelezionato('')
      }
    } catch(err) { await dialog.alert({ title: 'Errore', message: 'Errore nel caricamento del file.' }) }
    setAvanz(null)
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
    // A LOTTI, con la barra. Con centinaia di rettifiche (l'harvester ne accumula a migliaia) una
    // sola richiesta ci metteva minuti e rischiava il timeout: si è visto con 694 in attesa. Si
    // mandano a pacchetti da 150 accumulando i risultati; ogni pacchetto è una presa atomica per
    // riga lato server, quindi un'interruzione non ripete gli addebiti già fatti.
    const LOTTO = 150
    const ids = [...selectedIds]
    let rettificate = 0
    const saltate: any[] = []
    let erroreFatale = ''
    setAvanz({ fatti: 0, totale: ids.length, da: Date.now(), etichetta: 'Conferma rettifiche' })
    for (let i = 0; i < ids.length; i += LOTTO) {
      const fetta = ids.slice(i, i + LOTTO)
      try {
        const res = await fetch('/api/rettifiche', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rettificaIds: fetta })
        })
        const data = await res.json()
        if (data.success) {
          rettificate += data.rettificate || 0
          if (Array.isArray(data.dettaglio)) saltate.push(...data.dettaglio)
        } else if (res.status !== 404) {
          // 404 = questo pacchetto era già tutto confermato (re-invio): si salta, non è fatale.
          erroreFatale = data.error || 'Conferma non riuscita.'
          break
        }
      } catch {
        erroreFatale = 'Interruzione durante la conferma: riprova — le già confermate non si ripetono.'
        break
      }
      setAvanz(prev => prev ? { ...prev, fatti: Math.min(i + LOTTO, ids.length) } : prev)
    }
    setAvanz(null)
    setConfermando(false)
    if (erroreFatale) { await dialog.alert({ title: 'Errore', message: erroreFatale }); caricaRettifiche(fileSelezionato || undefined); return }
    // SE UNA RIGA NON PASSA, VA DETTO PERCHE' (quasi sempre è una scelta: spedizione in annullo o
    // destinatario non più della rete). Si raggruppano i motivi dei pacchetti in un unico riepilogo.
    const perche = new Map<string, number>()
    for (const s of saltate) perche.set(s.perche, (perche.get(s.perche) || 0) + 1)
    await dialog.alert({
      title: 'Rettifiche confermate',
      message: `${rettificate} rettifiche confermate, credito aggiornato.`
        + (saltate.length
            ? `\n\nNON confermate: ${saltate.length}.\n`
              + Array.from(perche.entries()).map(([m, n]) => `• ${n} — ${m}`).join('\n')
              + '\n\nRestano in elenco: non sono un errore, aspettano che si sappia come va a finire.'
            : ''),
    })
    setSelectedIds([])
    caricaRettifiche(fileSelezionato || undefined)
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
      const nome = r.destinatario_nome || '(senza destinatario)'
      const chiave = (r.target_master_id || r.cliente_id || 'x') + '|' + nome
      if (!map.has(chiave)) map.set(chiave, { nome, tipo: (r.destinatario_tipo || 'cliente') as 'master'|'cliente', righe: [], totale: 0 })
      const g = map.get(chiave)!
      g.righe.push(r)
      // Il totale del gruppo è l'ADDEBITO vero: ripesatura (differenza) + supplemento fuori sagoma.
      g.totale += Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)
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
      {avanz && (
        <div style={{marginBottom:'16px'}}>
          <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da}
            etichetta={avanz.etichetta}
            sottotitolo="Ogni spedizione viene riprezzata sul listino di ciascun livello." />
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
            {fileSelezionato ? 'Spedizioni del file' : 'Rettifiche in attesa'}
            <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'400',marginLeft:'8px'}}>({rettificheFiltrate.length} righe)</span>
            {fileSelezionato && <button onClick={()=>{setFileSelezionato('');caricaRettifiche()}}
              style={{marginLeft:'10px',fontSize:'11px',color:'#f97316',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',padding:0,fontWeight:600}}>mostra tutte</button>}
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
        <div style={{padding:'7px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'11px',color:'#8a8a8a',lineHeight:1.5}}>
          Si fattura sul <strong style={{color:'#1a1a1a'}}>maggiore fra peso reale e volume</strong>: in grassetto quello su cui si paga, in <strong style={{color:'#dc2626'}}>rosso</strong> il peso ripesato che fa salire il costo. La colonna <strong style={{color:'#1a1a1a'}}>Differenza</strong> è quanto recuperi.
        </div>

        {loading ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a'}}>Caricamento...</div>
        ) : !rettificheFiltrate.length ? (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>
            {/* Le rettifiche non arrivano solo da un file: quelle accettate in "Dal mio network"
                non ne hanno uno, e "Carica un file per vedere le spedizioni" faceva pensare che
                fossero sparite. */}
            {fileSelezionato ? 'Nessuna rettifica trovata' : 'Nessuna rettifica in attesa. Ne arrivano caricando un file del corriere, oppure accettandole in "Dal mio network".'}
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
                {gruppi.flatMap(([chiave, g]) => [(
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
                ), ...(aperti[chiave] ? g.righe : []).map((r:any)=>{
                  const isSelected = selectedIds.includes(r.id)
                  const diff = Number(r.differenza || 0)
                  // L'addebito vero = ripesatura + supplemento fuori sagoma (fisso, in aggiunta). Una
                  // riga di solo fuori sagoma ha differenza 0 ma addebita comunque i 16,39: va mostrato
                  // questo, non uno "0" che sembrerebbe un errore.
                  const fs = Number(r.fuori_sagoma || 0)
                  const addebito = Math.round((diff - fs) * 100) / 100
                  const isDaRett = r.stato === 'da_rettificare'
                  // Si FATTURA sul MAGGIORE fra reale e volume: evidenzio quella misura (il perché del
                  // costo) e smorzo l'altra. Prima = grassetto scuro, Dopo = grassetto ROSSO (il peso
                  // ripesato che fa salire). A colpo d'occhio: "prima pagavi su X, ora su Y". Il vecchio
                  // rosso (reale ripesato > reale dichiarato) confondeva: non seguiva il recupero, che
                  // quasi sempre lo fa il volume.
                  const pIni = Number(r.peso_iniziale)||0, pvIni = Number(r.peso_volume_iniziale)||0
                  const pRe  = Number(r.peso_reale)||0,    pvRe  = Number(r.peso_volume_reale)||0
                  const volIni = pvIni > pIni, volRe = pvRe > pRe
                  const cIni = (on:boolean) => ({padding:'8px 10px', color: on?'#1a1a1a':'#b0b4bb', fontWeight: on?700:400})
                  const cRe  = (on:boolean) => ({padding:'8px 10px', color: on?'#dc2626':'#b0b4bb', fontWeight: on?700:400})
                  return (
                    <tr key={r.id} style={{borderBottom:'1px solid #d1d5db',background:isSelected?'#fff7ed':'#fff'}}>
                      <td style={{padding:'8px 10px'}}>
                        {isDaRett && <input type="checkbox" checked={isSelected} onChange={()=>toggleSelect(r.id)}/>}
                      </td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a',fontWeight:'500',fontSize:'12px'}}>{r.clienti?.ragione_sociale || (r.masters?.nome ? ('🏢 ' + r.masters.nome) : '—')}</td>
                      <td style={{padding:'8px 10px',color:'#f97316',fontWeight:'600'}}>
                        {r.numero_spedizione}
                        {/* Perche' questa riga non si puo' confermare, scritto qui e non solo dopo
                            aver premuto Conferma: cosi' non sembra che sia rimasta li' per errore. */}
                        {r.blocco && (
                          <div style={{marginTop:'3px',fontSize:'10.5px',fontWeight:600,color:'#b45309',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'4px',padding:'2px 6px',display:'inline-block',whiteSpace:'normal',maxWidth:'260px'}}>
                            ⏸ {r.blocco}
                          </div>
                        )}
                        {fs > 0 && (
                          <div style={{marginTop:'3px',fontSize:'10.5px',fontWeight:600,color:'#7c2d12',background:'#ffedd5',border:'1px solid #fdba74',borderRadius:'4px',padding:'2px 6px',display:'inline-block'}}>
                            + fuori sagoma € {fs.toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td style={cIni(!volIni)}>{pIni.toFixed(2)}</td>
                      <td style={cIni(volIni)}>{pvIni.toFixed(2)}</td>
                      <td style={cRe(!volRe)}>{pRe.toFixed(2)}</td>
                      <td style={cRe(volRe)}>{pvRe.toFixed(2)} kg</td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.costo_iniziale).toFixed(4)}</td>
                      <td style={{padding:'8px 10px',color:'#1a1a1a'}}>{Number(r.costo_finale).toFixed(4)}</td>
                      <td style={{padding:'8px 10px'}}>
                        {r.stato==='ok' ? (
                          <span style={{color:'#16a34a',fontWeight:'700'}}>{addebito.toFixed(4)}</span>
                        ) : addebito !== 0 ? (
                          <span style={{color:addebito<0?'#dc2626':'#16a34a',fontWeight:'700'}}>{addebito.toFixed(4)}</span>
                        ) : (
                          <span style={{color:'#dc2626',fontWeight:'700',display:'flex',alignItems:'center',gap:'4px'}}>
                            Errore! 🔄
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })])}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}