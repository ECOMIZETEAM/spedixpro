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
  const [nuovaKey, setNuovaKey] = useState<any>(null)

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
    setNuovaKey(d)
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
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>API / Sviluppatori</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Genera una chiave API per collegare un tuo contratto a un altro gestionale.</p>
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'6px',padding:'10px',marginBottom:'14px',fontSize:'13px',color:'#ea580c'}}>{msg}</div>}

      {nuovaKey && (
        <div style={{...card, borderColor:ACCENT, marginBottom:'16px', background:'#fff7ed'}}>
          <div style={{fontWeight:700,color:'#1a1a1a',marginBottom:'6px'}}>✅ Nuova API key creata — copiala ora, non sarà più mostrata per intero</div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <code style={{flex:1,background:'#fff',border:'1px solid #fed7aa',borderRadius:'6px',padding:'9px 12px',fontSize:'13px',color:'#1a1a1a',wordBreak:'break-all'}}>{nuovaKey.chiave}</code>
            <button onClick={()=>copia(nuovaKey.chiave)} style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'9px 14px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>Copia</button>
          </div>
        </div>
      )}

      <div style={{...card, marginBottom:'16px'}}>
        <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginBottom:'8px'}}>Come si usa</div>
        <div style={{fontSize:'12.5px',color:'#444',lineHeight:1.6}}>
          Base URL: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>{base}/api/v1</code><br/>
          Autenticazione: header <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>Authorization: Bearer &lt;api_key&gt;</code><br/>
          Tariffa: <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>POST {base}/api/v1/rates</code> — body <code style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:'4px'}}>{'{ packages:[{weight,length,width,height}], shipTo:{postalCode,state,country} }'}</code>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
        {contratti.length===0 && <div style={{...card,textAlign:'center',color:'#666',fontSize:'13px'}}>Nessun contratto disponibile.</div>}
        {contratti.map((c:any)=>{
          const ks = keysPerCorriere(c.id)
          return (
            <div key={c.id} style={card}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom: ks.length?'10px':'0'}}>
                <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>{c.nome_contratto}</div>
                <button onClick={()=>genera(c.id, c.nome_contratto)} disabled={creando===c.id}
                  style={{background:'#fff7ed',color:ACCENT,border:'1px solid #fed7aa',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:creando===c.id?.6:1}}>
                  {creando===c.id?'…':'+ Genera API key'}
                </button>
              </div>
              {ks.map((k:any)=>(
                <div key={k.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 0',borderTop:'1px solid #f0f0f0'}}>
                  <code style={{flex:1,fontSize:'12.5px',color:'#666'}}>{k.chiave ? (k.chiave.slice(0,14)+'••••••••'+k.chiave.slice(-4)) : '—'}</code>
                  <span style={{fontSize:'11px',color:'#999'}}>{k.last_used_at?('usata il '+new Date(k.last_used_at).toLocaleDateString('it-IT')):'mai usata'}</span>
                  <button onClick={()=>revoca(k.id)} style={{background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Revoca</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
