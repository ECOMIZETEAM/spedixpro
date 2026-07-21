'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'

function oreRestanti(richiestoAt: string): { txt: string; pronto: boolean } {
  const scad = new Date(richiestoAt).getTime() + 48 * 60 * 60 * 1000
  const diff = scad - Date.now()
  if (diff <= 0) return { txt: 'invio in corso…', pronto: true }
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return { txt: `invio al corriere tra ${h}h ${m}m`, pronto: false }
}

import { useDialog } from '@/app/components/DialogProvider'
// Default: ultimi 60 giorni di annullate (le code pending/manuali restano complete: sono attive e
// poche). Prima si scaricavano e arricchivano TUTTE le annullate di sempre -> pagina sempre piu' lenta.
const _oggiC = new Date().toISOString().slice(0, 10)
const _da60C = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
export default function SpedizioniCancellatePage() {
  const dialog = useDialog()
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [manuali, setManuali] = useState<any[]>([])   // annullo manuale in sola lettura (nel mio ambito)
  const [codaOwner, setCodaOwner] = useState<any[]>([]) // annulli Spedisci che DEVO richiedere io (detentore)
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [dal, setDal] = useState(_da60C)
  const [al, setAl] = useState(_oggiC)
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [paginaPending, setPaginaPending] = useState(1)   // paginazione sezione "in attesa di annullo"
  const [ripristinando, setRipristinando] = useState<string | null>(null)
  const [confermando, setConfermando] = useState<string | null>(null)

  function carica() {
    Promise.all([
      fetch(`/api/spedizioni/lista?stato=annullata${dal ? '&dal=' + dal : ''}${al ? '&al=' + al + 'T23:59:59' : ''}`).then(r => r.json()),
      fetch('/api/spedizioni/lista?stato=annullamento_pending').then(r => r.json()),
      fetch('/api/spedizioni/lista?stato=annullamento_manuale').then(r => r.json()),
      fetch('/api/spedizioni/annulli-manuali').then(r => r.json()),
    ]).then(([ann, pen, man, coda]) => {
      setSpedizioni(Array.isArray(ann) ? ann : [])
      setPending(Array.isArray(pen) ? pen : [])
      setManuali(Array.isArray(man) ? man : [])
      setCodaOwner(Array.isArray(coda) ? coda : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { carica() }, [dal, al])

  async function ripristina(id: string) {
    if (!await dialog.confirm({ title: 'Ripristinare la spedizione?', message: 'Non verrà inviato nessun annullo al corriere.', confirmText: 'Ripristina' })) return
    setRipristinando(id)
    const res = await fetch(`/api/spedizioni/ripristina?id=${id}`, { method: 'POST' })
    setRipristinando(null)
    if (res.ok) carica()
    else { const d = await res.json().catch(() => ({})); await dialog.alert({ title: 'Errore', message: d.error || 'Errore durante il ripristino.' }) }
  }

  async function confermaAnnullo(id: string) {
    if (!await dialog.confirm({ title: 'Confermi l\'annullo eseguito?', message: 'Confermi che l\'annullo è stato eseguito con il corriere (Spedisci)? La spedizione passerà ad annullata e il credito verrà stornato.', confirmText: 'Conferma' })) return
    setConfermando(id)
    const res = await fetch(`/api/spedizioni/annulli-manuali/conferma?id=${id}`, { method: 'POST' })
    setConfermando(null)
    if (res.ok) carica()
    else { const d = await res.json().catch(() => ({})); await dialog.alert({ title: 'Errore', message: d.error || 'Errore durante la conferma.' }) }
  }

  const ownerIds = new Set(codaOwner.map(s => s.id))
  const manualiAltri = manuali.filter(s => !ownerIds.has(s.id))  // manuali non miei (sola lettura)

  // Elenco clienti presenti in TUTTA la pagina (pending + manuali + annullate) per il filtro a tendina
  const clientiFiltro = Array.from(new Set(
    [...spedizioni, ...pending, ...manualiAltri, ...codaOwner].map(s => s.clienti?.ragione_sociale).filter(Boolean)
  )).sort()

  function passaFiltri(s: any) {
    if (filtroCliente && (s.clienti?.ragione_sociale || '') !== filtroCliente) return false
    const data = new Date(s.updated_at || s.created_at || s.annullamento_richiesto_at)
    if (dal && data < new Date(dal + 'T00:00:00')) return false
    if (al && data > new Date(al + 'T23:59:59')) return false
    if (cerca) {
      const q = cerca.toLowerCase()
      return (s.numero?.toLowerCase().includes(q) ||
        s.dest_nome?.toLowerCase().includes(q) ||
        s.dest_citta?.toLowerCase().includes(q) ||
        s.clienti?.ragione_sociale?.toLowerCase().includes(q)) || false
    }
    return true
  }
  // I filtri agiscono su tutte le sezioni della pagina
  const visibili = spedizioni.filter(passaFiltri)
  const pendingVis = pending.filter(passaFiltri)
  const manualiVis = manualiAltri.filter(passaFiltri)
  const filtriAttivi = !!(filtroCliente || dal || al || cerca)

  const totalePagine = Math.max(1, Math.ceil(visibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const visibiliPaginate = visibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  // Sezione "in attesa di annullo": pending + manuali insieme, paginati 10 per pagina.
  const PENDING_PER_PAGE = 10
  const pendingCombinati = [
    ...pendingVis.map((s: any) => ({ s, tipo: 'p' as const })),
    ...manualiVis.map((s: any) => ({ s, tipo: 'm' as const })),
  ]
  const totPagPending = Math.max(1, Math.ceil(pendingCombinati.length / PENDING_PER_PAGE))
  const pagPendingCorr = Math.min(paginaPending, totPagPending)
  const pendingPaginati = pendingCombinati.slice((pagPendingCorr - 1) * PENDING_PER_PAGE, pagPendingCorr * PENDING_PER_PAGE)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <a href="/dashboard/spedizioni" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>{'←'} Lista Spedizioni</a>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Spedizioni Cancellate</h1>
        </div>
      </div>

      {/* FILTRI (sulla sezione Annullate) */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px',display:'flex',alignItems:'center',gap:'6px'}}>
          <span>▽</span> Filtri
        </div>
        <div style={{display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={{minWidth:'180px',flex:'1 1 180px'}}>
            <label style={{fontSize:'11px',fontWeight:'600',color:'#999',textTransform:'uppercase',letterSpacing:'0.4px',display:'block',marginBottom:'4px'}}>Cliente</label>
            <select value={filtroCliente} onChange={e=>{setFiltroCliente(e.target.value);setPagina(1)}}
              style={{padding:'8px 10px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',width:'100%',boxSizing:'border-box'}}>
              <option value="">Tutti i clienti</option>
              {clientiFiltro.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{flex:'0 0 auto'}}>
            <label style={{fontSize:'11px',fontWeight:'600',color:'#999',textTransform:'uppercase',letterSpacing:'0.4px',display:'block',marginBottom:'4px'}}>Periodo</label>
            <DateRangePicker dal={dal} al={al} onChange={(d,a)=>{setDal(d);setAl(a);setPagina(1)}}/>
          </div>
          <div style={{minWidth:'200px',flex:'1 1 200px'}}>
            <label style={{fontSize:'11px',fontWeight:'600',color:'#999',textTransform:'uppercase',letterSpacing:'0.4px',display:'block',marginBottom:'4px'}}>Cerca</label>
            <input value={cerca} onChange={e=>{setCerca(e.target.value);setPagina(1)}} placeholder="N. spedizione, destinatario, città..."
              style={{padding:'8px 10px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',width:'100%',color:'#1a1a1a',background:'#fff',boxSizing:'border-box'}}/>
          </div>
          {filtriAttivi && (
            <button onClick={()=>{setFiltroCliente('');setDal('');setAl('');setCerca('');setPagina(1)}}
              style={{padding:'8px 14px',background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Azzera</button>
          )}
        </div>
      </div>

      {/* CODA DETENTORE: annulli Spedisci da richiedere via assistenza (solo il detentore del contratto) */}
      {codaOwner.length > 0 && (
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #fca5a5',overflow:'hidden',marginBottom:'16px'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #fecaca',background:'#fef2f2'}}>
            <span style={{fontSize:'13px',fontWeight:'700',color:'#b91c1c'}}>Annulli da richiedere a Spedisci (assistenza) <span style={{color:'#991b1b',fontWeight:'400',fontSize:'12px'}}>({codaOwner.length})</span></span>
            <span style={{display:'block',marginTop:'2px',fontSize:'12px',color:'#991b1b'}}>Queste spedizioni Spedisci non si annullano via API: richiedi l'annullo all'assistenza (WhatsApp) usando numero e tracking, poi premi "Segna annullato".</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <tbody>
                {codaOwner.map(s => (
                  <tr key={s.id} style={{borderBottom:'1px solid #fee2e2'}}>
                    <td style={{padding:'9px 16px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:'#666',fontSize:'12px'}}>Tracking: {s.tracking_number || '—'}</td>
                    <td style={{padding:'9px 12px',color:'#666',fontSize:'12px'}}>{s.corrieri?.nome_contratto || 'Spedisci'}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_nome} · {s.dest_citta}</td>
                    <td style={{padding:'9px 16px',textAlign:'right'}}>
                      <button onClick={()=>confermaAnnullo(s.id)} disabled={confermando===s.id}
                        style={{padding:'6px 12px',background:'#b91c1c',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:confermando===s.id?0.6:1}}>
                        {confermando===s.id?'…':'Segna annullato'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SEZIONE PENDING (in attesa di annullo, 48h) + annulli manuali in gestione */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #fed7aa',overflow:'hidden',marginBottom:'16px'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #fde4cf',background:'#fff7ed'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#ea580c'}}>In attesa di annullo <span style={{color:'#9a3412',fontWeight:'400',fontSize:'12px'}}>({pendingVis.length + manualiVis.length})</span></span>
          <span style={{display:'block',marginTop:'2px',fontSize:'12px',color:'#9a3412'}}>La richiesta di annullo viene inviata al corriere dopo 48 ore. Entro questo tempo puoi ripristinare la spedizione.</span>
        </div>
        {loading ? (
          <div style={{padding:'20px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento…</div>
        ) : (!pendingVis.length && !manualiVis.length) ? (
          <div style={{padding:'20px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna spedizione in attesa di annullo.</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <tbody>
                {pendingPaginati.map(({s, tipo}) => tipo === 'p' ? (
                  (() => {
                    const c = s.annullamento_richiesto_at ? oreRestanti(s.annullamento_richiesto_at) : { txt:'', pronto:false }
                    return (
                      <tr key={s.id} style={{borderBottom:'1px solid #fdece0'}}>
                        <td style={{padding:'9px 16px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                        <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.clienti?.ragione_sociale || '-'}</td>
                        <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_nome} · {s.dest_citta}</td>
                        <td style={{padding:'9px 12px',color:'#ea580c',fontSize:'12px',whiteSpace:'nowrap'}}>{c.txt}</td>
                        <td style={{padding:'9px 16px',textAlign:'right'}}>
                          <button onClick={()=>ripristina(s.id)} disabled={ripristinando===s.id}
                            style={{padding:'6px 12px',background:'#fff',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',opacity:ripristinando===s.id?0.6:1}}>
                            {ripristinando===s.id?'…':'Ripristina'}
                          </button>
                        </td>
                      </tr>
                    )
                  })()
                ) : (
                  <tr key={s.id} style={{borderBottom:'1px solid #fdece0'}}>
                    <td style={{padding:'9px 16px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.clienti?.ragione_sociale || '-'}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_nome} · {s.dest_citta}</td>
                    <td style={{padding:'9px 12px',color:'#9a3412',fontSize:'12px',whiteSpace:'nowrap'}} colSpan={2}>In gestione con il corriere (assistenza)</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totPagPending > 1 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',padding:'12px'}}>
                <button onClick={()=>setPaginaPending(p=>Math.max(1,p-1))} disabled={pagPendingCorr<=1}
                  style={{padding:'5px 10px',border:'1px solid #fed7aa',background:'#fff',color:'#ea580c',borderRadius:'6px',fontSize:'12px',cursor:pagPendingCorr<=1?'default':'pointer',opacity:pagPendingCorr<=1?0.5:1}}>‹</button>
                <span style={{fontSize:'12px',color:'#9a3412'}}>Pagina {pagPendingCorr} di {totPagPending}</span>
                <button onClick={()=>setPaginaPending(p=>Math.min(totPagPending,p+1))} disabled={pagPendingCorr>=totPagPending}
                  style={{padding:'5px 10px',border:'1px solid #fed7aa',background:'#fff',color:'#ea580c',borderRadius:'6px',fontSize:'12px',cursor:pagPendingCorr>=totPagPending?'default':'pointer',opacity:pagPendingCorr>=totPagPending?0.5:1}}>›</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Annullate <span style={{color:'#666',fontWeight:'400',fontSize:'12px'}}>({visibili.length})</span></span>
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
          <span style={{fontSize:'12px',color:'#666'}}>{visibili.length} risultati</span>
        </div>

        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontWeight:'500'}}>Nessuna spedizione annullata</div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  {['N. Spedizione','Cliente','Destinatario','Citta','CAP','Peso','Colli','Data','Totale'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase',letterSpacing:'0.4px',color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibiliPaginate.map(s => (
                  <tr key={s.id} style={{borderBottom:'1px solid #eee'}}>
                    <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.clienti?.ragione_sociale || '-'}</td>
                    <td style={{padding:'9px 12px'}}>
                      <div style={{color:'#1a1a1a',fontWeight:'500'}}>{s.dest_nome}</div>
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_citta} {s.dest_provincia && `(${s.dest_provincia})`}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_cap}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.peso_reale}kg</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.colli}</td>
                    <td style={{padding:'9px 12px',color:'#666',fontSize:'12px',whiteSpace:'nowrap'}}>{new Date(s.updated_at || s.created_at).toLocaleDateString('it-IT')} {new Date(s.updated_at || s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>{'€'} {Number(s.costo_totale||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalePagine > 0 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>
                <span style={{fontSize:'12px',color:'#666'}}>{(paginaCorr - 1) * perPage + 1}-{Math.min(paginaCorr * perPage, visibili.length)} di {visibili.length}</span>
                <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                  <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
                  {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(
                    <span key={n} style={{display:'flex',alignItems:'center'}}>
                      {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>{'…'}</span>}
                      <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>
                    </span>
                  ))}
                  <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
