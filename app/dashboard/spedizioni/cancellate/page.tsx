'use client'
import { useState, useEffect } from 'react'

function oreRestanti(richiestoAt: string): { txt: string; pronto: boolean } {
  const scad = new Date(richiestoAt).getTime() + 48 * 60 * 60 * 1000
  const diff = scad - Date.now()
  if (diff <= 0) return { txt: 'invio in corso…', pronto: true }
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return { txt: `invio al corriere tra ${h}h ${m}m`, pronto: false }
}

export default function SpedizioniCancellatePage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [manuali, setManuali] = useState<any[]>([])   // annullo manuale in sola lettura (nel mio ambito)
  const [codaOwner, setCodaOwner] = useState<any[]>([]) // annulli Spedisci che DEVO richiedere io (detentore)
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  const [ripristinando, setRipristinando] = useState<string | null>(null)
  const [confermando, setConfermando] = useState<string | null>(null)

  function carica() {
    Promise.all([
      fetch('/api/spedizioni/lista?stato=annullata').then(r => r.json()),
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
  useEffect(() => { carica() }, [])

  async function ripristina(id: string) {
    if (!confirm('Ripristinare questa spedizione? Non verrà inviato nessun annullo al corriere.')) return
    setRipristinando(id)
    const res = await fetch(`/api/spedizioni/ripristina?id=${id}`, { method: 'POST' })
    setRipristinando(null)
    if (res.ok) carica()
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'Errore ripristino') }
  }

  async function confermaAnnullo(id: string) {
    if (!confirm('Confermi che l\'annullo è stato eseguito con il corriere (Spedisci)? La spedizione passerà ad annullata e il credito verrà stornato.')) return
    setConfermando(id)
    const res = await fetch(`/api/spedizioni/annulli-manuali/conferma?id=${id}`, { method: 'POST' })
    setConfermando(null)
    if (res.ok) carica()
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'Errore conferma') }
  }

  const ownerIds = new Set(codaOwner.map(s => s.id))
  const manualiAltri = manuali.filter(s => !ownerIds.has(s.id))  // manuali non miei (sola lettura)

  // Elenco clienti presenti tra le annullate (per il filtro a tendina)
  const clientiFiltro = Array.from(new Set(spedizioni.map(s => s.clienti?.ragione_sociale).filter(Boolean))).sort()

  const visibili = spedizioni.filter(s => {
    if (filtroCliente && (s.clienti?.ragione_sociale || '') !== filtroCliente) return false
    if (cerca) {
      const q = cerca.toLowerCase()
      return s.numero?.toLowerCase().includes(q) ||
        s.dest_nome?.toLowerCase().includes(q) ||
        s.dest_citta?.toLowerCase().includes(q) ||
        s.clienti?.ragione_sociale?.toLowerCase().includes(q)
    }
    return true
  })

  const totalePagine = Math.max(1, Math.ceil(visibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const visibiliPaginate = visibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <a href="/dashboard/spedizioni" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>{'←'} Lista Spedizioni</a>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Spedizioni Cancellate</h1>
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
          <span style={{fontSize:'13px',fontWeight:'700',color:'#ea580c'}}>In attesa di annullo <span style={{color:'#9a3412',fontWeight:'400',fontSize:'12px'}}>({pending.length + manualiAltri.length})</span></span>
          <span style={{display:'block',marginTop:'2px',fontSize:'12px',color:'#9a3412'}}>La richiesta di annullo viene inviata al corriere dopo 48 ore. Entro questo tempo puoi ripristinare la spedizione.</span>
        </div>
        {loading ? (
          <div style={{padding:'20px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento…</div>
        ) : (!pending.length && !manualiAltri.length) ? (
          <div style={{padding:'20px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna spedizione in attesa di annullo.</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <tbody>
                {pending.map(s => {
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
                })}
                {manualiAltri.map(s => (
                  <tr key={s.id} style={{borderBottom:'1px solid #fdece0'}}>
                    <td style={{padding:'9px 16px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.clienti?.ragione_sociale || '-'}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_nome} · {s.dest_citta}</td>
                    <td style={{padding:'9px 12px',color:'#9a3412',fontSize:'12px',whiteSpace:'nowrap'}} colSpan={2}>In gestione con il corriere (assistenza)</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'600'}}>Cliente:</span>
              <select value={filtroCliente} onChange={e=>{setFiltroCliente(e.target.value);setPagina(1)}}
                style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',background:'#fff',maxWidth:'200px'}}>
                <option value="">Tutti i clienti</option>
                {clientiFiltro.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'600'}}>Cerca:</span>
              <input value={cerca} onChange={e=>{setCerca(e.target.value);setPagina(1)}} placeholder="N. spedizione, destinatario, città..."
                style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'220px',color:'#1a1a1a',background:'#fff'}}/>
            </div>
          </div>
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
