'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'
const card = { background:'#fff', borderRadius:'8px', border:'1px solid #e8e8e8', padding:'16px' as const }

export default function ApiKeysPage() {
  const [contratti, setContratti] = useState<any[]>([])
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creando, setCreando] = useState('')
  const [msg, setMsg] = useState('')
  const [nuovaChiave, setNuovaChiave] = useState('')

  const base = typeof window !== 'undefined' ? window.location.origin : 'https://moovexpress.com'

  async function carica() {
    setLoading(true)
    const [c, k] = await Promise.all([
      fetch('/api/cliente/corrieri-abilitati').then(r=>r.json()).catch(()=>[]),
      fetch('/api/cliente/api-keys').then(r=>r.json()).catch(()=>[]),
    ])
    setContratti(Array.isArray(c)?c:[])
    setKeys(Array.isArray(k)?k:[])
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [])

  async function genera(corriereId:string, nome:string) {
    setCreando(corriereId); setMsg('')
    const res = await fetch('/api/cliente/api-keys', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ corriereId, nome })
    })
    const d = await res.json()
    setCreando('')
    if (d.error) { setMsg('Errore: '+d.error); return }
    if (d.chiave) { setNuovaChiave(d.chiave); setMsg('') }
    carica()
  }
  async function revoca(id:string) {
    if (!confirm('Revocare questa API key? I sistemi collegati smetteranno di funzionare.')) return
    await fetch('/api/cliente/api-keys/'+id, { method:'DELETE' })
    carica()
  }
  function copia(t:string) { navigator.clipboard?.writeText(t); setMsg('Copiato negli appunti') }

  const keysPerCorriere = (cid:string) => keys.filter(k=>k.corriere_id===cid)

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#666'}}>Caricamento...</div>

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>API Key</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Genera una chiave API per collegare un tuo contratto a un altro gestionale.</p>
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px',marginBottom:'14px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

      {nuovaChiave && (
        <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',padding:'14px',marginBottom:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:700,color:'#16a34a',marginBottom:'8px'}}>✓ API key creata — copiala e conservala</div>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <code style={{flex:1,fontSize:'13px',color:'#1a1a1a',wordBreak:'break-all',background:'#fff',border:'1px solid #d1fae5',borderRadius:'6px',padding:'8px 10px'}}>{nuovaChiave}</code>
            <button onClick={()=>copia(nuovaChiave)} style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:'6px',padding:'8px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer'}}>Copia</button>
            <button onClick={()=>setNuovaChiave('')} style={{background:'#fff',color:'#666',border:'1px solid #ddd',borderRadius:'6px',padding:'8px 12px',fontSize:'12.5px',cursor:'pointer'}}>Chiudi</button>
          </div>
        </div>
      )}

      {keys.length>0 && (
        <div style={{...card, marginBottom:'16px'}}>
          <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'10px'}}>Le tue API key ({keys.length})</div>
          {keys.map((k:any)=>(
            <div key={k.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 0',borderTop:'1px solid #f0f0f0'}}>
              <span style={{fontSize:'11px',fontWeight:700,color:'#666',minWidth:'110px'}}>{k.corrieri?.nome_contratto||'—'}</span>
              <code style={{flex:1,fontSize:'12px',color:'#1a1a1a',wordBreak:'break-all',background:'#f9fafb',border:'1px solid #eee',borderRadius:'4px',padding:'6px 8px'}}>{k.chiave}</code>
              <button onClick={()=>copia(k.chiave)} style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>Copia</button>
              <button onClick={()=>revoca(k.id)} style={{background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',padding:'6px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Revoca</button>
            </div>
          ))}
        </div>
      )}

      <div style={{...card, marginBottom:'16px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'8px'}}>Come si usa</div>
        <div style={{fontSize:'12.5px',color:'#444',lineHeight:1.6}}>
          Base URL: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>{base}/api/v1</code><br/>
          Autenticazione: header <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>Authorization: Bearer &lt;api_key&gt;</code><br/>
          Tariffa: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>POST {base}/api/v1/rates</code><br/>
          Crea spedizione: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>POST {base}/api/v1/shipments</code> — body <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>{'{ packages, shipFrom, shipTo, codValue?, insuranceValue? }'}</code><br/>
          Stato: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>GET {base}/api/v1/shipments/&#123;id&#125;</code> · Etichetta LDV: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>GET {base}/api/v1/shipments/&#123;id&#125;/label</code><br/>
          Annulla (solo se non ancora affidata al corriere): <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>DELETE {base}/api/v1/shipments/&#123;id&#125;</code>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
        {contratti.length===0 && <div style={{...card,textAlign:'center',color:'#666',fontSize:'13px'}}>Nessun contratto disponibile.</div>}
        {contratti.map((c:any)=>{
          const haChiave = keysPerCorriere(c.id).length > 0
          return (
            <div key={c.id} style={{...card, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>{c.nome_contratto}</div>
              {haChiave ? (
                <span style={{fontSize:'12.5px',fontWeight:700,color:'#16a34a'}}>✓ Chiave attiva</span>
              ) : (
                <button onClick={()=>genera(c.id, c.nome_contratto)} disabled={creando===c.id}
                  style={{background:'#fff7ed',color:ACCENT,border:'1px solid #fed7aa',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:creando===c.id?.6:1}}>
                  {creando===c.id?'…':'+ Genera API key'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
