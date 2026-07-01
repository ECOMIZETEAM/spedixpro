'use client'
import { useState, useEffect } from 'react'

export default function SpedizioniClientePage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/spedizioni/lista')
      .then(r => r.json())
      .then(d => { setSpedizioni(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const statiStyle: Record<string,{bg:string,color:string}> = {
    in_lavorazione:{bg:'#fffbeb',color:'#d97706'},
    spedita:{bg:'#eff6ff',color:'#2563eb'},
    consegnata:{bg:'#f0fdf4',color:'#16a34a'},
    reso_mittente:{bg:'#fef2f2',color:'#dc2626'},
    annullata:{bg:'#f5f5f5',color:'#666'},
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Le mie Spedizioni</h1>
          <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>{spedizioni.length} spedizioni totali</p>
        </div>
        <a href="/cliente/spedizioni/nuova" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuova Spedizione</a>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#bbb'}}>
            <div style={{fontSize:'14px'}}>Caricamento...</div>
          </div>
        ) : !spedizioni.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#bbb'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>📦</div>
            <div style={{fontSize:'14px',fontWeight:'500',color:'#999'}}>Nessuna spedizione</div>
            <a href="/cliente/spedizioni/nuova" style={{display:'inline-block',marginTop:'12px',background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>Crea la prima</a>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  {['N. Spedizione','Destinatario','Peso','Colli','Contrassegno','Data','Stato','Totale','Azioni'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px',color:'#bbb',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spedizioni.map(s => {
                  const st = statiStyle[s.stato] || statiStyle['annullata']
                  return (
                    <tr key={s.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                      <td style={{padding:'10px 14px'}}><span style={{fontWeight:'600',color:'#f97316'}}>{s.numero}</span></td>
                      <td style={{padding:'10px 14px'}}>
                        <div style={{color:'#333',fontWeight:'500'}}>{s.dest_nome}</div>
                        <div style={{color:'#bbb',fontSize:'11px'}}>{s.dest_citta} ({s.dest_provincia}), {s.dest_paese}</div>
                      </td>
                      <td style={{padding:'10px 14px',color:'#666'}}>{s.peso_reale}kg</td>
                      <td style={{padding:'10px 14px',color:'#666'}}>{s.colli}</td>
                      <td style={{padding:'10px 14px',color:'#666'}}>{Number(s.contrassegno)>0?`€${s.contrassegno}`:'—'}</td>
                      <td style={{padding:'10px 14px',color:'#999',fontSize:'12px',whiteSpace:'nowrap'}}>{new Date(s.created_at).toLocaleDateString('it-IT')} {new Date(s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                      <td style={{padding:'10px 14px'}}><span style={{background:st.bg,color:st.color,padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'500',whiteSpace:'nowrap'}}>{s.stato.replace(/_/g,' ')}</span></td>
                      <td style={{padding:'10px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(s.costo_totale||0).toFixed(2)}</td>
                      <td style={{padding:'10px 14px'}}>
                        <div style={{display:'flex',gap:'6px'}}>
                          <a href={`/api/spedizioni/etichetta?id=${s.id}`} target="_blank" rel="noopener noreferrer" style={{padding:'4px 10px',background:'#f5f5f5',color:'#333',borderRadius:'4px',fontSize:'12px',textDecoration:'none',border:'1px solid #e8e8e8'}} title="Etichetta">🖨️</a>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
