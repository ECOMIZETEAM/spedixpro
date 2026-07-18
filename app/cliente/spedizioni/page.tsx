'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import AssistenzaTicketButton from '@/app/components/AssistenzaTicketButton'
import DettaglioSpedizione from '@/app/components/DettaglioSpedizione'
import { fmtPeso } from '@/lib/peso'

const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'3px'}

const STATI: Record<string,{bg:string,color:string,label:string}> = {
  in_lavorazione:{bg:'#fefce8',color:'#ca8a04',label:'In Lavorazione'},   // giallo
  spedita:{bg:'#f0f9ff',color:'#0284c7',label:'Spedita'},                 // celeste
  in_transito:{bg:'#eff6ff',color:'#2563eb',label:'In transito'},         // blu
  in_consegna:{bg:'#fff7ed',color:'#ea580c',label:'In Consegna'},         // arancio
  consegnata:{bg:'#f0fdf4',color:'#16a34a',label:'Consegnata'},           // verde
  in_giacenza:{bg:'#fef2f2',color:'#dc2626',label:'In Giacenza'},         // rosso
  reso_mittente:{bg:'#f3f4f6',color:'#374151',label:'Reso al mittente'},  // grigio scuro
  annullamento_pending:{bg:'#fff7ed',color:'#ea580c',label:'In annullamento'}, // arancio (48h, ripristinabile)
  annullamento_manuale:{bg:'#fef2f2',color:'#b91c1c',label:'Annullo in corso'}, // rosso
  annullata:{bg:'#f5f5f5',color:'#6b7280',label:'Annullata'},             // grigio
  non_consegnato:{bg:'#f3f4f6',color:'#6b7280',label:'Non consegnato'},   // grigio
}

function oreAllAnnullo(richiestoAt?: string): string {
  if (!richiestoAt) return ''
  const diff = new Date(richiestoAt).getTime() + 48*3600*1000 - Date.now()
  if (diff <= 0) return 'invio in corso…'
  const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000)
  return `tra ${h}h ${m}m`
}

// Colore badge contrassegno in base allo stato di pagamento:
// grigio = da pagare, arancione = distinta caricata, verde = pagato
function codBadgeStyle(stato?: string) {
  if (stato === 'pagato') return { background:'#dcfce7', color:'#166534' }   // verde
  if (stato === 'in_distinta') return { background:'#ffedd5', color:'#c2410c' } // arancione
  return { background:'#e5e7eb', color:'#4b5563' }                            // grigio
}

const FILTRI_DEFAULT = {
  clienteId:'', negozio:'', vettore:'', contratto:'', stato:'', id_ordine:'',
  numero:'', dal:'', al:'', contrassegno:'', stato_contrassegni:'',
  assicurazione:'', dest_citta:'', dest_cap:'', contenuto:'', fatturato:'', agente:''
}

