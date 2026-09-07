'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

const STATI = ['in_lavorazione','spedita','in_transito','in_consegna','consegnata','in_giacenza','reso_mittente','annullata','non_consegnato']

import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
export default function ReportSpedizioniPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [intest, setIntest] = useState<any>({ nome: '', indirizzo: '', email: '', piva: '', logo_url: null })
  const [filtri, setFiltri] = useState({
    clienteId: '', tipoContratto: '', vettore: '', contratto: '',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    agente: '', provincia: '', stato: '', contrassegno: '', formato: 'PDF',
    suddivisione: '', fatturazione: '', canale: '', statoContrassegno: ''
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[]))
    fetch('/api/staff').then(r=>r.json()).then(d=>setStaff(Array.isArray(d)?d.filter((u:any)=>{const ru=(u.ruolo||'').toLowerCase();return ru!=='cliente'&&ru!=='master'}):[]))
    fetch('/api/reports/intestazione').then(r=>r.json()).then(d=>setIntest(d||{})).catch(()=>{})
    caricaReports()
  }, [])

  async function caricaReports() {
    const res = await fetch('/api/reports/lista?tipo=spedizioni')
    const data = await res.json()
    setReports(Array.isArray(data) ? data : [])
  }

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  // Testo filtri per l'elenco report: token separati da spazio (l'elenco li mostra uno per riga),
  // valori senza spazi interni (underscore) così non si spezzano.
  function filtriTesto(): string {
    const t: string[] = ['periodo=' + (filtri.dal||'') + '→' + (filtri.al||'')]
    if (filtri.clienteId) { const c = clienti.find((x:any)=>x.id===filtri.clienteId); t.push('cliente=' + String(c?.ragione_sociale||filtri.clienteId).replace(/\s+/g,'_')) }
    if (filtri.vettore) t.push('vettore=' + filtri.vettore)
    if (filtri.agente) t.push('agente=' + filtri.agente.replace(/\s+/g,'_'))
    if (filtri.provincia) t.push('provincia=' + filtri.provincia)
    if (filtri.stato) t.push('stato=' + filtri.stato)
    if (filtri.contrassegno) t.push('contrassegno=' + filtri.contrassegno)
    if (filtri.fatturazione) t.push('fatturazione=' + filtri.fatturazione)
    if (filtri.canale) t.push('canale=' + filtri.canale)
    if (filtri.statoContrassegno) t.push('cod=' + filtri.statoContrassegno)
    t.push('suddivisione=' + (filtri.suddivisione||'file_unico'))
    t.push('formato=' + filtri.formato)
    return t.join(' ')
  }

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const j = await inviaReport({ tipo: 'spedizioni', filtri: filtriTesto(), formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    const lista = await fetch('/api/reports/lista?tipo=spedizioni').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.stato) params.set('stato', filtri.stato)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al + 'T23:59:59')
      if (filtri.contrassegno) params.set('contrassegno', filtri.contrassegno)
      if (filtri.provincia) params.set('provincia', filtri.provincia)
      if (filtri.fatturazione) params.set('fatturazione', filtri.fatturazione)
      if (filtri.canale) params.set('canale', filtri.canale)
      if (filtri.statoContrassegno) params.set('statoContrassegno', filtri.statoContrassegno)

      const res = await fetch(`/api/reports/spedizioni?${params}`)
      let spedizioni = await res.json()
      if (filtri.vettore) spedizioni = spedizioni.filter((s:any) => String(s.corrieri?.nome_contratto||'').split(' ')[0] === filtri.vettore)
      if (filtri.agente) spedizioni = spedizioni.filter((s:any) => (s.clienti?.agente||'') === filtri.agente)
      if (!spedizioni.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna spedizione trovata con i filtri selezionati.' }); return }

      const gen = await import('@/lib/report-spedizioni-genera')
      const formato = filtri.formato.toLowerCase() as 'pdf' | 'xlsx' | 'csv'
      const ext = gen.estFormato(formato)
      const periodo = gen.periodoStr(filtri.dal, filtri.al)
      const base = 'report_spedizioni_' + filtri.dal + '_' + filtri.al

      if (!filtri.suddivisione) {
        // FILE UNICO = riepilogo per cliente (come Spedisci.online).
        const agg = gen.aggregaPerCliente(spedizioni)
        const b64 = formato === 'pdf'
          ? await gen.pdfRiepilogoB64(intest, periodo, agg)
          : await gen.excelRiepilogoB64(agg, formato)
        await salvaReport(b64, base + '.' + ext, formato)
      } else {
        // SUDDIVISO = un file di DETTAGLIO per gruppo, raccolti in ZIP.
        const gruppi = gen.raggruppa(spedizioni, filtri.suddivisione as any)
        const { default: JSZip } = await import('jszip' as any)
        const zip = new JSZip()
        let i = 0
        for (const g of gruppi) {
          i++
          const titolo = [g.cliente, g.contratto].filter(Boolean).join(' — ')
          const nome = `${i}_${gen.nomeFileSicuro([g.cliente, g.contratto].filter(Boolean).join('_'))}.${ext}`
          if (formato === 'pdf') {
            const uri = await gen.pdfDettaglioB64(intest, periodo, titolo, g.righe)
            zip.file(nome, uri.split(',')[1], { base64: true })
          } else {
            zip.file(nome, await gen.excelDettaglioB64(g.righe, formato), { base64: true })
          }
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        const suff = filtri.suddivisione === 'cliente' ? 'per_cliente' : filtri.suddivisione === 'contratto' ? 'per_contratto' : 'per_cliente_contratto'
        const nomeZip = `${base}_${suff}.zip`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = nomeZip
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
        const b64 = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob) })
        await salvaReport(b64, nomeZip, 'zip')
      }
    } catch (e:any) {
      await dialog.alert({ title: 'Errore', message: 'Generazione non riuscita: ' + (e?.message || '') })
    } finally {
      setGenerating(false)
    }
  }

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Spedizioni</h1>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px',display:'flex',alignItems:'center',gap:'6px'}}>🔍 Nuovo report</div>

        {/* Riga 1 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Tipo Contratto</label>
            <select value={filtri.tipoContratto} onChange={e=>setF('tipoContratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="credito_scalare">Credito a scalare</option>
              <option value="fattura_mensile">Fattura mensile</option>
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
              {Array.from(new Set(corrieri.map((c:any)=>String(c.nome_contratto||'')))).filter(Boolean).map((v:any)=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Riga 2 */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Agente</label>
            <select value={filtri.agente} onChange={e=>setF('agente',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {staff.map((u:any)=>{const nome=[u.nome,u.cognome].filter(Boolean).join(' ');return <option key={u.id} value={nome}>{nome||u.email||u.id}</option>})}
            </select>
          </div>
          <div><label style={lbl}>Provincia</label>
            <select value={filtri.provincia} onChange={e=>setF('provincia',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              {['AG','AL','AN','AO','AR','AP','AT','AV','BA','BT','BL','BN','BG','BI','BO','BZ','BS','BR','CA','CL','CB','CE','CT','CZ','CH','CO','CS','CR','KR','CN','EN','FM','FE','FI','FG','FC','FR','GE','GO','GR','IM','IS','SP','AQ','LT','LE','LC','LI','LO','LU','MC','MN','MS','MT','ME','MI','MO','MB','NA','NO','NU','OG','OT','OR','PD','PA','PR','PV','PG','PU','PE','PC','PI','PT','PN','PZ','PO','RG','RA','RC','RE','RI','RN','RO','SA','SS','SV','SI','SR','SO','TA','TE','TR','TO','TP','TN','TV','TS','UD','VA','VE','VB','VC','VR','VV','VI','VT'].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {STATI.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
            </select>
          </div>
        </div>

        {/* Riga 3 — filtri nuovi */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Contrassegno</label>
            <select value={filtri.contrassegno} onChange={e=>setF('contrassegno',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="si">Con contrassegno</option>
              <option value="no">Senza contrassegno</option>
            </select>
          </div>
          <div><label style={lbl}>Fatturazione</label>
            <select value={filtri.fatturazione} onChange={e=>setF('fatturazione',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              <option value="si">Fatturate</option>
              <option value="no">Non fatturate</option>
            </select>
          </div>
          <div><label style={lbl}>Canale</label>
            <select value={filtri.canale} onChange={e=>setF('canale',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="portale">Portale</option>
              <option value="api">API</option>
              <option value="Reso">Reso</option>
              <option value="Demo">Demo</option>
            </select>
          </div>
          <div><label style={lbl}>Stato Contrassegno</label>
            <select value={filtri.statoContrassegno} onChange={e=>setF('statoContrassegno',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="in_attesa">In attesa</option>
              <option value="pagato">Pagato</option>
              <option value="in_distinta">In distinta</option>
            </select>
          </div>
        </div>

        {/* Riga 4 — suddivisione + formato */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 3fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Suddivisione</label>
            <select value={filtri.suddivisione} onChange={e=>setF('suddivisione',e.target.value)} style={sel}>
              <option value="">File unico (riepilogo per cliente)</option>
              <option value="cliente">Diviso per cliente (ZIP)</option>
              <option value="contratto">Diviso per contratto (ZIP)</option>
              <option value="cliente_contratto">Diviso per cliente e contratto (ZIP)</option>
            </select>
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
            </select>
          </div>
          <div style={{display:'flex',alignItems:'flex-end'}}>
            <span style={{fontSize:'11px',color:'#666'}}>
              {filtri.suddivisione
                ? 'Un file per ' + (filtri.suddivisione==='cliente'?'cliente':filtri.suddivisione==='contratto'?'contratto':'cliente+contratto') + ', raccolti in ZIP.'
                : 'Riepilogo aggregato per cliente (Spedizioni, Colli, Prezzo, Iva, Totale).'}
            </span>
          </div>
        </div>

        <button onClick={generaReport} disabled={generating}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>

      {/* Lista report generati */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'10px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'12px',fontWeight:'400',color:'#666'}}>
          Mostra{' '}
          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}}
            style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>{' '}elementi
        </div>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead>
            <tr style={{background:'#f9fafb'}}>
              {['ID','Data','Filtri','Formato','Utente','Size','Status','Scarica'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={8} style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessun report generato</td></tr>
            ) : reportsPaginate.map((r:any, i:number) => (
              <tr key={r.id} style={{borderBottom:'1px solid #d1d5db'}}>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'600'}}>{reports.length - ((paginaCorr - 1) * perPage + i)}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>
                  {String(r.filtri||'').split(' ').map((f: string, i: number)=><div key={i}>{f}</div>)}
                </td>
                <td style={{padding:'9px 14px'}}>
                  <span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span>
                </td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'500'}}>{r.utente||'—'}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{r.size_bytes ? `${Math.max(1,Math.round(r.size_bytes/1024))} KB` : '—'}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontSize:'12px',fontWeight:'500'}}>{r.status||'—'}</td>
                <td style={{padding:'9px 14px'}}>
                  {r.file_url
                    ? <a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{color:'#f97316',fontWeight:'600',fontSize:'13px',cursor:'pointer',textDecoration:'none'}}>Scarica</a>
                    : <span style={{color:'#9ca3af',fontSize:'12px'}}>non conservato</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
          <span style={{fontSize:'12px',color:'#666'}}>{reports.length===0?0:((paginaCorr-1)*perPage+1)}-{Math.min(paginaCorr*perPage,reports.length)} di {reports.length}</span>
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
      </div>
    </div>
  )
}
