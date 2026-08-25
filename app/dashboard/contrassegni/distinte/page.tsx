'use client'
import { useState, useEffect, useRef, Fragment } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}

import { useDialog } from '@/app/components/DialogProvider'
export default function DistinteContrassegniPage() {
  const dialog = useDialog()
  const [distinte, setDistinte] = useState<any[]>([])
  const [clienti, setClienti] = useState<any[]>([])
  const [codFiles, setCodFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  // Barra di avanzamento: appare per QUALSIASI cosa si carichi/importi (upload file COD, carico
  // destinatari, carico rimesse). Modo indeterminato: e' una POST unica, non sappiamo la percentuale.
  const [avanz, setAvanz] = useState<{fatti:number;totale:number;da:number|null;etichetta:string;sottotitolo?:string}|null>(null)
  const [caricando, setCaricando] = useState(false)
  const [daCaricare, setDaCaricare] = useState<{gruppi:any[];totale:number;spedizioni:number}>({gruppi:[],totale:0,spedizioni:0})
  const [selDest, setSelDest] = useState<Set<string>>(new Set())        // gruppi INTERI selezionati
  const [selSped, setSelSped] = useState<Record<string, Set<string>>>({}) // spedizioni singole per gruppo
  const [espansi, setEspansi] = useState<Set<string>>(new Set())          // tendine aperte
  const [dettGruppo, setDettGruppo] = useState<Record<string, any>>({})   // dettaglio paginato per gruppo
  const [cerca, setCerca] = useState('')
  const [modalPagamento, setModalPagamento] = useState<any>(null)
  const [metodoPagamento, setMetodoPagamento] = useState('')
  const [importoPag, setImportoPag] = useState('')   // importo del pagamento (parziale); vuoto = salda il residuo
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
    caricaDaCaricare()
  }, [])

  function caricaDaCaricare() {
    fetch('/api/contrassegni/da-caricare').then(r=>r.json()).then(d=>{
      setDaCaricare({ gruppi: d?.gruppi || [], totale: Number(d?.totale||0), spedizioni: Number(d?.spedizioni||0) })
      setSelDest(new Set()); setSelSped({}); setEspansi(new Set()); setDettGruppo({})
    }).catch(()=>{})
  }

  // Tendina di un cliente: carica le sue spedizioni PAGINATE (10/pag) dall'endpoint dettaglio.
  async function caricaDettaglio(chiave: string, page = 1) {
    setDettGruppo(prev => ({ ...prev, [chiave]: { ...(prev[chiave]||{}), loading: true } }))
    try {
      const d = await fetch(`/api/contrassegni/da-caricare/dettaglio?chiave=${encodeURIComponent(chiave)}&page=${page}`).then(r=>r.json())
      setDettGruppo(prev => ({ ...prev, [chiave]: { totale: d?.totale||0, page: d?.page||page, perPage: d?.perPage||10, righe: d?.righe||[], perGiorno: d?.perGiorno||{}, loading: false } }))
    } catch { setDettGruppo(prev => ({ ...prev, [chiave]: { ...(prev[chiave]||{}), loading: false } })) }
  }
  function toggleEspansi(chiave: string) {
    setEspansi(prev => { const n = new Set(prev); if (n.has(chiave)) n.delete(chiave); else { n.add(chiave); if (!dettGruppo[chiave]) caricaDettaglio(chiave, 1) } return n })
  }
  // Selezione della SINGOLA spedizione: se il gruppo era "intero" lo sgancio (si passa al manuale).
  function toggleSpedizione(chiave: string, id: string) {
    setSelDest(prev => { if (!prev.has(chiave)) return prev; const n = new Set(prev); n.delete(chiave); return n })
    setSelSped(prev => {
      const cur = new Set(prev[chiave] || [])
      cur.has(id) ? cur.delete(id) : cur.add(id)
      const next = { ...prev }; if (cur.size) next[chiave] = cur; else delete next[chiave]
      return next
    })
  }
  // Checkbox del gruppo: seleziona/annulla il cliente INTERO (azzera l'eventuale selezione a mano).
  function toggleGruppo(chiave: string) {
    setSelDest(prev => { const n = new Set(prev); if (n.has(chiave)) { n.delete(chiave); return n } n.add(chiave); return n })
    setSelSped(prev => { if (!prev[chiave]) return prev; const n = { ...prev }; delete n[chiave]; return n })
  }
  // Checkbox dell'intestazione GIORNO: seleziona/deseleziona tutte le spedizioni di quel giorno
  // (anche quelle su altre pagine, via perGiorno). Se il gruppo era "intero" passo al granulare
  // partendo da TUTTE le sue spedizioni, poi tolgo il giorno — cosi' "intero meno un giorno" funziona.
  function toggleGiorno(chiave: string, giornoIds: string[]) {
    if (!giornoIds.length) return
    const perG: Record<string, string[]> = dettGruppo[chiave]?.perGiorno || {}
    const tuttiGruppo = Object.values(perG).flat() as string[]
    const eraIntero = selDest.has(chiave)
    setSelDest(prev => { if (!prev.has(chiave)) return prev; const n = new Set(prev); n.delete(chiave); return n })
    setSelSped(prev => {
      const cur = new Set(eraIntero ? tuttiGruppo : (prev[chiave] || []))
      const tuttiSel = giornoIds.every(id => cur.has(id))
      if (tuttiSel) giornoIds.forEach(id => cur.delete(id)); else giornoIds.forEach(id => cur.add(id))
      const next = { ...prev }; if (cur.size) next[chiave] = cur; else delete next[chiave]
      return next
    })
  }

  // Conta i contrassegni selezionati su TUTTA la rete: gruppi interi (tutte le loro spedizioni) +
  // le singole spuntate a mano (dai gruppi non interi).
  function contaSelezionati() {
    return daCaricare.gruppi.reduce((s: number, g: any) => s + (selDest.has(g.chiave) ? g.spedizioni : (selSped[g.chiave]?.size || 0)), 0)
  }

  async function caricaDestinatari() {
    const destWhole = Array.from(selDest)
    const spedIndiv: string[] = []
    for (const [chiave, set] of Object.entries(selSped)) { if (!selDest.has(chiave)) for (const id of set) spedIndiv.push(id) }
    const conta = contaSelezionati()
    if (!conta) { await dialog.alert({ title:'Nessuna selezione', message:'Seleziona almeno un contrassegno.' }); return }
    const ok = await dialog.confirm({ title:'Carica contrassegni', message:`Caricare ${conta} contrassegni? Da questo momento scendono al livello sotto. Quelli non selezionati restano in attesa.` })
    if (!ok) return
    setCaricando(true)
    setAvanz({ fatti: 0, totale: 0, da: null, etichetta: 'Sto creando le distinte', sottotitolo: `${conta} contrassegni` })
    try {
      const r = await fetch('/api/contrassegni/da-caricare', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ destinatari: destWhole, spedizioni: spedIndiv }) })
      const j = await r.json()
      if (j.success) {
        await dialog.alert({ title:'Contrassegni caricati', message:
            `Distinte create: ${j.distinteCreate}\n`
          + `Spedizioni caricate: ${j.spedizioniCaricate} · € ${Number(j.totaleCaricato||0).toFixed(2)}\n`
          + (j.giaCaricate ? `Già in una tua distinta (saltate): ${j.giaCaricate}\n` : '')
          + (j.senzaImporto ? `Importo a zero, restano in attesa: ${j.senzaImporto}\n` : '')
          + (j.nonRiuscite ? `Non caricate, tornate in attesa: ${j.nonRiuscite}\n` : '') })
        caricaDaCaricare(); carica()
      } else await dialog.alert({ title:'Errore', message: j.error || 'Errore durante il caricamento.' })
    } catch { await dialog.alert({ title:'Errore', message:'Errore durante il caricamento.' }) }
    setAvanz(null)
    setCaricando(false)
  }

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
    // Legge TUTTE le righe di TUTTI i file selezionati (CSV con papaparse — robusto sui CSV grandi,
    // niente tetto a 500 — XLS/XLSX con xlsx), poi le processa a BLOCCHI. I blocchi tengono viva la
    // barra (avanzamento per righe) ed evitano il timeout della funzione su file grossi. I doppioni
    // fra righe/pagine sono gestiti dal vincolo unico (master, spedizione) nell'area di sosta.
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    const inizio = Date.now()
    setAvanz({ fatti: 0, totale: 0, da: inizio, etichetta: 'Sto leggendo i file dei contrassegni',
      sottotitolo: files.length > 1 ? `${files.length} file` : files[0].name })

    // 1) LETTURA: numero VERO di righe per file (così si vede subito se un file ha davvero >500 righe).
    const Papa = (await import('papaparse')).default
    let xlsxUtils: any = null, xlsxRead: any = null
    const letti: { name: string; righe: any[] }[] = []
    for (const file of files) {
      let righe: any[] = []
      try {
        if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
          const parsed = Papa.parse(await file.text(), { header: true, skipEmptyLines: true })
          righe = (parsed.data as any[]) || []
        } else {
          if (!xlsxRead) { const x = await import('xlsx'); xlsxUtils = x.utils; xlsxRead = x.read }
          const wb = xlsxRead(await file.arrayBuffer())
          righe = xlsxUtils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
        }
      } catch { righe = [] }
      letti.push({ name: file.name, righe })
    }
    const totaleRighe = letti.reduce((s, f) => s + f.righe.length, 0)
    setAvanz(a => a ? { ...a, totale: totaleRighe, etichetta: 'Sto caricando i contrassegni',
      sottotitolo: `${totaleRighe} righe da ${files.length} file` } : a)

    // 2) ELABORAZIONE a blocchi.
    const CHUNK = 200
    const tot = { righeFile: 0, spedizioniProcessate: 0, inAttesa: 0, codFile: 0, codSistema: 0, codDaPagare: 0,
      giaInDistinta: 0, giaInSosta: 0, giaPagati: 0, doppioniFile: 0, saltateNonPagate: 0, errori: 0, nonClassificate: 0 }
    const problemi: string[] = []
    let fatte = 0
    for (const f of letti) {
      if (!f.righe.length) { problemi.push(`${f.name}: nessuna riga letta`); continue }
      const agg = { righeFile: f.righe.length, spedizioniProcessate: 0, codFile: 0, codSistema: 0, codDaPagare: 0, errori: 0 }
      for (let i = 0; i < f.righe.length; i += CHUNK) {
        const blocco = f.righe.slice(i, i + CHUNK)
        try {
          const res = await fetch('/api/contrassegni/upload-cod', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nomeFile: f.name, righe: blocco, scriviLog: false })
          })
          const d = await res.json()
          if (d.success) {
            tot.spedizioniProcessate += d.spedizioniProcessate || 0; tot.inAttesa += d.inAttesa || 0
            tot.codDaPagare += Number(d.codDaPagare || 0); tot.giaInDistinta += d.giaInDistinta || 0
            tot.giaPagati += d.giaPagati || 0; tot.doppioniFile += d.doppioniFile || 0
            tot.giaInSosta += d.giaInSosta || 0
            tot.saltateNonPagate += d.saltateNonPagate || 0; tot.errori += d.errori || 0
            tot.nonClassificate += d.nonClassificate || 0; tot.codFile += Number(d.codFile || 0); tot.codSistema += Number(d.codSistema || 0)
            agg.spedizioniProcessate += d.spedizioniProcessate || 0; agg.codFile += Number(d.codFile || 0)
            agg.codSistema += Number(d.codSistema || 0); agg.codDaPagare += Number(d.codDaPagare || 0); agg.errori += d.errori || 0
          } else { problemi.push(`${f.name}: ${d.error || 'blocco non caricato'}`) }
        } catch { problemi.push(`${f.name}: errore di rete su un blocco`) }
        fatte += blocco.length
        setAvanz(a => a ? { ...a, fatti: fatte, sottotitolo: `${f.name} — ${Math.min(fatte, totaleRighe)}/${totaleRighe} righe` } : a)
      }
      tot.righeFile += f.righe.length
      // Una riga di riepilogo in "File processati" per ogni file (come prima).
      try { await fetch('/api/contrassegni/upload-cod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomeFile: f.name, soloLog: agg }) }) } catch {}
    }

    await dialog.alert({ title: files.length > 1 ? `${files.length} file caricati` : 'File caricato', message:
        `Righe totali lette dai file: ${totaleRighe}\n\n`
      + `Come sono state ripartite (tutte contate):\n`
      + `• Riconosciute e caricate: ${tot.spedizioniProcessate} (di cui nuove in attesa: ${tot.inAttesa} · € ${tot.codDaPagare.toFixed(2)})\n`
      + `• Già in area di sosta (file già importato): ${tot.giaInSosta}\n`
      + `• Già in una tua distinta: ${tot.giaInDistinta}\n`
      + `• Già pagate in precedenza: ${tot.giaPagati}\n`
      + `• Doppioni nei file: ${tot.doppioniFile}\n`
      + `• Non ancora versate dal corriere: ${tot.saltateNonPagate}\n`
      + `• Non trovate a sistema (scartate): ${tot.errori}\n`
      + (tot.nonClassificate ? `\n⚠️ Righe NON classificate: ${tot.nonClassificate} — avvisami, è un errore!\n` : '')
      + (problemi.length ? `\n⚠️ File con problemi:\n${problemi.join('\n')}\n` : '')
      + `\nLe "caricate" le trovi in "Contrassegni da caricare": decidi a chi caricarle.` })

    fetch('/api/contrassegni/cod-files').then(r => r.json()).then(d => setCodFiles(d || []))
    caricaDaCaricare()
    setAvanz(null)
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
  // Nome file dell'export: "Distinta contrassegni <CLIENTE> <numero>" — il cliente e' il nome che
  // serve a chi lo apre; il numero resta come coda per non sovrascrivere due distinte dello stesso cliente.
  function nomeFileDistinta(d: any) {
    const cli = String(d.clienti?.ragione_sociale || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
    return ('Distinta contrassegni ' + (cli ? cli + ' ' : '') + (d.numero ?? '')).trim()
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
    doc.save(nomeFileDistinta(d) + '.pdf')
  }
  async function esportaExcel(d: any) {
    const { utils, writeFile } = await import('xlsx')
    const righe = estraiRighe(d)
    const ws = utils.json_to_sheet(righe.map((r: any) => ({ Spedizioni: r.numero, 'Rif. Mittente': r.mittente, Destinatario: r.destinatario, 'Data Spedizione': r.data, 'Contr. iniziale': r.iniziale, 'Contr. rimborsato': r.rimborsato })))
    const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Distinta ' + d.numero)
    writeFile(wb, nomeFileDistinta(d) + '.xlsx')
  }
  function chiudiModalPagamento() {
    setModalPagamento(null); setMetodoPagamento(''); setImportoPag(''); setSuddividi(false)
    setRighePag([{metodo:'',importo:''},{metodo:'',importo:''}])
  }
  async function confermaPagamento() {
    const totale = Number(modalPagamento?.totale_iniziale || 0)
    const residuo = Math.round((totale - Number(modalPagamento?.totale_pagato || 0)) * 100) / 100
    let payload: any
    if (suddividi) {
      const righe = righePag.map(r => ({ metodo: r.metodo, importo: Number(r.importo) }))
        .filter(r => r.metodo && r.importo > 0)
      if (!righe.length) { await dialog.alert({ title: 'Dati mancanti', message: 'Inserisci almeno una modalità con importo.' }); return }
      const somma = Math.round(righe.reduce((s,r)=>s+r.importo,0)*100)/100
      if (somma > residuo + 0.02) { await dialog.alert({ title: 'Importo non valido', message: `La somma (€${somma.toFixed(2)}) supera il residuo da saldare (€${residuo.toFixed(2)}).` }); return }
      payload = { pagamenti: righe }
    } else {
      if (!metodoPagamento) { await dialog.alert({ title: 'Metodo mancante', message: 'Seleziona il tipo di pagamento.' }); return }
      const imp = importoPag !== '' ? Math.round(Number(importoPag) * 100) / 100 : residuo
      if (!(imp > 0) || imp > residuo + 0.02) { await dialog.alert({ title: 'Importo non valido', message: `Residuo € ${residuo.toFixed(2)}.` }); return }
      payload = { metodoPagamento, importo: imp }
    }
    setConfermando(true)
    const res = await fetch('/api/contrassegni/distinte/' + modalPagamento.id, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    setConfermando(false)
    if (data.success) { chiudiModalPagamento(); carica() }
    else await dialog.alert({ title: 'Errore', message: data.error || 'Errore durante la conferma.' })
  }

  const distinteFiltrate = cerca
    ? distinte.filter(d => d.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase()) || String(d.numero).includes(cerca))
    : distinte

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Distinte contrassegni</h1></div>

      {avanz && (
        <div style={{marginBottom:'16px'}}>
          <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da} etichetta={avanz.etichetta} sottotitolo={avanz.sottotitolo} />
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:'16px',marginBottom:'16px'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'12px'}}>Carica il file con i contrassegni ricevuto dal corriere.</div>
          <div style={{fontSize:'12px',color:'#1a1a1a',marginBottom:'6px',fontWeight:'600'}}>Seleziona file: XLS, XLSX, CSV</div>
          <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" multiple onChange={uploadFile} style={{fontSize:'12px',marginBottom:'8px',display:'block',color:'#1a1a1a'}}/>
          <div style={{fontSize:'11px',color:'#1a1a1a',marginBottom:'12px'}}>Il file deve contenere le colonne <strong>LDV</strong> e <strong>ImportoCOD</strong>. <strong>Nessun limite di righe</strong>: carica pure un unico file grande (anche decine di migliaia di righe) — la barra sale man mano che elabora. Puoi anche selezionare più file insieme.</div>
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

            {/* AREA DI SOSTA: contrassegni verificabili PRIMA di farli scendere, divisi per destinatario */}
      {daCaricare.gruppi.length > 0 && (() => {
        const conta = contaSelezionati()
        const tuttiInteri = selDest.size === daCaricare.gruppi.length && daCaricare.gruppi.length > 0
        return (
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #86efac',overflow:'hidden',marginBottom:'16px'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #bbf7d0',background:'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',flexWrap:'wrap' as const}}>
            <div>
              <div style={{fontSize:'13px',fontWeight:800,color:'#15803d'}}>💰 Contrassegni da caricare — {daCaricare.spedizioni} spedizioni · € {daCaricare.totale.toFixed(2)}</div>
              <div style={{fontSize:'11.5px',color:'#166534',marginTop:'2px'}}>Apri un cliente per scegliere le singole spedizioni (anche su più pagine), oppure spunta il cliente intero. Le non selezionate restano in attesa.</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'#166534',cursor:'pointer',fontWeight:600}}>
                <input type="checkbox" checked={tuttiInteri}
                  onChange={e=>{ if (e.target.checked) { setSelDest(new Set(daCaricare.gruppi.map((g:any)=>g.chiave))); setSelSped({}) } else setSelDest(new Set()) }}
                  style={{width:'15px',height:'15px',cursor:'pointer'}}/>
                Seleziona tutti
              </label>
              <button onClick={caricaDestinatari} disabled={caricando || !conta}
                style={{padding:'7px 16px',background:conta?'#16a34a':'#d1d5db',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:700,cursor:conta?'pointer':'default'}}>
                {caricando ? 'Caricamento…' : `Carica selezionati (${conta})`}
              </button>
            </div>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'12px'}}>
            <thead><tr style={{background:'#f9fafb'}}>
              {['','Destinatario','Tipo','Spedizioni','Totale','Provenienza'].map((h,i)=><th key={i} style={{textAlign:'left' as const,padding:'7px 12px',fontWeight:700,textTransform:'uppercase' as const,fontSize:'10.5px',color:'#1a1a1a',borderBottom:'1px solid #e5e7eb'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {daCaricare.gruppi.map((g:any)=>{
                const aperto = espansi.has(g.chiave)
                const intero = selDest.has(g.chiave)
                const nSel = intero ? g.spedizioni : (selSped[g.chiave]?.size || 0)
                const dett = dettGruppo[g.chiave]
                const totPag = dett ? Math.max(1, Math.ceil((dett.totale||0)/(dett.perPage||10))) : 1
                return (
                <Fragment key={g.chiave}>
                  <tr style={{borderBottom:'1px solid #f1f5f9',cursor:'pointer',background:aperto?'#f0fdf4':'transparent'}} onClick={()=>toggleEspansi(g.chiave)}>
                    <td style={{padding:'7px 12px',width:'30px'}} onClick={e=>{e.stopPropagation(); toggleGruppo(g.chiave)}}>
                      <input type="checkbox" checked={intero} ref={el=>{ if(el) el.indeterminate = !intero && nSel>0 }} onChange={()=>{}} style={{width:'15px',height:'15px',cursor:'pointer',pointerEvents:'none' as const}}/>
                    </td>
                    <td style={{padding:'7px 12px',fontWeight:600,color:'#1a1a1a'}}>
                      <span style={{display:'inline-block',width:'14px',color:'#16a34a',transform:aperto?'rotate(90deg)':'none',transition:'transform .15s'}}>▸</span>
                      {g.nome}
                      {nSel>0 && <span style={{marginLeft:'8px',fontSize:'10.5px',fontWeight:700,color:'#166534',background:'#dcfce7',borderRadius:'999px',padding:'1px 7px'}}>{nSel} selezionate</span>}
                    </td>
                    <td style={{padding:'7px 12px'}}>
                      <span style={{fontSize:'10.5px',fontWeight:700,padding:'2px 7px',borderRadius:'999px',background:g.tipo==='cliente'?'#eff6ff':'#fff7ed',color:g.tipo==='cliente'?'#1d4ed8':'#c2410c'}}>{g.tipo}</span>
                    </td>
                    <td style={{padding:'7px 12px',color:'#1a1a1a'}}>{g.spedizioni}</td>
                    <td style={{padding:'7px 12px',fontWeight:700,color:'#15803d'}}>€ {Number(g.totale).toFixed(2)}</td>
                    <td style={{padding:'7px 12px',color:'#6b7280',fontSize:'11px'}}>{(g.origini||[]).map((o:string)=>o==='file'?'file corriere':'rimessa rete').join(' + ')}</td>
                  </tr>
                  {aperto && (
                    <tr style={{background:'#fafffb'}}>
                      <td colSpan={6} style={{padding:'0 12px 10px 34px'}}>
                        {!dett || dett.loading ? (
                          <div style={{padding:'12px',color:'#999',fontSize:'12px'}}>Caricamento spedizioni…</div>
                        ) : !dett.righe?.length ? (
                          <div style={{padding:'12px',color:'#999',fontSize:'12px'}}>Nessuna spedizione.</div>
                        ) : (
                          <div>
                            {dett.righe.map((s:any, idx:number)=>{
                              const sel = intero || (selSped[g.chiave]?.has(s.spedizione_id) || false)
                              const iso = s.created_at ? String(s.created_at).slice(0,10) : 'senza-data'
                              const isoPrec = idx>0 ? (dett.righe[idx-1].created_at ? String(dett.righe[idx-1].created_at).slice(0,10) : 'senza-data') : null
                              const giornoLabel = s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}) : 'Senza data'
                              const giornoIds: string[] = (dett.perGiorno?.[iso] || [])
                              const giornoSel = intero || (giornoIds.length>0 && giornoIds.every((id:string)=>selSped[g.chiave]?.has(id)))
                              return (
                                <Fragment key={s.spedizione_id}>
                                  {iso!==isoPrec && (
                                    <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 8px 5px',fontSize:'11px',fontWeight:700,color:'#166534',textTransform:'uppercase' as const,letterSpacing:'.02em',background:'#f6faf8',borderBottom:'1px solid #eef2f0',cursor:'pointer'}}>
                                      <input type="checkbox" checked={giornoSel} onChange={()=>toggleGiorno(g.chiave, giornoIds)} style={{width:'14px',height:'14px',cursor:'pointer'}}/>
                                      📅 {giornoLabel} <span style={{color:'#9ca3af',fontWeight:400}}>({giornoIds.length})</span>
                                    </label>
                                  )}
                                  <label style={{display:'flex',alignItems:'center',gap:'10px',padding:'6px 8px 6px 26px',borderBottom:'1px solid #eef2f0',cursor:'pointer',fontSize:'12px'}}>
                                    <input type="checkbox" checked={sel} onChange={()=>toggleSpedizione(g.chiave, s.spedizione_id)} style={{width:'14px',height:'14px',cursor:'pointer'}}/>
                                    <span style={{fontFamily:'monospace',color:'#1a1a1a',minWidth:'130px'}}>{s.numero}</span>
                                    <span style={{color:'#374151',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{s.dest_nome}{s.dest_citta?` · ${s.dest_citta}`:''}</span>
                                    <span title="Data spedizione" style={{color:'#9ca3af',fontSize:'11px',whiteSpace:'nowrap' as const,minWidth:'66px',textAlign:'right' as const}}>{s.created_at?new Date(s.created_at).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'2-digit'}):''}</span>
                                    <span style={{fontWeight:700,color:'#15803d',whiteSpace:'nowrap' as const,minWidth:'72px',textAlign:'right' as const}}>€ {Number(s.importo).toFixed(2)}</span>
                                  </label>
                                </Fragment>
                              )
                            })}
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',padding:'8px 4px 2px',flexWrap:'wrap' as const}}>
                              <span style={{fontSize:'11px',color:'#6b7280'}}>{(dett.page-1)*(dett.perPage||10)+1}-{Math.min(dett.page*(dett.perPage||10), dett.totale)} di {dett.totale}</span>
                              <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                                <button onClick={()=>dett.page>1 && caricaDettaglio(g.chiave, 1)} disabled={dett.page<=1} title="Prima pagina" style={{padding:'4px 9px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'11px',cursor:dett.page<=1?'default':'pointer',color:dett.page<=1?'#ccc':'#1a1a1a'}}>« Prima</button>
                                <button onClick={()=>dett.page>1 && caricaDettaglio(g.chiave, dett.page-1)} disabled={dett.page<=1} style={{padding:'4px 9px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'11px',cursor:dett.page<=1?'default':'pointer',color:dett.page<=1?'#ccc':'#1a1a1a'}}>‹ Prec</button>
                                <span style={{fontSize:'11px',color:'#6b7280'}}>Pag. {dett.page}/{totPag}</span>
                                <button onClick={()=>dett.page<totPag && caricaDettaglio(g.chiave, dett.page+1)} disabled={dett.page>=totPag} style={{padding:'4px 9px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'11px',cursor:dett.page>=totPag?'default':'pointer',color:dett.page>=totPag?'#ccc':'#1a1a1a'}}>Succ ›</button>
                                <button onClick={()=>dett.page<totPag && caricaDettaglio(g.chiave, totPag)} disabled={dett.page>=totPag} title="Ultima pagina" style={{padding:'4px 9px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'11px',cursor:dett.page>=totPag?'default':'pointer',color:dett.page>=totPag?'#ccc':'#1a1a1a'}}>Ultima »</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        )
      })()}

<div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>▼ Filtri</div>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr 1fr',gap:'12px',alignItems:'end'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Data distinta</div>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal:string,al:string)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Cliente</div>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',marginBottom:'3px'}}>Stato distinta</div>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="in_lavorazione">In lavorazione</option>
              <option value="parziale">Parziale</option>
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
                    {d.stato==='pagata' ? (
                      <span style={{background:'#f0fdf4',color:'#16a34a',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>Pagata</span>
                    ) : d.stato==='parziale' ? (
                      <span style={{background:'#fef9c3',color:'#a16207',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>Parziale € {Number(d.totale_pagato||0).toFixed(2)}/{Number(d.totale_iniziale||0).toFixed(2)}</span>
                    ) : (
                      <span style={{background:'#fffbeb',color:'#d97706',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>In lavorazione</span>
                    )}
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
                      {d.stato==='in_lavorazione' && !Number(d.totale_pagato||0) && (
                        <button onClick={async()=>{
                          const ok = await dialog.confirm({ title: 'Elimina distinta', message: `Eliminare la distinta N.${d.numero}? Le spedizioni tornano disponibili per una nuova distinta.`, danger: true })
                          if (!ok) return
                          const r = await fetch('/api/contrassegni/distinte/' + d.id, { method: 'DELETE' })
                          const j = await r.json().catch(()=>({}))
                          if (j.success) carica()
                          else await dialog.alert({ title: 'Non eliminabile', message: j.error || 'Errore durante l\'eliminazione.' })
                        }} style={{padding:'4px 10px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'4px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>🗑 Elimina</button>
                      )}
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
                <div><strong>Totale:</strong> € {Number(modalPagamento.totale_iniziale).toFixed(2)}</div>
                {Number(modalPagamento.totale_pagato||0) > 0 && (
                  <div style={{color:'#a16207'}}><strong>Già pagato:</strong> € {Number(modalPagamento.totale_pagato).toFixed(2)} · <strong>Residuo:</strong> € {(Number(modalPagamento.totale_iniziale)-Number(modalPagamento.totale_pagato)).toFixed(2)}</div>
                )}
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
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',margin:'10px 0 4px'}}>Importo pagato (vuoto = salda il residuo)</label>
                  <input type="number" step="0.01" min="0"
                    placeholder={`€ ${(Number(modalPagamento.totale_iniziale)-Number(modalPagamento.totale_pagato||0)).toFixed(2)}`}
                    value={importoPag} onChange={e=>setImportoPag(e.target.value)}
                    style={{padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',width:'100%',color:'#1a1a1a'}}/>
                  <div style={{fontSize:'11px',color:'#6b7280',marginTop:'4px'}}>Se paghi solo una parte (es. bonifico parziale) la distinta resta &quot;Parziale&quot; col residuo da saldare.</div>
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