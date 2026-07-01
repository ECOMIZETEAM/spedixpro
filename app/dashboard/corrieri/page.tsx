'use client'
import { useState, useEffect } from 'react'

const DISPONIBILI = [
  {tipo:'spedisci',nome:'Spedisci.online',desc:'Aggregatore'},
  {tipo:'gls',nome:'GLS',desc:'Diretto'},
  {tipo:'sda',nome:'SDA Express',desc:'Diretto'},
  {tipo:'brt',nome:'BRT',desc:'Diretto'},
  {tipo:'dhl',nome:'DHL Express',desc:'Diretto'},
  {tipo:'poste',nome:'Poste Italiane',desc:'Diretto'},
  {tipo:'ups',nome:'UPS',desc:'Diretto'},
  {tipo:'tnt',nome:'TNT',desc:'Diretto'},
  {tipo:'inpost',nome:'InPost',desc:'Diretto'},
  {tipo:'spring',nome:'Spring',desc:'Diretto'},
  {tipo:'fedex',nome:'FedEx',desc:'Diretto'},
  {tipo:'hrp',nome:'HR Parcel',desc:'Diretto'},
]

export default function CorrieriPage() {
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [confermaElimina, setConfermaElimina] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState(false)

  useEffect(() => {
    fetch('/api/corrieri/lista').then(r => r.json()).then(d => {
      setCorrieri(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function toggleAttivo(id: string, attivoAttuale: boolean) {
    setCorrieri(prev => prev.map(c => c.id === id ? { ...c, attivo: !attivoAttuale } : c))
    await fetch(`/api/corrieri/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo: !attivoAttuale })
    })
  }

  async function confermaEliminazione() {
    if (!confermaElimina) return
    setEliminando(true)
    const res = await fetch(`/api/corrieri/${confermaElimina}`, { method: 'DELETE' })
    setEliminando(false)
    if (res.ok) {
      setCorrieri(prev => prev.filter(c => c.id !== confermaElimina))
      setConfermaElimina(null)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Corrieri</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{corrieri.length} contratti configurati</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Contratti Configurati</div>
          {loading ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Caricamento...</div>
          ) : !corrieri.length ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Nessun contratto — aggiungine uno →</div>
          ) : corrieri.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 18px',borderBottom:'1px solid #f5f5f5'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{width:'44px',height:'28px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'4px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'#333',textTransform:'uppercase'}}>{c.tipo}</div>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</div>
                  <div style={{fontSize:'11px',color:'#1a1a1a'}}>L{c.livello}</div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                <button onClick={() => toggleAttivo(c.id, c.attivo)}
                  style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'600',border:'none',cursor:'pointer'}}>
                  {c.attivo?'● Attivo':'⏸ In pausa'}
                </button>
                <a href={`/dashboard/corrieri/aggiungi?tipo=${c.tipo}&id=${c.id}`} title="Modifica"
                  style={{padding:'4px 10px',background:'#eff6ff',color:'#2563eb',borderRadius:'4px',fontSize:'11px',textDecoration:'none',border:'1px solid #bfdbfe'}}>✏️ Modifica</a>
                <button onClick={() => setConfermaElimina(c.id)} title="Elimina"
                  style={{padding:'4px 10px',background:'#fef2f2',color:'#dc2626',borderRadius:'4px',fontSize:'11px',border:'1px solid #fecaca',cursor:'pointer'}}>🗑</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Aggiungi Corriere</div>
          <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
            {DISPONIBILI.map(c => (
              <a key={c.tipo} href={`/dashboard/corrieri/aggiungi?tipo=${c.tipo}`}
                style={{border:'1px solid #e8e8e8',borderRadius:'6px',padding:'12px 8px',textAlign:'center',textDecoration:'none',display:'block',transition:'border-color .15s'}}>
                <div style={{width:'40px',height:'24px',background:'#f5f5f5',borderRadius:'3px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:'700',color:'#333',margin:'0 auto 6px',textTransform:'uppercase'}}>{c.tipo}</div>
                <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',lineHeight:1.3}}>{c.nome}</div>
                <div style={{fontSize:'10px',color:'#1a1a1a',marginTop:'2px'}}>{c.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </div>

      {confermaElimina && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#fff',borderRadius:'10px',padding:'28px',maxWidth:'380px',textAlign:'center'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>⚠️</div>
            <div style={{fontSize:'15px',fontWeight:'700',color:'#1a1a1a',marginBottom:'8px'}}>Sei sicuro di voler eliminare?</div>
            <div style={{fontSize:'13px',color:'#666',marginBottom:'20px'}}>Tutti i dati di questo contratto andranno persi. Questa azione non è reversibile.</div>
            <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
              <button onClick={() => setConfermaElimina(null)} disabled={eliminando}
                style={{padding:'9px 20px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',cursor:'pointer'}}>
                Annulla
              </button>
              <button onClick={confermaEliminazione} disabled={eliminando}
                style={{padding:'9px 20px',background:'#dc2626',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',color:'#fff',cursor:'pointer',opacity:eliminando?0.7:1}}>
                {eliminando?'Eliminazione...':'Sì, elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