import { useDialog } from '@/app/components/DialogProvider'
export default function SpedizioniPage() {
  const dialog = useDialog()
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [spedizioniFiltrate, setSpedizioniFiltrate] = useState<any[]>([])
  const [notifica, setNotifica] = useState<string>('')
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [trackingModal, setTrackingModal] = useState<any>(null)
  const [trackingData, setTrackingData] = useState<any>(null)
  const [dettaglio, setDettaglio] = useState<any>(null)
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [trackingTab, setTrackingTab] = useState<'tracking'|'colli'>('tracking')
  const [eliminando, setEliminando] = useState<string|null>(null)
  const [filtri, setFiltri] = useState(FILTRI_DEFAULT)
  // Stampa ZPL/Zebra SOLO se il cliente l'ha attivata in Impostazioni → Stampa (zpl_abilita).
  // Altrimenti: PDF normale (scaricabile). Default OFF, così nessuno resta bloccato.
  const [zplOn, setZplOn] = useState(false)
  useEffect(() => {
    fetch('/api/cliente/dati').then(r=>r.json()).then(d=>{ setZplOn(d?.impostazioni?.zpl_abilita === 'si') }).catch(()=>{})
  }, [])

  // Ricarica dal server al cambio di N. Spedizione / intervallo date.
  // Cercando per N. Spedizione la ricerca va su TUTTO lo storico (ignora la data).
  useEffect(() => {
    const num = (filtri.numero || '').trim()
    const t = setTimeout(() => { caricaTutte() }, num ? 350 : 0)
    return () => clearTimeout(t)
  }, [filtri.numero, filtri.dal, filtri.al])

  // Filtri reattivi: appena tocchi un filtro, la lista si aggiorna (niente bottone "Filtra")
  useEffect(() => { applicaFiltri(); setPagina(1) }, [filtri, spedizioni])

  async function caricaTutte() {
    setLoading(true)
    const q = new URLSearchParams()
    const num = (filtri.numero || '').trim()
    if (num) {
      q.set('numero', num)   // ricerca su tutto lo storico, niente filtro data
    } else {
      if (filtri.dal) q.set('dal', filtri.dal)
      if (filtri.al) q.set('al', filtri.al + 'T23:59:59')
    }
    const res = await fetch('/api/spedizioni/lista' + (q.toString() ? '?' + q.toString() : ''))
    const data = await res.json()
    setSpedizioni(Array.isArray(data) ? data : [])
    setSpedizioniFiltrate(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  function applicaFiltri() {
    let filtered = [...spedizioni]
    if (filtri.clienteId) filtered = filtered.filter(s => s.cliente_id === filtri.clienteId)
    if (filtri.stato) filtered = filtered.filter(s => s.stato === filtri.stato)
    if (filtri.numero) filtered = filtered.filter(s => s.numero?.toLowerCase().includes(filtri.numero.toLowerCase()))
    if (filtri.id_ordine) filtered = filtered.filter(s => (s.id_ordine||'').toLowerCase().includes(filtri.id_ordine.toLowerCase()))
    if (!filtri.numero) {   // cercando per N. Spedizione si ignora la data
      if (filtri.dal) filtered = filtered.filter(s => new Date(s.created_at) >= new Date(filtri.dal))
      if (filtri.al) filtered = filtered.filter(s => new Date(s.created_at) <= new Date(filtri.al+'T23:59:59'))
    }
    if (filtri.contrassegno==='si') filtered = filtered.filter(s => Number(s.contrassegno)>0)
    if (filtri.contrassegno==='no') filtered = filtered.filter(s => Number(s.contrassegno)===0)
    if (filtri.stato_contrassegni==='da_pagare') filtered = filtered.filter(s => Number(s.contrassegno)>0 && s.stato_contrassegno!=='in_distinta' && s.stato_contrassegno!=='pagato')
    if (filtri.stato_contrassegni==='in_attesa') filtered = filtered.filter(s => s.stato_contrassegno==='in_distinta')
    if (filtri.stato_contrassegni==='pagato') filtered = filtered.filter(s => s.stato_contrassegno==='pagato')
    if (filtri.dest_citta) filtered = filtered.filter(s => s.dest_citta?.toLowerCase().includes(filtri.dest_citta.toLowerCase()))
    if (filtri.dest_cap) filtered = filtered.filter(s => s.dest_cap?.includes(filtri.dest_cap))
    if (filtri.contenuto) filtered = filtered.filter(s => s.contenuto?.toLowerCase().includes(filtri.contenuto.toLowerCase()))
    if (filtri.contratto) filtered = filtered.filter(s => String(s.corrieri?.nome_contratto||'') === filtri.contratto)
    if (filtri.vettore) filtered = filtered.filter(s => String(s.corrieri?.nome_contratto||'').split(' ')[0].toUpperCase() === filtri.vettore)
    if (filtri.assicurazione==='si') filtered = filtered.filter(s => Number(s.assicurazione)>0)
    if (filtri.assicurazione==='no') filtered = filtered.filter(s => !(Number(s.assicurazione)>0))
    if (filtri.fatturato==='si') filtered = filtered.filter(s => !!s.fatturato)
    if (filtri.fatturato==='no') filtered = filtered.filter(s => !s.fatturato)
    if (filtri.negozio) filtered = filtered.filter(s => String(s.canale||'') === filtri.negozio)
    setSpedizioniFiltrate(filtered)
  }

  const spedizioniVisibili = cerca
    ? spedizioniFiltrate.filter(s =>
        s.numero?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.mitt_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.tracking_number?.toLowerCase().includes(cerca.toLowerCase())
      )
    : spedizioniFiltrate

  const totalePagine = Math.max(1, Math.ceil(spedizioniVisibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const spedizioniPaginate = spedizioniVisibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  // Opzioni Vettore/Contratto/Negozio dai corrieri realmente presenti nelle spedizioni
  const vettoriPresenti = Array.from(new Set((spedizioni||[]).map((s:any)=>String(s.corrieri?.nome_contratto||'').split(' ')[0].toUpperCase()).filter(Boolean))).sort()
  const contrattiPresenti = Array.from(new Set((spedizioni||[]).map((s:any)=>s.corrieri?.nome_contratto).filter(Boolean))).sort()
  const negoziPresenti = Array.from(new Set((spedizioni||[]).map((s:any)=>s.canale).filter(Boolean))).sort()

  function toggleSelect(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])
  }

  function toggleAll() {
    if (selectedIds.length===spedizioniPaginate.length) setSelectedIds([])
    else setSelectedIds(spedizioniPaginate.map(s=>s.id))
  }

  const [stampandoId, setStampandoId] = useState('')
  // Scarica l'etichetta come file sul PC (PDF o immagine), con messaggio chiaro se non è pronta.
  async function scaricaEtichetta(id: string) {
    const url = `/api/spedizioni/etichetta?id=${id}`
    setStampandoId(id)
    try {
      const r = await fetch(url)
      if (!r.ok) { const j = await r.json().catch(()=>null); setNotifica(j?.error || 'Etichetta non disponibile'); return }
      const blob = await r.blob()
      const ct = r.headers.get('content-type') || ''
      const ext = ct.includes('gif') ? 'gif' : ct.includes('png') ? 'png' : 'pdf'
      // Nome file dal server (etichetta-{numero spedizione}); fallback all'id se assente.
      const cd = r.headers.get('content-disposition') || ''
      const fname = (cd.match(/filename="?([^"]+)"?/)?.[1]) || `etichetta-${id}.${ext}`
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = objUrl; a.download = fname
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000)
    } catch { setNotifica('Errore nel download etichetta') }
    finally { setStampandoId(''); setTimeout(() => setNotifica(''), 4000) }
  }
  async function stampaEtichetta(id: string) {
    const url = `/api/spedizioni/etichetta?id=${id}`
    // Senza ZPL attivo: SCARICA il PDF sul PC (niente apertura tab).
    if (!zplOn) { await scaricaEtichetta(id); return }
    setStampandoId(id)
    try {
      const { stampaEtichettaZebra } = await import('@/lib/zebra-print')
      await stampaEtichettaZebra(url)
      setNotifica('🖨️ Etichetta inviata alla stampante Zebra.')
    } catch (e: any) {
      setNotifica((e?.message || 'Stampa Zebra non disponibile') + ' — apro il PDF.')
      window.open(url, '_blank')
    } finally { setStampandoId(''); setTimeout(() => setNotifica(''), 4000) }
  }
  async function stampaZebraSelezionati() {
    if (!selectedIds.length) return
    // Senza ZPL attivo: PDF unico (scaricabile), niente Zebra.
    if (!zplOn) { await stampaSelezionati(); return }
    setNotifica('🖨️ Invio ' + selectedIds.length + ' etichette alla Zebra…')
    try {
      const { stampaEtichetteZebra } = await import('@/lib/zebra-print')
      const r = await stampaEtichetteZebra(selectedIds.map(id => `/api/spedizioni/etichetta?id=${id}`))
      setNotifica(`🖨️ Zebra: ${r.ok} stampate${r.errori ? ', ' + r.errori + ' errori' : ''}.`)
    } catch (e: any) {
      setNotifica((e?.message || 'Stampa Zebra non disponibile') + ' — scarico il PDF.')
      await stampaSelezionati()
    }
    setTimeout(() => setNotifica(''), 4000)
  }
    async function stampaSelezionati() {
    if (!selectedIds.length) return
    const res = await fetch('/api/spedizioni/etichette-bulk', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ ids: selectedIds })
    })
    if (!res.ok) { await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del PDF delle etichette.' }); return }
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

  async function ripristina(id: string, numero: string) {
    if (!await dialog.confirm({ title: 'Ripristinare la spedizione?', message: `Spedizione ${numero}. Non verrà inviato alcun annullo al corriere.`, confirmText: 'Ripristina' })) return
    setEliminando(id)
    const res = await fetch(`/api/spedizioni/ripristina?id=${id}`, { method: 'POST' })
    setEliminando(null)
    if (res.ok) { setNotifica('Spedizione ripristinata.'); caricaTutte() }
    else { const d = await res.json().catch(()=>({})); setNotifica(d.error || 'Errore durante il ripristino') }
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setNotifica(''), 4000)
  }

  async function elimina(id: string, numero: string) {
    if (!await dialog.confirm({ title: `Cancellare la spedizione ${numero}?`, message: 'Resta in elenco come "In annullamento" e potrai ripristinarla; la richiesta di annullo viene inviata al corriere dopo 48 ore.', danger: true, confirmText: 'Cancella' })) return
    setEliminando(id)
    const res = await fetch(`/api/spedizioni/elimina?id=${id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    setEliminando(null)
    if (res.ok && j.success) {
      setNotifica(j.message || 'Annullamento programmato: resta in elenco come "In annullamento", puoi ripristinarla.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      caricaTutte()
    } else {
      setNotifica('Impossibile eliminare la spedizione. Hai bisogno del permesso per eseguire questa azione!')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setTimeout(() => setNotifica(''), 4000)
  }

  const btnFiltri = {padding:'7px 18px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700' as const,cursor:'pointer',whiteSpace:'nowrap' as const}

  return (
    <div>
      {notifica && (
        <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {notifica}</div>
      )}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px',flexWrap:'wrap',gap:'10px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Lista Spedizioni</h1>
        <a href="/cliente/spedizioni/nuova" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuova Spedizione</a>
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
              {negoziPresenti.map((n:any)=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {vettoriPresenti.map((v:any)=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {contrattiPresenti.filter((n:any)=>!filtri.vettore || String(n||'').split(' ')[0].toUpperCase()===filtri.vettore).map((n:any)=><option key={n} value={n}>{n}</option>)}
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
              <option value="da_pagare">Da pagare</option>
              <option value="in_attesa">In attesa</option>
              <option value="pagato">Pagato</option>
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
            <button onClick={()=>setFiltri(FILTRI_DEFAULT)} style={btnFiltri}>Azzera filtri</button>
          </div>
        </div>
      </div>

      {/* TABELLA */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
          <div className="gruppo-titolo-selettore">
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>📋 Spedizioni <span style={{color:'#1a1a1a',fontWeight:'400',fontSize:'12px'}}>({spedizioniVisibili.length} risultati)</span></span>
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
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <button onClick={stampaZebraSelezionati} disabled={selectedIds.length===0}
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
                    <input type="checkbox" checked={selectedIds.length===spedizioniPaginate.length&&spedizioniPaginate.length>0} onChange={toggleAll}/>
                  </th>
                  {['N. Spedizione','Cliente','Destinatario','Corriere','Peso','Colli','Contrassegno','Data e Ora','Stato','ID Ordine','Totale','Distinta N.','Azioni'].map(h=>(
                    <th key={h} style={{textAlign:'left' as const,padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,letterSpacing:'0.4px',color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap' as const}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spedizioniPaginate.map(s => {
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
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.corrieri?.nome_contratto||'—'}</td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{fmtPeso(s)}</td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.colli}</td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a'}}>
                        {Number(s.contrassegno)>0
                          ? <span style={{...codBadgeStyle(s.stato_contrassegno),padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>€{Number(s.contrassegno).toFixed(2)}</span>
                          : '—'}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px',whiteSpace:'nowrap' as const}}>
                        {new Date(s.created_at).toLocaleDateString('it-IT')} {new Date(s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <span style={{background:st.bg,color:st.color,padding:'3px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600',whiteSpace:'nowrap' as const}}>{st.label}</span>
                        {s.stato==='annullamento_pending' && <div style={{fontSize:'10px',color:'#ea580c',marginTop:'3px',whiteSpace:'nowrap' as const}}>invio corriere {oreAllAnnullo(s.annullamento_richiesto_at)}</div>}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.id_ordine||'—'}</td>
                      <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>
                        € {Number(s.costo_totale||0).toFixed(2)}
                        {Number(s.contrassegno)>0&&<span style={{color:'#dc2626',fontSize:'10px',marginLeft:'3px'}}>R</span>}
                      </td>
                      <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>—</td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{display:'flex',gap:'4px'}}>
                          <button onClick={()=>stampaEtichetta(s.id)} disabled={stampandoId===s.id}
                            style={{padding:'4px 8px',background:'#fff7ed',color:'#ea580c',borderRadius:'4px',fontSize:'14px',border:'1px solid #fed7aa',cursor:'pointer'}} title={zplOn?'Stampa etichetta su Zebra (ZPL)':'Scarica etichetta PDF'}>{stampandoId===s.id?'⏳':'🖨️'}</button>
                          <button onClick={()=>setDettaglio(s)} title="Vedi dettagli spedizione" style={{padding:'4px 8px',background:'#eff6ff',color:'#2563eb',borderRadius:'4px',fontSize:'14px',border:'1px solid #bfdbfe',cursor:'pointer'}}>👁</button>
                  
                          {s.stato==='annullamento_pending' ? (
                            <button onClick={()=>ripristina(s.id,s.numero)} disabled={eliminando===s.id}
                              style={{padding:'4px 10px',background:'#fff7ed',color:'#ea580c',borderRadius:'4px',fontSize:'12px',fontWeight:'700',border:'1px solid #fed7aa',cursor:'pointer',whiteSpace:'nowrap',opacity:eliminando===s.id?0.5:1}} title="Ripristina spedizione">↩︎ Ripristina</button>
                          ) : (
                            <button onClick={()=>elimina(s.id,s.numero)} disabled={eliminando===s.id}
                              style={{padding:'4px 8px',background:'#fef2f2',color:'#dc2626',borderRadius:'4px',fontSize:'14px',border:'1px solid #fecaca',cursor:'pointer',opacity:eliminando===s.id?0.5:1}} title="Elimina">🗑️</button>
                          )}
                          <AssistenzaTicketButton ldv={s.numero} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* barra-paginazione */}
            {totalePagine > 0 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
                <span style={{fontSize:'12px',color:'#666'}}>
                  {(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, spedizioniVisibili.length)} di {spedizioniVisibili.length}
                </span>
                <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                  <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1}
                    style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
                  {Array.from({length: totalePagine}, (_,i)=>i+1)
                    .filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2)
                    .map((n,idx,arr)=>(
                      <span key={n} style={{display:'flex',alignItems:'center'}}>
                        {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>…</span>}
                        <button onClick={()=>setPagina(n)}
                          style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
                      </span>
                    ))}
                  <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine}
                    style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
                </div>
              </div>
            )}
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

      {dettaglio && <DettaglioSpedizione s={dettaglio} onClose={()=>setDettaglio(null)} etichettaHref={`/api/spedizioni/etichetta?id=${dettaglio.id}`} />}
    </div>
  )
}