'use client'
import { useState, useEffect } from 'react'

export default function SpedizioniCancellatePage() {
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')

  useEffect(() => {
    fetch('/api/spedizioni/lista?stato=annullata')
      .then(r => r.json())
      .then(d => { setSpedizioni(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const visibili = cerca
    ? spedizioni.filter(s =>
        s.numero?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.dest_nome?.toLowerCase().includes(cerca.toLowerCase()) ||
        s.clienti?.ragione_sociale?.toLowerCase().includes(cerca.toLowerCase()))
    : spedizioni

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <a href="/dashboard/spedizioni" style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>← Lista Spedizioni</a>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Spedizioni Cancellate</h1>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>🗑️ Cancellate <span style={{color:'#666',fontWeight:'400',fontSize:'12px'}}>({visibili.length})</span></span>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontSize:'12px',color:'#1a1a1a',fontWeight:'600'}}>Cerca:</span>
            <input value={cerca} onChange={e=>setCerca(e.target.value)} placeholder="N. spedizione, cliente o destinatario..."
              style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',width:'260px',color:'#1a1a1a',background:'#fff'}}/>
          </div>
        </div>

        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
        ) : !visibili.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'36px',marginBottom:'12px'}}>🗑️</div>
            <div style={{fontWeight:'500'}}>Nessuna spedizione cancellata</div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#f9fafb'}}>
                  {['N. Spedizione','Cliente','Destinatario','Città','CAP','Peso','Colli','Data','Totale'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 12px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase',letterSpacing:'0.4px',color:'#1a1a1a',borderBottom:'1px solid #d1d5db',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map(s => (
                  <tr key={s.id} style={{borderBottom:'1px solid #eee'}}>
                    <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>{s.numero}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a',fontSize:'12px'}}>{s.clienti?.ragione_sociale || '—'}</td>
                    <td style={{padding:'9px 12px'}}>
                      <div style={{color:'#1a1a1a',fontWeight:'500'}}>{s.dest_nome}</div>
                    </td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_citta} {s.dest_provincia && `(${s.dest_provincia})`}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.dest_cap}</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.peso_reale}kg</td>
                    <td style={{padding:'9px 12px',color:'#1a1a1a'}}>{s.colli}</td>
                    <td style={{padding:'9px 12px',color:'#666',fontSize:'12px',whiteSpace:'nowrap'}}>{new Date(s.created_at).toLocaleDateString('it-IT')} {new Date(s.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{padding:'9px 12px',fontWeight:'700',color:'#1a1a1a'}}>€ {Number(s.costo_totale||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
