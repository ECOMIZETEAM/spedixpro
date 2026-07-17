'use client'
import { useEffect, useState } from 'react'

type Movimento = {
  id: string
  tipo: string
  descrizione: string
  riferimento: string | null
  importo: number
  saldo_dopo: number
  created_at: string
  corriere?: string | null
}

const card: React.CSSProperties = { background:'#fff', borderRadius:'8px', border:'1px solid #e8e8e8', padding:'20px' }
const th: React.CSSProperties = { textAlign:'left', fontSize:'11px', fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:'.03em', padding:'10px 12px', borderBottom:'1px solid #eee', whiteSpace:'nowrap' }
const td: React.CSSProperties = { fontSize:'13px', color:'#333', padding:'11px 12px', borderBottom:'1px solid #f2f2f2', whiteSpace:'nowrap' }

function fmtEuro(n: number) {
  return `€ ${Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`
}
function fmtImporto(n: number) {
  const v = Number(n||0)
  const seg = v>0?'+':v<0?'−':''
  const abs = Math.abs(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})
  return `${seg} € ${abs}`
}
function fmtData(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`
}

import { useDialog } from '@/app/components/DialogProvider'
export default function MovimentiMasterPage() {
  const dialog = useDialog()
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [saldo, setSaldo] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [corriereFiltro, setCorriereFiltro] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  // Portali esterni (solo E&A): credito residuo per portale + ricariche
  const [portali, setPortali] = useState<any>(null)
  const [ricariche, setRicariche] = useState<any[]>([])
  const [formImporto, setFormImporto] = useState<{ spediamopro: string; spedisci: string }>({ spediamopro: '', spedisci: '' })
  const [savingP, setSavingP] = useState('')

  async function caricaPortali() {
    try {
      const r = await fetch('/api/portali/ricariche')
      const d = await r.json()
      if (d?.abilitato) { setPortali(d.portali); setRicariche(d.ricariche || []) }
      else { setPortali(null); setRicariche([]) }
    } catch {}
  }
  async function aggiungiRicarica(portale: 'spediamopro' | 'spedisci') {
    const imp = parseFloat(String(formImporto[portale] || '').replace(',', '.'))
    if (!isFinite(imp) || imp === 0) return
    setSavingP(portale)
    try {
      await fetch('/api/portali/ricariche', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portale, importo: imp }) })
      setFormImporto(f => ({ ...f, [portale]: '' }))
      await caricaPortali()
    } finally { setSavingP('') }
  }
  async function eliminaRicarica(id: string) {
    if (!await dialog.confirm({ title: 'Eliminare la ricarica?', danger: true, confirmText: 'Elimina' })) return
    await fetch('/api/portali/ricariche?id=' + id, { method: 'DELETE' })
    await caricaPortali()
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/movimenti/lista?self=1')
        const data = await res.json()
        if (res.ok) { setMovimenti(data.movimenti||[]); setSaldo(Number(data.saldo||0)) }
        else setErr(data.error || 'Errore nel caricamento')
      } catch { setErr('Errore di rete') }
      finally { setLoading(false) }
    })()
    caricaPortali()
  }, [])

  const corrieri = Array.from(new Set(movimenti.map(m => m.corriere).filter(Boolean))) as string[]
  const visibili = movimenti.filter(m => {
    if (corriereFiltro && m.corriere !== corriereFiltro) return false
    if (cerca) {
      const c = cerca.toLowerCase()
      if (!(m.descrizione?.toLowerCase().includes(c) || (m.riferimento||'').toLowerCase().includes(c))) return false
    }
    return true
  })
  const totaleFiltrato = visibili.reduce((s, m) => s + Number(m.importo || 0), 0)

  const totalePagine = Math.max(1, Math.ceil(visibili.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const _pag = visibili.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Lista Movimenti</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Il tuo saldo e i costi delle spedizioni (a te addebitati dal corriere o dal livello superiore)</p>
      </div>

      {portali && (
        <div style={{...card, marginBottom:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'4px'}}>Portali esterni — credito residuo</div>
          <div style={{fontSize:'12px',color:'#999',marginBottom:'14px'}}>Ricariche fatte sui portali meno lo speso su MoovExpress con i loro contratti.</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            {(['spediamopro','spedisci'] as const).map(pt => {
              const p = portali[pt] || { ricariche:0, speso:0, residuo:0 }
              const label = pt==='spediamopro' ? 'SpediamoPro' : 'Spedisci.online (SDA)'
              const lista = ricariche.filter((r:any) => r.portale===pt)
              return (
                <div key={pt} style={{border:'1px solid #eee',borderRadius:'8px',padding:'14px'}}>
                  <div style={{fontSize:'12px',fontWeight:700,color:'#1a1a1a'}}>{label}</div>
                  <div style={{fontSize:'24px',fontWeight:800,color:p.residuo<0?'#b91c1c':'#15803d',margin:'6px 0'}}>{fmtEuro(p.residuo)}</div>
                  <div style={{fontSize:'12px',color:'#666'}}>Ricaricato {fmtEuro(p.ricariche)} · Speso {fmtEuro(p.speso)}</div>
                  <div style={{display:'flex',gap:'6px',marginTop:'10px'}}>
                    <input value={formImporto[pt]} onChange={e=>setFormImporto(f=>({...f,[pt]:e.target.value}))} placeholder="Importo ricarica €" inputMode="decimal"
                      style={{flex:1,padding:'7px 10px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',minWidth:0}}/>
                    <button onClick={()=>aggiungiRicarica(pt)} disabled={savingP===pt}
                      style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',padding:'7px 14px',fontSize:'13px',fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',opacity:savingP===pt?0.6:1}}>+ Aggiungi</button>
                  </div>
                  {lista.length>0 && (
                    <div style={{marginTop:'10px',maxHeight:'150px',overflowY:'auto'}}>
                      {lista.map((r:any)=>(
                        <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px',padding:'4px 0',borderBottom:'1px solid #f5f5f5'}}>
                          <span style={{color:'#666'}}>{new Date(r.created_at).toLocaleDateString('it-IT')}</span>
                          <span style={{fontWeight:600,color:Number(r.importo)<0?'#b91c1c':'#15803d'}}>{fmtEuro(Number(r.importo))}</span>
                          <button onClick={()=>eliminaRicarica(r.id)} title="Elimina" style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:'15px',lineHeight:1}}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{...card,marginBottom:'16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div style={{display:'flex',gap:'28px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'11px',fontWeight:600,color:'#888',textTransform:'uppercase',letterSpacing:'.03em'}}>Credito disponibile</div>
            <div style={{fontSize:'26px',fontWeight:700,color:saldo<0?'#b91c1c':'#15803d',marginTop:'4px'}}>{fmtEuro(saldo)}</div>
          </div>
          <div>
            <div style={{fontSize:'11px',fontWeight:600,color:'#888',textTransform:'uppercase',letterSpacing:'.03em'}}>Totale movimenti{corriereFiltro?` · ${corriereFiltro}`:''}</div>
            <div style={{fontSize:'26px',fontWeight:700,color:totaleFiltrato<0?'#b91c1c':'#15803d',marginTop:'4px'}}>{fmtImporto(totaleFiltrato)}</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <span style={{fontSize:'12.5px',color:'#666'}}>Corriere</span>
          <select value={corriereFiltro} onChange={e=>{setCorriereFiltro(e.target.value);setPagina(1)}} style={{padding:'6px 8px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',maxWidth:'200px'}}>
            <option value="">Tutti i corrieri</option>
            {corrieri.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{fontSize:'12.5px',color:'#666'}}>Mostra</span>
          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'6px 8px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
          <span style={{fontSize:'12.5px',color:'#666'}}>Cerca:</span>
          <input value={cerca} onChange={e=>setCerca(e.target.value)} placeholder="Movimento o riferimento…"
            style={{padding:'7px 10px',border:'1px solid #ddd',borderRadius:'6px',fontSize:'13px',width:'220px',color:'#1a1a1a',background:'#fff'}}/>
        </div>
      </div>

      <div style={card}>
        {err && <div style={{marginBottom:'12px',padding:'10px 14px',borderRadius:'8px',fontSize:'13px',border:'1px solid #fecaca',background:'#fef2f2',color:'#b91c1c'}}>{err}</div>}
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento…</div>
        ) : !visibili.length ? (
          <div style={{padding:'50px',textAlign:'center'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>📄</div>
            <div style={{fontSize:'14px',fontWeight:500,color:'#999'}}>Nessun movimento</div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={th}>Data e ora</th>
                  <th style={th}>Movimento</th>
                  <th style={{...th,textAlign:'right'}}>Importo</th>
                  <th style={{...th,textAlign:'right'}}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {_pag.map(m => {
                  const positivo = Number(m.importo) > 0
                  return (
                    <tr key={m.id}>
                      <td style={{...td,color:'#666',fontSize:'12px'}}>{fmtData(m.created_at)}</td>
                      <td style={{...td,color:'#1a1a1a',whiteSpace:'normal'}}>{m.descrizione}</td>
                      <td style={{...td,textAlign:'right',fontWeight:600,color:positivo?'#15803d':'#b91c1c'}}>{fmtImporto(Number(m.importo))}</td>
                      <td style={{...td,textAlign:'right',color:'#1a1a1a'}}>{fmtEuro(Number(m.saldo_dopo))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {totalePagine > 0 && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'6px',padding:'14px 2px 4px'}}>
                <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #ddd',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
                {Array.from({length:totalePagine},(_, i)=>i+1).filter(n=>n===1||n===totalePagine||Math.abs(n-paginaCorr)<=2).map((n)=>(
                  <button key={n} onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#ddd',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',cursor:'pointer'}}>{n}</button>
                ))}
                <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #ddd',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
