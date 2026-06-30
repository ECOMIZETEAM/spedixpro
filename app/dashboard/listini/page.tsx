'use client'
import { useState, useEffect } from 'react'

export default function ListiniPage() {
  const [listini, setListini] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/listini/lista')
      .then(r => r.json())
      .then(d => { setListini(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Listini Clienti</h1>
          <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{listini.length} listini totali</p>
        </div>
        <a href="/dashboard/listini/clienti/nuovo" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuovo Listino</a>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'14px'}}>Caricamento...</div>
          </div>
        ) : !listini.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>💰</div>
            <div style={{fontSize:'14px',fontWeight:'500',color:'#1a1a1a'}}>Nessun listino</div>
            <a href="/dashboard/listini/clienti/nuovo" style={{display:'inline-block',marginTop:'12px',background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>Crea il primo</a>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Nome Listino','Fasce','Creato il','Azioni'].map(h=>(
                  <th key={h} style={{textAlign:'left',padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listini.map(l => (
                <tr key={l.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'10px 14px',fontWeight:'600',color:'#1a1a1a'}}>{l.nome}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a'}}>{l.fasce_count||'—'}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(l.created_at).toLocaleDateString('it-IT')}</td>
                  <td style={{padding:'10px 14px'}}>
                    <a href={`/dashboard/listini/clienti/${l.id}`} style={{padding:'4px 10px',background:'#f5f5f5',color:'#333',borderRadius:'4px',fontSize:'12px',textDecoration:'none',border:'1px solid #e8e8e8'}}>✏️ Modifica</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
